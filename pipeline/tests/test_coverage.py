import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import coverage  # noqa: E402

POM = """<?xml version="1.0"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <parent><artifactId>parent-pom</artifactId></parent>
  <artifactId>{artifact}</artifactId>
  <properties>{props}</properties>
  <scm>
    <connection>scm:git:https://gitbox.apache.org/repos/asf/commons-codec</connection>
    <url>{url}</url>
    <tag>{tag}</tag>
  </scm>
</project>
"""


@pytest.mark.parametrize("text,repo", [
    ("https://github.com/FasterXML/jackson-databind", "FasterXML/jackson-databind"),
    ("scm:git:git@github.com:FasterXML/jackson-databind.git", "FasterXML/jackson-databind"),
    ("https://github.com/google/guava/tree/master/guava", "google/guava"),
    ("scm:git:https://gitbox.apache.org/repos/asf/commons-codec", "apache/commons-codec"),
    ("https://example.org/svn/project", None),
])
def test_github_repo(text, repo):
    assert coverage.github_repo(text) == repo


def test_scm_from_pom_ignores_head_tag():
    pom = POM.format(artifact="commons-codec", props="", url="https://github.com/apache/commons-codec", tag="HEAD")
    assert coverage.scm_from_pom(pom) == ("apache/commons-codec", None)
    pom = POM.format(artifact="x", props="", url="https://example.org", tag="x-1.0")
    assert coverage.scm_from_pom(pom) == ("apache/commons-codec", "x-1.0")   # from <connection>


@pytest.mark.parametrize("tags,artifact,version,repo,pom_tag,expected", [
    # stale <scm><tag> from the previous release is ignored
    ({"rel/commons-lang-3.13.0", "rel/commons-lang-3.14.0"}, "commons-lang3", "3.14.0", "apache/commons-lang",
     "rel/commons-lang-3.13.0", "rel/commons-lang-3.14.0"),
    ({"parent-4.12.0", "parent-4.12.0-RC1"}, "okhttp", "4.12.0", "square/okhttp", None, "parent-4.12.0"),
    ({"version-2.2.224", "version-2.2.222"}, "h2", "2.2.224", "h2database/h2database", None, "version-2.2.224"),
    ({"v_2.0.13", "v_2.0.13-alpha1"}, "slf4j-api", "2.0.13", "qos-ch/slf4j", None, "v_2.0.13"),
    # fallback: ends with the version, prefers tags naming the artifact or repository
    ({"foo-lib-1.2.3", "other-1.2.3", "x1.2.3"}, "lib", "1.2.3", "o/foo", None, "foo-lib-1.2.3"),
    # not part of a longer version, not a pre-release
    ({"lib-11.2.3", "lib-1.2.3.1", "lib-rc-1.2.3M1"}, "lib", "1.2.3", "o/lib", None, None),
])
def test_choose_tag_real_conventions(tags, artifact, version, repo, pom_tag, expected):
    assert coverage.choose_tag(tags, artifact, version, repo, pom_tag) == expected


def test_parent_of():
    pom = ('<project xmlns="http://maven.apache.org/POM/4.0.0"><parent><groupId>com.google.code.gson</groupId>'
           '<artifactId>gson-parent</artifactId><version>2.11.0</version></parent></project>')
    assert coverage.parent_of(pom) == ("com.google.code.gson:gson-parent", "2.11.0")
    assert coverage.parent_of("<project/>") is None


def test_choose_tag_prefers_pom_tag_and_exact_patterns():
    tags = {"commons-codec-1.17.1-RC1", "rel/commons-codec-1.17.1", "commons-codec-1.17.0"}
    assert coverage.choose_tag(tags, "commons-codec", "1.17.1", "apache/commons-codec") == "rel/commons-codec-1.17.1"
    assert coverage.choose_tag({"jackson-databind-2.17.2", "v2.17.2"}, "jackson-databind", "2.17.2",
                               "FasterXML/jackson-databind", pom_tag="jackson-databind-2.17.2") == \
        "jackson-databind-2.17.2"
    assert coverage.choose_tag({"v1.2"}, "lib", "1.2", "o/lib") == "v1.2"
    assert coverage.choose_tag({"lib-1.2-RC1"}, "lib", "1.2", "o/lib") is None


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def test_find_module_and_required_release(tmp_path):
    write(tmp_path / "pom.xml", POM.format(artifact="lib-parent", url="", tag="",
                                           props="<maven.compiler.source>1.7</maven.compiler.source>"))
    write(tmp_path / "core" / "pom.xml", POM.format(artifact="lib-core", url="", tag="", props=""))
    write(tmp_path / "core" / "src" / "test" / "resources" / "pom.xml",
          POM.format(artifact="lib-core", url="", tag="", props=""))   # test resource, not a module
    write(tmp_path / "core-tests" / "pom.xml", POM.format(artifact="lib-core-tests", url="", tag="", props=""))
    root, module, tool = coverage.find_module(tmp_path, "lib-core")
    assert (root, module, tool) == (tmp_path, tmp_path / "core", "maven")
    assert coverage.required_release(module, tmp_path) == 7               # inherited from the parent
    write(tmp_path / "android" / "core-tests" / "pom.xml", POM.format(artifact="lib-core-tests", url="", tag="", props=""))
    assert coverage.test_modules(root, module, "lib-core") == [tmp_path / "core-tests"]   # not android/core-tests
    with pytest.raises(coverage.CoverageError, match="no pom.xml with artifactId"):
        coverage.find_module(tmp_path, "other")


def test_find_module_in_a_subfolder_without_root_pom(tmp_path):
    write(tmp_path / "h2" / "pom.xml", POM.format(artifact="h2", url="", tag="", props=""))
    assert coverage.find_module(tmp_path, "h2") == (tmp_path / "h2", tmp_path / "h2", "maven")


def test_unsupported_build_tool(tmp_path):
    write(tmp_path / "build.xml", "<project/>")
    with pytest.raises(coverage.CoverageError, match="Ant"):
        coverage.find_module(tmp_path, "lombok")


def test_find_gradle_module(tmp_path):
    write(tmp_path / "settings.gradle", "")
    write(tmp_path / "build.gradle", "")
    write(tmp_path / "lib" / "build.gradle", "")
    assert coverage.find_module(tmp_path, "lib") == (tmp_path, tmp_path / "lib", "gradle")
    assert coverage.find_module(tmp_path, "other") == (tmp_path, tmp_path, "gradle")


@pytest.mark.parametrize("value,release", [("1.8", 8), ("17", 17), (" 11 ", 11), ("${java.version}", None), (None, None)])
def test_java_release(value, release):
    assert coverage.java_release(value) == release


def test_jdk_order():
    assert coverage.jdk_order(8, [21, 17, 23]) == [17, 21, 23]
    assert coverage.jdk_order(21, [17, 21, 23]) == [21, 23, 17]
    assert coverage.jdk_order(7, [17, 21]) == [17, 21]       # JDK 21 cannot compile release 7
    assert coverage.jdk_order(None, [17, 8, 21, 11]) == [8, 11, 17, 21]   # unknown release: oldest first


def test_include_patterns(tmp_path):
    jar = tmp_path / "lib.jar"
    with zipfile.ZipFile(jar, "w") as z:
        for name in ["org/example/lib/A.class", "org/example/lib/internal/B.class", "org/other/C.class",
                     "META-INF/versions/9/org/example/lib/A.class"]:
            z.writestr(name, b"")
    assert coverage.include_patterns(jar) == "org.example.lib.*:org.other.*"


def test_test_counts(tmp_path):
    write(tmp_path / "r" / "TEST-a.xml", '<testsuite tests="5" failures="1" errors="0" skipped="2"/>')
    write(tmp_path / "r" / "x" / "TEST-b.xml", '<testsuite tests="3" failures="0" errors="1" skipped="0"/>')
    write(tmp_path / "r" / "TEST-broken.xml", "<testsuite")
    assert coverage.test_counts([tmp_path / "r"]) == {"tests": 8, "failures": 1, "errors": 1, "skipped": 2}


def test_maven_log_counts(tmp_path):
    log = tmp_path / "build.log"
    write(log, "[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0 s -- in a.BTest\n"
               "[ERROR] Tests run: 4131, Failures: 1, Errors: 1, Skipped: 0\n"
               "[INFO] Tests run: 9, Failures: 0, Errors: 0, Skipped: 2\n")
    assert coverage.maven_log_counts(log) == {"tests": 4140, "failures": 1, "errors": 1, "skipped": 2}
    write(log, "[INFO] BUILD FAILURE\n")
    assert coverage.maven_log_counts(log) is None


def test_build_commands_for_a_maven_submodule(tmp_path, monkeypatch):
    monkeypatch.setattr(coverage.shutil, "which", lambda name: "/usr/bin/mvn")
    write(tmp_path / "pom.xml", "")
    steps, classes, reports = coverage.build_commands("maven", tmp_path, tmp_path / "core", 7,
                                                      [tmp_path / "core-tests"])
    prepare, test = steps
    assert prepare[0][1:6] == ["install", "-DskipTests", "-pl", "core,core-tests", "-am"]
    assert prepare[1][1:3] == ["install", "-DskipTests"] and "-pl" not in prepare[1]   # whole project
    assert test[0][1:4] == ["test", "-pl", "core,core-tests"]
    assert "-Dmaven.compiler.source=1.8" in test[0]
    assert not any(a.startswith("-Djava.version") for a in test[0])
    assert classes == [tmp_path / "core" / "target" / "classes"]
    assert reports == [tmp_path / "core" / "target" / "surefire-reports",
                       tmp_path / "core-tests" / "target" / "surefire-reports"]


def test_build_commands_for_a_single_module_project(tmp_path, monkeypatch):
    monkeypatch.setattr(coverage.shutil, "which", lambda name: "/usr/bin/mvn")
    steps, _, _ = coverage.build_commands("maven", tmp_path, tmp_path, 8)
    assert steps == [[["/usr/bin/mvn", "test"] + coverage.MAVEN_FLAGS]]


@pytest.mark.parametrize("line,name", [
    ("[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0 s -- in org.a.CharsetsTest", "org.a.CharsetsTest"),
    ("Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 sec - in com.x.FooTest", "com.x.FooTest"),
    ("Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.039 sec", None),
])
def test_test_class_done_formats(line, name):
    assert coverage.TEST_CLASS_DONE.search(line).group(1) == name


def test_totals_line_is_not_a_finished_class():
    assert coverage.TEST_CLASS_DONE.search("[WARNING] Tests run: 1716, Failures: 0, Errors: 0, Skipped: 2") is None


def test_progress_reports_classes_in_both_surefire_formats(tmp_path):
    events = []
    script = tmp_path / "fake-build.sh"
    script.write_text("#!/bin/sh\n"
                      "echo 'Running com.g.AsciiTest'\n"
                      "echo 'Tests run: 9, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.005 sec'\n"
                      "echo '[INFO] Tests run: 2, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0 s -- in a.BTest'\n")
    script.chmod(0o755)
    timed_out = coverage.run_build([[[str(script)]]], tmp_path, "/nonexistent", "", tmp_path / "log", 30,
                                   progress=lambda stage, detail: events.append((stage, detail)))
    assert not timed_out
    assert [d for s, d in events if s == "tests"] == ["1 test classes done (last: AsciiTest)",
                                                      "2 test classes done (last: BTest)"]


def test_timeout_stops_the_whole_process_group(tmp_path):
    script = tmp_path / "slow.sh"
    script.write_text("#!/bin/sh\nsleep 30 &\nsleep 30\n")
    script.chmod(0o755)
    with open(tmp_path / "log", "w") as log:
        assert coverage.run_logged([str(script)], tmp_path, None, log, timeout=1) is None


def test_first_error_skips_maven_boilerplate(tmp_path):
    log = tmp_path / "build.log"
    write(log, "[INFO] Building\n[ERROR] \n[ERROR] Failed to execute goal compile: Source option 7 is no longer "
               "supported. Use 8 or later.\n[ERROR] -> [Help 1]\n")
    assert coverage.first_error(log).startswith("Failed to execute goal compile: Source option 7")
    write(log, "FAILURE: Build failed with an exception.\n\n* What went wrong:\nUnsupported class file major version 65\n")
    assert coverage.first_error(log) == "Unsupported class file major version 65"
    write(log, "[INFO] BUILD SUCCESS\n")
    assert coverage.first_error(log) is None


def test_every_failure_status_has_a_hint():
    statuses = {"no_repository", "no_tag", "clone_failed", "no_build", "no_module", "build_tool_missing",
                "no_jdk", "build_failed", "timeout", "no_coverage", "report_failed", "error"}
    assert statuses <= set(coverage.HINTS)
    assert "--jdk" in coverage.hint("build_failed") and coverage.ISSUES_URL in coverage.hint("build_failed")


def test_reason_is_plain_and_the_error_is_raw():
    summary = {"status": "no_repository", "version": "1.6.1", "detail": "no GitHub repository in the POM's <scm>"}
    assert coverage.reason(summary).startswith("The library's POM on Maven Central does not link to a GitHub")
    assert coverage.error_details(summary) == "no GitHub repository in the POM's <scm>"

    summary = {"status": "build_failed", "jdks_tried": [8, 11, 8], "detail": "no tests ran with JDK 8, 11",
               "attempts": [{"jdk": 8, "disabled_profiles": [], "reason": "Source option 5 is no longer supported."},
                            {"jdk": 8, "disabled_profiles": ["java9+"], "reason": "no tests ran"}]}
    assert coverage.reason(summary) == ("We could not build the library's source code and run its tests "
                                        "(tried Java 8, 11).")
    assert coverage.error_details(summary) == ("JDK 8: Source option 5 is no longer supported.\n"
                                               "JDK 8 without JDK profiles: no tests ran")

    assert coverage.reason({"status": "timeout"}, timeout=2700) == (
        "The library's tests did not finish within our time limit of 45 minutes.")
    assert "problem on our side" in coverage.reason({"status": "no_jdk"})
    assert coverage.reason({"status": "ok"}) is None and coverage.error_details({"status": "ok"}) is None


def test_first_error_skips_headers(tmp_path):
    log = tmp_path / "build.log"
    write(log, "[ERROR] COMPILATION ERROR : \n[INFO] ----\n[ERROR] invalid source release 14 with --enable-preview\n")
    assert coverage.first_error(log) == "invalid source release 14 with --enable-preview"


def test_jdk_profiles(tmp_path):
    write(tmp_path / "pom.xml", """<project xmlns="http://maven.apache.org/POM/4.0.0"><artifactId>lib</artifactId>
      <profiles>
        <profile><id>java14+</id><activation><jdk>[14,)</jdk></activation></profile>
        <profile><id>release</id><activation><property><name>release</name></property></activation></profile>
        <profile><id>no-activation</id></profile>
      </profiles></project>""")
    assert coverage.jdk_profiles(tmp_path) == ["java14+"]


def test_build_commands_can_disable_profiles(tmp_path, monkeypatch):
    monkeypatch.setattr(coverage.shutil, "which", lambda name: "/usr/bin/mvn")
    steps, _, _ = coverage.build_commands("maven", tmp_path, tmp_path, 8, disabled_profiles=("java14+", "jdk9"))
    assert "-P!java14+,!jdk9" in steps[0][0]


def test_a_library_without_a_repository_gets_a_plain_reason(tmp_path, monkeypatch):
    # dom4j 1.6.1 has no GitHub repository in its POM. This once crashed instead of saying so.
    from ossbridge_pipeline.workspace import Workspace
    ws = Workspace("dom4j:dom4j", "1.6.1", root=tmp_path / "runs")
    ws.library_jar.parent.mkdir(parents=True, exist_ok=True)
    ws.library_jar.write_bytes(b"jar")

    def no_repository(*args, **kwargs):
        raise coverage.CoverageError("no_repository", "no GitHub repository in the POM")
    monkeypatch.setattr(coverage, "resolve_source", no_repository)

    summary = coverage.measure_coverage(ws)
    assert summary["status"] == "no_repository"
    assert summary["reason"].startswith("The library's POM on Maven Central does not link to a GitHub")
    assert json.loads(ws.coverage_json.read_text())["status"] == "no_repository"


LOOKUP = """# comment
library,repository,tag,reason
commons-lang:commons-lang,apache/commons-lang,LANG_{version_},
org.example:no-source,,,Its source code is not public.
"""


def test_source_lookup_gives_the_repository_and_tag_pattern(tmp_path, monkeypatch):
    lookup = tmp_path / "lookup.csv"
    lookup.write_text(LOOKUP)
    monkeypatch.setattr(coverage, "LOOKUP_FILE", lookup)
    monkeypatch.setattr(coverage, "scm_with_parents", lambda *args: (None, None))
    monkeypatch.setattr(coverage, "remote_tags", lambda repo: {"LANG_2_5", "LANG_2_6"})

    assert coverage.source_lookup("org.example:other") == {}
    assert coverage.resolve_source("commons-lang:commons-lang", "2.6") == ("apache/commons-lang", "LANG_2_6")
    with pytest.raises(coverage.CoverageError):
        coverage.resolve_source("org.example:no-source", "1.0")


def test_source_lookup_reason_replaces_the_general_reason(tmp_path, monkeypatch):
    lookup = tmp_path / "lookup.csv"
    lookup.write_text(LOOKUP)
    monkeypatch.setattr(coverage, "LOOKUP_FILE", lookup)

    assert coverage.reason({"library": "org.example:no-source", "status": "no_repository"}) == \
        "Its source code is not public."
    assert coverage.reason({"library": "org.example:no-source", "status": "ok"}) is None
    assert coverage.reason({"library": "commons-lang:commons-lang", "status": "no_tag"}).startswith("We found")


def test_source_lookup_file_is_valid():
    lookup = coverage.source_lookup("log4j:log4j")
    assert lookup["repository"] == "apache/logging-log4j1"
