import csv
import functools
import io
import sys
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import download_jars  # noqa: E402
from ossbridge_pipeline.coords import jar_file_name, jar_url, parse_release  # noqa: E402
from ossbridge_pipeline.workspace import Workspace  # noqa: E402


def make_jar(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name in entries:
            z.writestr(name, b"x")
    return buf.getvalue()


JAR = make_jar(["com/acme/App.class"])
RESOURCES_ONLY = make_jar(["META-INF/MANIFEST.MF", "config.properties"])


@pytest.fixture
def repo(tmp_path):
    """A local Maven-style repository served over HTTP."""
    root = tmp_path / "repo"
    files = {
        "com.acme:app:1.0": JAR,
        "com.acme:resources:1.0": RESOURCES_ONLY,
        "com.acme:broken:1.0": b"<html>not a jar</html>",
        "com.acme:already:1.0": JAR,
        "com.acme:truncated:1.0": JAR,
    }
    for release_id, content in files.items():
        url_path = jar_url(*parse_release(release_id), base_url="")
        path = root / url_path.lstrip("/")
        path.parent.mkdir(parents=True)
        path.write_bytes(content)

    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a: None
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def write_dependents(path, release_ids):
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["release_id", "artifact_id"])
        writer.writerows([rid, "lib:lib"] for rid in release_ids)


def read_status(path):
    with open(path, newline="") as f:
        return {row["release_id"]: row for row in csv.DictReader(f)}


def test_coordinates():
    assert parse_release("org.slf4j:slf4j-api:2.0.13") == ("org.slf4j", "slf4j-api", "2.0.13")
    with pytest.raises(ValueError):
        parse_release("org.slf4j:slf4j-api")
    assert jar_file_name("cloud.pangea", "pangea-sdk", "3.12.0") == "cloud_pangea-pangea-sdk-3.12.0.jar"
    assert jar_url("org.slf4j", "slf4j-api", "2.0.13") == (
        "https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.13/slf4j-api-2.0.13.jar")


def test_download_records_one_status_per_dependent(repo, tmp_path):
    out = tmp_path / "jars"
    out.mkdir()
    (out / jar_file_name("com.acme", "already", "1.0")).write_bytes(JAR)
    (out / jar_file_name("com.acme", "truncated", "1.0")).write_bytes(JAR[:20])  # partial earlier download

    dependents = tmp_path / "dependents.csv"
    write_dependents(dependents, [
        "com.acme:app:1.0", "com.acme:resources:1.0", "com.acme:broken:1.0",
        "com.acme:missing:1.0", "com.acme:already:1.0", "com.acme:truncated:1.0",
        "com.acme:app:1.0", "not-a-coordinate",
    ])
    calls = []
    summary = download_jars.download_dependent_jars(
        dependents, out, tmp_path / "status.csv", workers=3, base_url=repo,
        progress=lambda done, total, r: calls.append((done, total)))

    assert summary == {"total": 7, "downloaded": 2, "present": 1, "no_classes": 1,
                       "not_found": 1, "failed": 2}
    status = read_status(tmp_path / "status.csv")
    assert {k: v["status"] for k, v in status.items()} == {
        "com.acme:app:1.0": "downloaded",
        "com.acme:resources:1.0": "no_classes",
        "com.acme:broken:1.0": "failed",
        "com.acme:missing:1.0": "not_found",
        "com.acme:already:1.0": "present",
        "com.acme:truncated:1.0": "downloaded",
        "not-a-coordinate": "failed",
    }
    assert list(status) == ["com.acme:app:1.0", "com.acme:resources:1.0", "com.acme:broken:1.0",
                            "com.acme:missing:1.0", "com.acme:already:1.0", "com.acme:truncated:1.0",
                            "not-a-coordinate"]
    assert (out / "com_acme-truncated-1.0.jar").read_bytes() == JAR
    assert not (out / "com_acme-broken-1.0.jar").exists()
    assert not list(out.glob("*.part"))
    assert calls[-1] == (7, 7)


def test_second_run_downloads_nothing(repo, tmp_path):
    dependents = tmp_path / "dependents.csv"
    write_dependents(dependents, ["com.acme:app:1.0"])
    out = tmp_path / "jars"
    download_jars.download_dependent_jars(dependents, out, tmp_path / "s.csv", base_url=repo)
    again = download_jars.download_dependent_jars(dependents, out, tmp_path / "s.csv", base_url=repo)
    assert again["present"] == 1 and again["downloaded"] == 0


def test_run_uses_workspace_paths(repo, tmp_path):
    ws = Workspace("lib:lib", "1.0", root=tmp_path / "runs")
    ws.dir.mkdir(parents=True)
    write_dependents(ws.dependents_csv, ["com.acme:app:1.0"])
    summary = download_jars.run(ws, base_url=repo)
    assert summary["downloaded"] == 1
    assert ws.dir.name == "lib__lib@1.0"
    assert (ws.dependent_jars_dir / "com_acme-app-1.0.jar").exists()
    assert ws.dependent_jars_status.exists()
