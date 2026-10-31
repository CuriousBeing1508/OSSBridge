import csv
import functools
import json
import shutil
import subprocess
import sys
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import collect, usage_analysis, verify  # noqa: E402
from ossbridge_pipeline.candidates import CANDIDATE_COLUMNS  # noqa: E402
from ossbridge_pipeline.coords import jar_url  # noqa: E402
from ossbridge_pipeline.workspace import Workspace  # noqa: E402

FIXTURES = (Path(__file__).resolve().parents[1] / "JavaUsageExtractor" / "asm-based-analysis"
            / "src" / "test" / "resources" / "fixtures")

pytestmark = pytest.mark.skipif(
    shutil.which("javac") is None or not usage_analysis.DEFAULT_ANALYZER.exists(),
    reason="needs a JDK and the built analyzer (./mvnw package)")

# (dependent, reach, rank_random, uses the library?) ; "missing" has no jar on the repository
CANDIDATES = [
    ("g1:u1", 10, 7, True),
    ("g1:u2", 9, 8, True),
    ("g1:u3", 8, 6, True),
    ("g2:n1", 7, 5, False),
    ("g3:u4", 6, 4, True),
    ("g4:missing", 5, 1, None),
    ("g5:u5", 0, 2, True),
    ("g6:u6", 0, 3, True),
]


def jar_dir(classes, out_jar):
    out_jar.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_jar, "w") as jar:
        for p in sorted(classes.rglob("*.class")):
            jar.write(p, p.relative_to(classes).as_posix())


def javac(sources, out, classpath=None):
    out.mkdir(parents=True)
    cmd = ["javac", "--release", "17", "-d", str(out)] + (["-cp", str(classpath)] if classpath else [])
    subprocess.run(cmd + [str(s) for s in sources], check=True)
    return out


@pytest.fixture
def setup(tmp_path):
    """Local Maven repository with the library and the candidate jars, plus a workspace."""
    repo = tmp_path / "repo"
    lib_classes = javac(list((FIXTURES / "library").rglob("*.java")), tmp_path / "lib-classes")
    jar_dir(lib_classes, repo / jar_url("org.example", "lib", "1.0", base_url="").lstrip("/"))

    src = tmp_path / "src"
    for ga, _, _, uses in CANDIDATES:
        if uses is None:
            continue
        group, artifact = ga.split(":")
        body = "Object run() { return org.example.lib.Codec.create(); }" if uses else "int run() { return 1; }"
        (src / artifact).mkdir(parents=True)
        (src / artifact / "Main.java").write_text(f"package {artifact}; public class Main {{ {body} }}\n")
        classes = javac([src / artifact / "Main.java"], tmp_path / "classes" / artifact, lib_classes)
        jar_dir(classes, repo / jar_url(group, artifact, "1.0", base_url="").lstrip("/"))

    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(repo))
    handler.log_message = lambda *a: None
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    ws = Workspace("org.example:lib", "1.0", root=tmp_path / "runs")
    ws.dir.mkdir(parents=True)
    with open(ws.candidates_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CANDIDATE_COLUMNS)
        writer.writeheader()
        for ga, reach, rank_random, _ in CANDIDATES:
            group, artifact = ga.split(":")
            rank_reach = sorted([c for c in CANDIDATES if c[1] > 0], key=lambda c: -c[1]).index(
                next(c for c in CANDIDATES if c[0] == ga)) + 1 if reach > 0 else ""
            writer.writerow({"release_id": f"{ga}:1.0", "artifact_id": "org.example:lib", "depGroupId": group,
                             "depArtifactId": artifact, "Depversion": "1.0", "reach": reach, "release_ts": "",
                             "rank_reach": rank_reach, "rank_random": rank_random})
    yield ws, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def read_dependents(ws):
    with open(ws.dependents_csv, newline="") as f:
        return {row["release_id"].rsplit(":", 1)[0]: row for row in csv.DictReader(f)}


def test_collects_top_then_random(setup):
    ws, repo = setup
    events = []
    summary = collect.collect_using_dependents(ws, target=4, top_target=3, batch_size=2,
                                               base_url=repo, progress=events.append)

    deps = read_dependents(ws)
    selected = {ga: row["tier"] for ga, row in deps.items() if row["selected"] == "True"}
    assert selected == {"g1:u1": "A", "g1:u2": "A", "g1:u3": "A", "g5:u5": "B"}
    assert "g3:u4" not in deps                     # target reached before it was tried
    assert deps["g2:n1"]["reason"] == "no library usage"
    assert deps["g4:missing"]["reason"] == "jar not_found"

    assert summary["tried"] == 6
    assert summary["jar_available"] == 5
    assert summary["using_library"] == 4
    assert summary["using_share_pct"] == 80.0
    assert (summary["selected_top"], summary["selected_random"]) == (3, 1)
    assert summary["stop_reasons"] == {"top": "target_reached", "random": "target_reached"}
    assert summary["reach_covered_pct"] == round(100 * 27 / 45, 1)
    assert json.loads(ws.collection_json.read_text())["selected"] == 4
    assert events[-1]["selected"] == 4

    with open(ws.usage_csv, newline="") as f:
        usage_jars = {row["dependent_jar"] for row in csv.DictReader(f)}
    assert usage_jars == {"g1-u1-1.0.jar", "g1-u2-1.0.jar", "g1-u3-1.0.jar", "g5-u5-1.0.jar"}
    with open(ws.usage_summary_csv, newline="") as f:
        assert len(list(csv.DictReader(f))) == 5     # every analyzed jar
    with open(ws.dependent_jars_status, newline="") as f:
        status = list(csv.DictReader(f))
    assert len(status) == 6                          # every tried candidate
    assert all(len(r["sha256"]) == 64 for r in status if r["status"] == "downloaded")

    assert summary["target_reached"] and summary["shortfall"] == 0
    assert len(summary["library_jar_sha256"]) == 64 and len(summary["analyzer_jar_sha256"]) == 64
    assert not ws.dependent_jars_dir.exists()        # all jars deleted after the analysis


def test_keep_jars_keeps_only_selected_dependents(setup):
    ws, repo = setup
    collect.collect_using_dependents(ws, target=4, top_target=3, batch_size=2,
                                     base_url=repo, keep_jars=True)
    assert sorted(p.name for p in ws.dependent_jars_dir.iterdir()) == [
        "g1-u1-1.0.jar", "g1-u2-1.0.jar", "g1-u3-1.0.jar", "g5-u5-1.0.jar"]


def test_stops_at_the_budget(setup):
    ws, repo = setup
    summary = collect.collect_using_dependents(ws, target=4, top_target=3, batch_size=2,
                                               max_tried=3, base_url=repo)
    assert summary["tried"] == 3
    assert summary["stop_reasons"] == {"top": "target_reached", "random": "max_tried"}
    assert summary["message"].startswith("Found 3 of 4") and "max_tried" in summary["message"]


def test_reports_when_candidates_run_out(setup):
    ws, repo = setup
    summary = collect.collect_using_dependents(ws, target=20, top_target=10, batch_size=3,
                                               base_url=repo)
    assert summary["stop_reasons"] == {"top": "candidates_exhausted", "random": "candidates_exhausted"}
    assert summary["selected"] == 6                 # every candidate that uses the library
    assert not summary["target_reached"] and summary["shortfall"] == 14
    assert summary["message"] == ("Found 6 of 20 dependents that use the library: all 8 candidates were tried; "
                                  "no more dependents of this version are known.")


def test_verify_reproduces_and_detects_changes(setup):
    ws, repo = setup
    collect.collect_using_dependents(ws, target=4, top_target=3, batch_size=2, base_url=repo)

    result = verify.verify(ws, sample=10, base_url=repo)
    assert result["ok"] and result["checked"] == 4 and not result["analyzer_changed"]

    rows = list(csv.DictReader(open(ws.usage_csv, newline="")))
    rows[0]["occurrences"] = "999"
    with open(ws.usage_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=usage_analysis.USAGE_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    result = verify.verify(ws, sample=10, base_url=repo)
    assert not result["ok"]
    assert result["usage_mismatches"] == [rows[0]["dependent_jar"]]
