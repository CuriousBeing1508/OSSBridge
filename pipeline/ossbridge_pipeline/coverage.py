#!/usr/bin/env python3
"""
================================================================================
Step 5: Test Coverage
================================================================================

Runs the library's own test suite for the released version with JaCoCo and
writes a JaCoCo XML report, without changing the project's build files:

    1. Source: the GitHub repository from the POM's <scm> on Maven Central, and the
       release tag: the POM's <scm><tag> if set, else the first existing tag of
       rel/<artifact>-<v>, <artifact>-<v>, v<v>, <v>, release-<v>, <repo>-<v>
       (checked with git ls-remote; only exact matches, so -RC tags are not used).
    2. Shallow clone of the tag; the module whose pom.xml declares the artifactId
       (Maven), or the build.gradle(.kts) project (Gradle).
    3. JDK: the lowest installed JDK that can build the Java release the POM asks
       for; if compilation fails, the next one is tried.
    4. JaCoCo agent through JAVA_TOOL_OPTIONS, so every test JVM records coverage
       whatever the build configures, limited to the library's packages. Checks
       unrelated to tests (license, style, enforcer, javadoc, ...) are skipped and
       test failures do not stop the run.
    5. Report with the JaCoCo command line from the recorded data and the compiled
       classes.

SECURITY: this runs the library's build and tests, i.e. code from the internet.
Run it in a container (planned pipeline image) for libraries you do not trust.

OUTPUT (in the workspace):
    coverage.xml    JaCoCo XML report
    coverage.json   status, repository, tag, module, build tool, JDK, test counts,
                    duration, log file
    coverage/       build logs (the source checkout is deleted unless keep_source)

Installed JDKs are found with /usr/libexec/java_home (macOS) or /usr/lib/jvm
(Linux), or set explicitly: OSSBRIDGE_JDKS="17=/path/to/jdk17,21=/path/to/jdk21".

USAGE:
    python -m ossbridge_pipeline.coverage --library commons-codec:commons-codec --version 1.17.1
================================================================================
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import requests

from .coords import MAVEN_CENTRAL
from .download_jars import download_library_jar
from .workspace import Workspace

JACOCO_VERSION = "0.8.12"
TOOLS_DIR = Path(__file__).resolve().parents[2] / "data" / "tools"
DEFAULT_TIMEOUT = 60 * 60   # seconds per build attempt

TAG_PATTERNS = ["rel/{artifact}-{version}", "{artifact}-{version}", "v{version}", "{version}",
                "release-{version}", "rel/{repo}-{version}", "{repo}-{version}", "{artifact}-parent-{version}",
                "parent-{version}", "version-{version}", "rel/{version}", "r{version}", "v_{version}"]
# A tag that only ends with the version must not be a pre-release of it
PRE_RELEASE = re.compile(r"(?i)(rc|alpha|beta|milestone|snapshot|preview|m)\d*$")
MAX_PARENT_DEPTH = 6

# Build checks unrelated to running the tests
MAVEN_FLAGS = [
    "-B", "-e", "-Dmaven.test.failure.ignore=true", "-Dsurefire.failIfNoSpecifiedTests=false",
    "-DfailIfNoTests=false", "-DskipITs=true", "-Drat.skip=true", "-Dcheckstyle.skip=true",
    "-Dspotbugs.skip=true", "-Dpmd.skip=true", "-Dcpd.skip=true", "-Denforcer.skip=true",
    "-Danimal.sniffer.skip=true", "-Djapicmp.skip=true", "-Dmaven.javadoc.skip=true",
    "-Dlicense.skip=true", "-Dspotless.check.skip=true", "-Drevapi.skip=true", "-Djacoco.skip=true",
    "-Dgpg.skip=true", "-Dmaven.source.skip=true",
]
RELEASE_PROPERTIES = ["maven.compiler.release", "maven.compiler.source", "maven.compiler.target",
                      "java.version", "javac.src.version", "javac.target.version"]


class CoverageError(Exception):
    def __init__(self, status, detail):
        super().__init__(detail)
        self.status = status


# ---------------------------------------------------------------- source location

def pom_url(library_ga, version, base_url=MAVEN_CENTRAL):
    group, artifact = library_ga.split(":", 1)
    return f"{base_url}/{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.pom"


def github_repo(text):
    """'owner/repo' from a GitHub or Apache gitbox URL / SCM connection, else None."""
    if not text:
        return None
    m = re.search(r"github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$", text.strip())
    if m:
        return f"{m.group(1)}/{m.group(2)}"
    m = re.search(r"gitbox\.apache\.org/repos/asf/([\w.-]+?)(?:\.git)?$", text.strip())
    if m:
        return f"apache/{m.group(1)}"
    return None


def _finder(root):
    ns = re.match(r"\{(.*)\}", root.tag)
    return (lambda e, p: e.find(f"{{{ns.group(1)}}}{p}")) if ns else (lambda e, p: e.find(p))


def scm_from_pom(pom_text):
    """(owner/repo, tag) from a POM's <scm>; tag is None for HEAD or missing."""
    root = ET.fromstring(pom_text)
    find = _finder(root)
    scm = find(root, "scm")
    if scm is None:
        return None, None
    repo = None
    for field in ("url", "connection", "developerConnection"):
        el = find(scm, field)
        repo = repo or github_repo(el.text if el is not None else None)
    tag_el = find(scm, "tag")
    tag = tag_el.text.strip() if tag_el is not None and tag_el.text else None
    return repo, (None if not tag or tag.upper() == "HEAD" else tag)


def parent_of(pom_text):
    """'group:artifact', version of the POM's <parent>, or None."""
    root = ET.fromstring(pom_text)
    find = _finder(root)
    parent = find(root, "parent")
    if parent is None:
        return None
    values = [find(parent, f) for f in ("groupId", "artifactId", "version")]
    if any(v is None or not v.text for v in values):
        return None
    group, artifact, version = (v.text.strip() for v in values)
    return f"{group}:{artifact}", version


def scm_with_parents(library_ga, version, base_url=MAVEN_CENTRAL):
    """(owner/repo, tag) from the POM, following <parent> POMs when the <scm> is inherited.

    The tag is only taken from the library's own POM.
    """
    ga, v, own_tag = library_ga, version, None
    for depth in range(MAX_PARENT_DEPTH):
        resp = requests.get(pom_url(ga, v, base_url), timeout=60)
        if resp.status_code != 200:
            return None, own_tag
        repo, tag = scm_from_pom(resp.text)
        if depth == 0:
            own_tag = tag
        if repo:
            return repo, own_tag
        parent = parent_of(resp.text)
        if not parent:
            return None, own_tag
        ga, v = parent
    return None, own_tag


def remote_tags(repo):
    out = subprocess.run(["git", "ls-remote", "--tags", f"https://github.com/{repo}.git"],
                         capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise CoverageError("no_repository", f"git ls-remote failed for {repo}: {out.stderr.strip()}")
    return {line.split("refs/tags/", 1)[1].removesuffix("^{}") for line in out.stdout.splitlines()
            if "refs/tags/" in line}


def choose_tag(tags, artifact, version, repo, pom_tag=None):
    """The release tag for the version, or None.

    1. The POM's <scm><tag>, only if it exists and names this version (some
       projects leave the previous release's tag in the POM).
    2. The first existing tag of TAG_PATTERNS.
    3. Otherwise a tag that ends with the exact version (not part of a longer
       version, not a pre-release), preferring tags that name the artifact or
       repository, then the shortest.
    """
    repo_name = repo.split("/")[1]
    if pom_tag and pom_tag in tags and re.search(rf"(?<![\d.]){re.escape(version)}$", pom_tag):
        return pom_tag
    for pattern in TAG_PATTERNS:
        tag = pattern.format(artifact=artifact, version=version, repo=repo_name)
        if tag in tags:
            return tag
    ending = re.compile(rf"(?<![\d.]){re.escape(version)}$")
    candidates = [t for t in tags if ending.search(t) and not PRE_RELEASE.search(t)]
    candidates.sort(key=lambda t: (artifact not in t and repo_name not in t, len(t), t))
    return candidates[0] if candidates else None


def resolve_source(library_ga, version, repo=None, tag=None, base_url=MAVEN_CENTRAL):
    """Return (owner/repo, tag); explicit repo/tag override what the POMs say."""
    pom_repo, pom_tag = None, None
    if not repo or not tag:
        pom_repo, pom_tag = scm_with_parents(library_ga, version, base_url)
    repo = repo or pom_repo
    if not repo:
        raise CoverageError("no_repository", "no GitHub repository in the POM's <scm> or its parents; "
                                             "pass --repo owner/name")
    if tag:
        return repo, tag
    artifact = library_ga.split(":", 1)[1]
    tags = remote_tags(repo)
    found = choose_tag(tags, artifact, version, repo, pom_tag)
    # Flavors released from one tag, e.g. guava 33.2.1-jre and 33.2.1-android -> v33.2.1
    flavor = re.fullmatch(r"(.+?)-([A-Za-z]+\d*)", version)
    if not found and flavor and not PRE_RELEASE.fullmatch(flavor.group(2)):
        found = choose_tag(tags, artifact, flavor.group(1), repo)
    if not found:
        raise CoverageError("no_tag", f"no release tag for {version} in {repo}; pass --tag")
    return repo, found


def clone(repo, tag, dest):
    if dest.exists():
        shutil.rmtree(dest)
    out = subprocess.run(["git", "clone", "--quiet", "--depth", "1", "--branch", tag,
                          f"https://github.com/{repo}.git", str(dest)], capture_output=True, text=True, timeout=1800)
    if out.returncode != 0:
        raise CoverageError("clone_failed", out.stderr.strip())


# ---------------------------------------------------------------- project layout

def pom_artifact_id(pom):
    """The project's own artifactId (not its parent's)."""
    try:
        root = ET.parse(pom).getroot()
    except ET.ParseError:
        return None
    for child in root:
        if child.tag.split("}")[-1] == "artifactId":
            return (child.text or "").strip()
    return None


def project_poms(source_dir):
    """pom.xml files of a checkout, shallowest first, without test resources and build output."""
    source_dir = Path(source_dir)
    poms = [p for p in source_dir.rglob("pom.xml")
            if not {"src", "target", "node_modules"} & set(p.relative_to(source_dir).parts)]
    return sorted(poms, key=lambda p: (len(p.parts), str(p)))


def find_module(source_dir, artifact):
    """(project_root, module_dir, build_tool) for the artifact in a checkout.

    For Maven, the module is the pom.xml declaring the artifactId, wherever it is
    (some repositories keep it in a subfolder), and the project root is the topmost
    folder above it that still has a pom.xml (the reactor the build runs in).
    """
    source_dir = Path(source_dir)
    poms = project_poms(source_dir)
    if poms:
        module = next((p.parent for p in poms if pom_artifact_id(p) == artifact), None)
        if module is None:
            raise CoverageError("no_module", f"no pom.xml with artifactId {artifact}")
        root = module
        while root != source_dir and (root.parent / "pom.xml").exists():
            root = root.parent
        return root, module, "maven"
    for name in ("build.gradle", "build.gradle.kts"):
        if (source_dir / name).exists():
            for candidate in (source_dir / artifact, source_dir):
                if (candidate / "build.gradle").exists() or (candidate / "build.gradle.kts").exists():
                    return source_dir, candidate, "gradle"
    raise CoverageError("no_build", "no pom.xml or build.gradle found (other build tools, e.g. Ant, "
                                    "are not supported)")


def test_modules(project_root, module_dir, artifact):
    """Modules next to the library module that hold its tests, e.g. guava-tests, log4j-api-test.

    Only siblings count: a repository can contain other builds with the same names
    (guava's android/guava-tests belongs to the separate Android build).
    """
    names = {f"{artifact}-test", f"{artifact}-tests"}
    return [p.parent for p in project_poms(project_root)
            if p.parent.parent == module_dir.parent and pom_artifact_id(p) in names]


def java_release(value):
    """'1.8' -> 8, '17' -> 17, otherwise None."""
    m = re.fullmatch(r"\s*(?:1\.)?(\d+)\s*", value or "")
    return int(m.group(1)) if m else None


def required_release(module_dir, source_dir):
    """Java release the build asks for, from POM properties of the module and its parents in the checkout."""
    module_dir, source_dir = Path(module_dir), Path(source_dir)
    d = module_dir
    while True:
        pom = d / "pom.xml"
        if pom.exists():
            try:
                root = ET.parse(pom).getroot()
            except ET.ParseError:
                root = None
            props = next((c for c in (root if root is not None else []) if c.tag.split("}")[-1] == "properties"), None)
            if props is not None:
                values = {c.tag.split("}")[-1]: c.text for c in props}
                for key in RELEASE_PROPERTIES:
                    release = java_release(values.get(key))
                    if release:
                        return release
        if d == source_dir or d.parent == d:
            return None
        d = d.parent


# ---------------------------------------------------------------- JDKs

def installed_jdks():
    """{major version: JAVA_HOME} of the installed JDKs."""
    configured = os.environ.get("OSSBRIDGE_JDKS")
    if configured:
        return {int(k): v for k, v in (item.split("=", 1) for item in configured.split(",") if "=" in item)}
    jdks = {}
    if Path("/usr/libexec/java_home").exists():
        out = subprocess.run(["/usr/libexec/java_home", "-V"], capture_output=True, text=True)
        for line in (out.stderr + out.stdout).splitlines():
            m = re.match(r"\s+(\d+)(?:\.[\d.]+)?\S*\s.*\s(/\S.*)$", line)
            if m:
                jdks.setdefault(int(m.group(1)), m.group(2).strip())
    for release_file in Path("/usr/lib/jvm").glob("*/release"):
        m = re.search(r'JAVA_VERSION="(?:1\.)?(\d+)', release_file.read_text(errors="ignore"))
        if m:
            jdks.setdefault(int(m.group(1)), str(release_file.parent))
    if not jdks and os.environ.get("JAVA_HOME"):
        release_file = Path(os.environ["JAVA_HOME"]) / "release"
        if release_file.exists():
            m = re.search(r'JAVA_VERSION="(?:1\.)?(\d+)', release_file.read_text(errors="ignore"))
            if m:
                jdks[int(m.group(1))] = os.environ["JAVA_HOME"]
    return jdks


def jdk_order(release, available):
    """JDKs to try: the lowest that can compile the release first, then the others ascending.

    A JDK can compile releases down to 7 (up to JDK 19) or 8 (JDK 20 and later).
    """
    release = release or 8
    def can_compile(jdk):
        return jdk >= release and (release >= 8 or jdk <= 19)
    usable = sorted(j for j in available if can_compile(j))
    rest = sorted(j for j in available if not can_compile(j) and j >= 8)
    return usable + rest


# ---------------------------------------------------------------- JaCoCo

def jacoco_tools(tools_dir=TOOLS_DIR, base_url=MAVEN_CENTRAL):
    """Paths of the JaCoCo agent and command line jars, downloaded once."""
    tools_dir = Path(tools_dir)
    tools_dir.mkdir(parents=True, exist_ok=True)
    jars = {
        "agent": (f"org/jacoco/org.jacoco.agent/{JACOCO_VERSION}/org.jacoco.agent-{JACOCO_VERSION}-runtime.jar"),
        "cli": (f"org/jacoco/org.jacoco.cli/{JACOCO_VERSION}/org.jacoco.cli-{JACOCO_VERSION}-nodeps.jar"),
    }
    paths = {}
    for name, path in jars.items():
        dest = tools_dir / Path(path).name
        if not dest.exists():
            resp = requests.get(f"{base_url}/{path}", timeout=120)
            resp.raise_for_status()
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(resp.content)
            tmp.replace(dest)
        paths[name] = dest
    return paths


def include_patterns(library_jar):
    """JaCoCo includes for the library's packages, e.g. 'org.apache.commons.codec.*'."""
    with zipfile.ZipFile(library_jar) as jar:
        packages = sorted({n.rsplit("/", 1)[0].replace("/", ".") for n in jar.namelist()
                           if n.endswith(".class") and "/" in n and not n.startswith("META-INF/")})
    roots = []
    for p in packages:
        if not any(p == r or p.startswith(r + ".") for r in roots):
            roots.append(p)
    return ":".join(f"{r}.*" for r in roots)


# ---------------------------------------------------------------- build

MAVEN_TOTALS = re.compile(r"^\[(?:INFO|WARNING|ERROR)\] Tests run: (\d+), Failures: (\d+), Errors: (\d+), "
                          r"Skipped: (\d+)\s*$", re.M)


def maven_log_counts(log_file):
    """Totals from surefire's summary lines in a Maven log (one per test execution), or None."""
    matches = MAVEN_TOTALS.findall(Path(log_file).read_text(errors="ignore"))
    if not matches:
        return None
    return {key: sum(int(m[i]) for m in matches) for i, key in enumerate(("tests", "failures", "errors", "skipped"))}


def test_counts(report_dirs):
    """Totals of JUnit XML reports (surefire and Gradle use the same format)."""
    totals = {"tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    for d in report_dirs:
        for xml in Path(d).rglob("TEST-*.xml"):
            try:
                suite = ET.parse(xml).getroot()
            except ET.ParseError:
                continue
            for key in totals:
                totals[key] += int(float(suite.get(key, 0) or 0))
    return totals


# Overridden for Java 7 and older (JDKs from 20 on cannot compile for them). Not java.version:
# that is also the JVM's own system property, which plugins read.
RELEASE_OVERRIDES = ["maven.compiler.source", "maven.compiler.target", "javac.src.version", "javac.target.version"]


def build_commands(build_tool, project_root, module_dir, release, extra_test_modules=()):
    """Build steps, and the folders of compiled classes and test reports.

    Each step is a list of alternative commands: the next one is run if the previous
    one fails (e.g. building only the module and what it depends on, else the whole
    project). Tests run in the module and in modules that hold its tests separately.
    """
    if build_tool == "maven":
        # The installed Maven is preferred: old project wrappers can fail to download plugins
        mvn = shutil.which("mvn") or (str(project_root / "mvnw") if (project_root / "mvnw").exists() else None)
        if not mvn:
            raise CoverageError("build_tool_missing", "Maven is not installed and the project has no mvnw")
        flags = list(MAVEN_FLAGS)
        if release and release < 8:
            flags += [f"-D{p}=1.8" for p in RELEASE_OVERRIDES]
        modules = [module_dir, *extra_test_modules]
        if modules == [project_root]:
            steps = [[[mvn, "test"] + flags]]
        else:
            pl = ",".join(m.relative_to(project_root).as_posix() for m in modules)
            steps = [[[mvn, "install", "-DskipTests", "-pl", pl, "-am"] + flags,
                      [mvn, "install", "-DskipTests"] + flags],
                     [[mvn, "test", "-pl", pl] + flags]]
        return steps, [module_dir / "target" / "classes"], [m / "target" / "surefire-reports" for m in modules]

    rel = module_dir.relative_to(project_root).as_posix()
    gradle = str(project_root / "gradlew") if (project_root / "gradlew").exists() else shutil.which("gradle")
    if not gradle:
        raise CoverageError("build_tool_missing", "Gradle project without gradlew, and gradle is not installed")
    task = "test" if rel == "." else f":{rel.replace('/', ':')}:test"
    steps = [[[gradle, task, "--continue", "--no-daemon", "-x", "javadoc"]]]
    classes = [module_dir / "build" / "classes" / "java" / "main", module_dir / "build" / "classes" / "kotlin" / "main"]
    return steps, classes, [module_dir / "build" / "test-results"]


# Surefire 3: "Tests run: 7, ... -- in a.BTest"; older: "Running a.BTest" then "Tests run: 7, ... Time elapsed"
TEST_CLASS_DONE = re.compile(r"Tests run: \d+,.*Time elapsed[^-]*(?:-+ in (\S+))?")
TEST_CLASS_START = re.compile(r"Running (\S+)\s*$")


def run_logged(cmd, cwd, env, log, timeout, on_line=None):
    """Run a command, copying its output to the log; returns the exit code, or None on timeout.

    The command gets its own process group, so a timeout also stops the test JVMs it started.
    """
    proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, errors="replace", start_new_session=True)

    def pump():
        for line in proc.stdout:
            log.write(line)
            if on_line:
                on_line(line)

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    try:
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()
        code = None
    reader.join(timeout=10)
    log.flush()
    return code


def run_build(steps, project_root, jdk_home, agent_options, log_file, timeout, progress=None):
    """Run the build steps; returns True if it timed out.

    progress(stage, detail) is told which command runs and each finished test class.
    """
    env = dict(os.environ, JAVA_HOME=jdk_home,
               JAVA_TOOL_OPTIONS=(os.environ.get("JAVA_TOOL_OPTIONS", "") + " " + agent_options).strip())
    env["PATH"] = f"{jdk_home}/bin{os.pathsep}{env.get('PATH', '')}"
    state = {"done": 0, "running": ""}

    def on_line(line):
        if not progress:
            return
        started = TEST_CLASS_START.search(line)
        if started:
            state["running"] = started.group(1)
            return
        done = TEST_CLASS_DONE.search(line)
        if done:
            name = done.group(1) or state["running"]
            state["done"] += 1
            progress("tests", f"{state['done']} test classes done (last: {name.split('.')[-1]})")

    with open(log_file, "a", encoding="utf-8") as log:
        for alternatives in steps:
            for cmd in alternatives:
                if cmd[0].endswith(("mvnw", "gradlew")):
                    os.chmod(cmd[0], 0o755)
                log.write(f"\n$ {' '.join(cmd)}\n")
                log.flush()
                if progress:
                    progress("build", " ".join([Path(cmd[0]).name] + [a for a in cmd[1:] if not a.startswith("-D")]))
                code = run_logged(cmd, project_root, env, log, timeout, on_line)
                if code is None:
                    return True
                if code == 0:
                    break
    return False


def measure_coverage(workspace, repo=None, tag=None, timeout=DEFAULT_TIMEOUT, keep_source=False,
                     base_url=MAVEN_CENTRAL, progress=None):
    """Step 5; returns the coverage summary (also written to coverage.json).

    progress(stage, detail) is called as the run goes on (source, clone, build, tests, report).
    """
    started = time.time()
    progress = progress or (lambda stage, detail: None)
    summary = {"library": workspace.library_ga, "version": workspace.version, "status": None,
               "repository": None, "tag": None, "module": None, "test_modules": [], "build_tool": None,
               "java_release": None,
               "jdk": None, "jdks_tried": [], "tests": None, "jacoco": JACOCO_VERSION, "detail": ""}
    workspace.coverage_dir.mkdir(parents=True, exist_ok=True)
    source_dir = workspace.coverage_dir / "source"
    exec_file = workspace.coverage_dir / "jacoco.exec"
    workspace.coverage_xml.unlink(missing_ok=True)
    try:
        library_jar = workspace.library_jar if workspace.library_jar.exists() else \
            download_library_jar(workspace, base_url)
        progress("source", "finding the repository and release tag")
        summary["repository"], summary["tag"] = resolve_source(workspace.library_ga, workspace.version,
                                                               repo, tag, base_url)
        progress("clone", f"{summary['repository']} at {summary['tag']}")
        clone(summary["repository"], summary["tag"], source_dir)
        artifact = workspace.library_ga.split(":", 1)[1]
        project_root, module_dir, build_tool = find_module(source_dir, artifact)
        extra_tests = test_modules(project_root, module_dir, artifact) if build_tool == "maven" else []
        summary["module"] = module_dir.relative_to(source_dir).as_posix()
        summary["test_modules"] = [m.relative_to(source_dir).as_posix() for m in extra_tests]
        summary["build_tool"] = build_tool
        release = required_release(module_dir, source_dir) if build_tool == "maven" else None
        summary["java_release"] = release

        jdks = installed_jdks()
        order = jdk_order(release, jdks)
        if not order:
            raise CoverageError("no_jdk", f"no installed JDK (found {sorted(jdks)})")
        tools = jacoco_tools(base_url=base_url)
        agent = (f"-javaagent:{tools['agent']}=destfile={exec_file},append=true,"
                 f"includes={include_patterns(library_jar)}")
        steps, classes_dirs, report_dirs = build_commands(build_tool, project_root, module_dir, release,
                                                          extra_tests)

        for jdk in order:
            summary["jdks_tried"].append(jdk)
            exec_file.unlink(missing_ok=True)
            for d in report_dirs:
                shutil.rmtree(d, ignore_errors=True)
            log_file = workspace.coverage_dir / f"build-jdk{jdk}.log"
            log_file.unlink(missing_ok=True)
            progress("jdk", f"JDK {jdk} (log: {log_file})")
            timed_out = run_build(steps, project_root, jdks[jdk], agent, log_file, timeout, progress)
            if timed_out:
                raise CoverageError("timeout", f"build did not finish within {timeout} s (JDK {jdk})")
            # Maven's own summary is authoritative; the XML reports can miss suites
            counts = (build_tool == "maven" and maven_log_counts(log_file)) or test_counts(report_dirs)
            if counts["tests"] > 0:
                summary["jdk"], summary["tests"] = jdk, counts
                summary["log"] = log_file.name
                break
        else:
            raise CoverageError("build_failed", f"no tests ran with JDK {', '.join(map(str, order))}; "
                                                f"see {workspace.coverage_dir}/build-jdk*.log")

        if not exec_file.exists() or exec_file.stat().st_size == 0:
            raise CoverageError("no_coverage", "tests ran but JaCoCo recorded no execution data")
        progress("report", "writing the JaCoCo report")
        class_args = [a for d in classes_dirs if d.exists() for a in ("--classfiles", str(d))]
        out = subprocess.run(["java", "-jar", str(tools["cli"]), "report", str(exec_file), *class_args,
                              "--xml", str(workspace.coverage_xml)], capture_output=True, text=True,
                             env=dict(os.environ, JAVA_HOME=jdks[summary["jdk"]],
                                      PATH=f"{jdks[summary['jdk']]}/bin{os.pathsep}{os.environ.get('PATH', '')}"))
        if out.returncode != 0 or not workspace.coverage_xml.exists():
            raise CoverageError("report_failed", out.stderr.strip())
        summary["status"] = "ok"
    except CoverageError as e:
        summary["status"], summary["detail"] = e.status, str(e)
    except (requests.RequestException, subprocess.TimeoutExpired, OSError) as e:
        summary["status"], summary["detail"] = "error", f"{type(e).__name__}: {e}"
    finally:
        summary["seconds"] = round(time.time() - started)
        if not keep_source:
            shutil.rmtree(source_dir, ignore_errors=True)
        workspace.coverage_json.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def run(workspace, **options):
    """Step 5 for a workspace."""
    return measure_coverage(workspace, **options)


def main():
    parser = argparse.ArgumentParser(description="Run a library's test suite with JaCoCo")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--repo", help="GitHub owner/name, if the POM has none")
    parser.add_argument("--tag", help="Release tag, if it cannot be found")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="Seconds per build attempt")
    parser.add_argument("--keep-source", action="store_true", help="Keep the source checkout")
    args = parser.parse_args()

    started = time.time()
    last_stage = [None]

    def progress(stage, detail):
        elapsed = int(time.time() - started)
        line = f"  [{elapsed // 60:02d}:{elapsed % 60:02d}] {stage:<6} {detail}"
        if stage == "tests" and last_stage[0] == "tests":
            print("\r" + line[:150].ljust(150), end="", flush=True)   # update the same line
        else:
            print(("\n" if last_stage[0] == "tests" else "") + line[:150], flush=True)
        last_stage[0] = stage

    summary = run(Workspace(args.library, args.version), repo=args.repo, tag=args.tag,
                  timeout=args.timeout, keep_source=args.keep_source, progress=progress)
    print("\n" if last_stage[0] == "tests" else "", end="")
    for key in ("status", "repository", "tag", "module", "test_modules", "build_tool", "java_release", "jdk", "jdks_tried",
                "tests", "seconds", "detail"):
        print(f"  {key:<13}: {summary.get(key)}")
    if summary["status"] != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
