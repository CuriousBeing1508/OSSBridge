import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_index  # noqa: E402
import goblin  # noqa: E402
import select_dependents  # noqa: E402

LIB = "org.example:lib"

# Goblin-shaped graph: releases -> dependency {targetVersion, scope} -> artifacts
RELEASES = {  # release id -> timestamp
    "com.acme:core:1.0": 100, "com.acme:core:1.1": 300, "com.acme:tests:1.0": 100,
    "org.small:a:1.0": 100, "x.y:user1:1.0": 100, "x.y:user2:1.0": 100,
}
DEPENDENCIES = [  # (release, artifact, targetVersion, scope)
    ("com.acme:core:1.0", LIB, "1.0", "compile"),
    ("com.acme:core:1.1", LIB, "1.0", "compile"),
    ("com.acme:tests:1.0", LIB, "1.0", "test"),
    ("org.small:a:1.0", LIB, "2.0", "runtime"),
    ("x.y:user1:1.0", "com.acme:core", "1.1", "compile"),
    ("x.y:user2:1.0", "com.acme:core", "1.0", "compile"),
]
ARTIFACTS = {LIB, "com.acme:core", "org.other:no-dependents"}


class FakeResult(list):
    def single(self):
        return self[0]

    def consume(self):
        return None


class FakeSession:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def run(self, query, **params):
        if query.startswith("CREATE INDEX"):
            return FakeResult()
        if query == goblin.EDGES_ONE:
            return FakeResult(
                {"library_ga": a, "library_version": v, "scope": s,
                 "dependent_release": r, "release_ts": RELEASES[r]}
                for r, a, v, s in DEPENDENCIES if a == params["library"])
        if query == goblin.REACH:
            return FakeResult(
                {"ga": ga, "reach": len({r.rsplit(":", 1)[0] for r, a, _, _ in DEPENDENCIES if a == ga})}
                for ga in params["gas"] if any(a == ga for _, a, _, _ in DEPENDENCIES))
        if query == goblin.STATUS:
            return FakeResult([{"artifact_found": params["library"] in ARTIFACTS,
                                "release_found": params["release"] in RELEASES,
                                "release_ts": RELEASES.get(params["release"])}])
        raise AssertionError(f"unexpected query: {query}")


class FakeDriver:
    def session(self):
        return FakeSession()

    def close(self):
        pass


@pytest.fixture
def fake_neo4j(monkeypatch):
    monkeypatch.setattr(goblin, "connect", lambda *a, **k: FakeDriver())


def test_add_library_writes_edges_reach_and_manifest(tmp_path, fake_neo4j):
    entry = build_index.add_library(tmp_path, LIB)
    assert entry["edges"] == 4
    assert entry["versions"] == 2
    assert entry["dependents"] == 2  # com.acme:core, org.small:a (test scope excluded)

    lib_dir = tmp_path / "added" / "org.example__lib"
    assert (lib_dir / "edges.parquet").exists()
    import duckdb
    reach = dict(duckdb.sql(f"SELECT ga, reach FROM '{lib_dir}/reach.parquet'").fetchall())
    assert reach == {"com.acme:core": 2}

    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert LIB in manifest["added"]
    assert not (tmp_path / "_raw").exists()


def test_add_library_without_dependents_returns_none(tmp_path, fake_neo4j):
    assert build_index.add_library(tmp_path, "org.other:no-dependents") is None
    assert not (tmp_path / "added").exists()


def test_added_library_is_selectable_with_exact_reach(tmp_path, fake_neo4j):
    build_index.add_library(tmp_path, LIB)
    counts, deps = select_dependents.load_dependents(str(tmp_path), LIB, "1.0")
    assert counts == {"releases": 3, "releases_non_test": 2, "projects": 1}
    assert deps == [{"dependent_ga": "com.acme:core", "dependent_version": "1.1",
                     "release_ts": 300, "reach": 2}]


def test_added_library_merges_with_base_index_without_double_counting(tmp_path, fake_neo4j):
    writer = build_index.RawWriter(tmp_path / "_raw", batch_size=10)
    writer.add(LIB, "1.0", None, "com.acme:core:1.1", 300)  # also returned by Neo4j
    writer.flush()
    build_index.finalize(tmp_path / "_raw", tmp_path, {"type": "test"})
    build_index.add_library(tmp_path, LIB)

    counts, deps = select_dependents.load_dependents(str(tmp_path), LIB, "1.0")
    assert counts["projects"] == 1
    assert deps[0]["reach"] == 2  # max of base (0) and Neo4j (2)


def run_cli(monkeypatch, index, library, version, out, *extra):
    monkeypatch.setattr(sys, "argv", [
        "select_dependents.py", "--index", str(index), "--library", library,
        "--version", version, "--out", str(out), *extra])
    select_dependents.main()


def test_fetch_missing_adds_library_on_demand(tmp_path, fake_neo4j, monkeypatch):
    out = tmp_path / "sel.csv"
    with pytest.raises(SystemExit, match="--fetch-missing"):
        run_cli(monkeypatch, tmp_path / "index", LIB, "1.0", out)

    run_cli(monkeypatch, tmp_path / "index", LIB, "1.0", out, "--fetch-missing")
    assert "com.acme:core:1.1" in out.read_text()


@pytest.mark.parametrize("library,version,reason", [
    ("org.unknown:lib", "1.0", "not in the Goblin snapshot"),
    (LIB, "9.9", "released after the snapshot"),
])
def test_fetch_missing_explains_why_nothing_was_found(tmp_path, fake_neo4j, monkeypatch,
                                                      library, version, reason):
    with pytest.raises(SystemExit, match=reason):
        run_cli(monkeypatch, tmp_path, library, version, tmp_path / "sel.csv", "--fetch-missing")


def test_describe_missing_when_release_exists_without_dependents():
    status = {"artifact_found": True, "release_found": True, "release_ts": 1}
    assert "no release in the snapshot depends on it" in goblin.describe_missing(status, LIB, "1.0")


# --- Integration test against a real, empty Neo4j 4.4 -------------------------
# docker run --rm -d -p 17687:7687 -e NEO4J_AUTH=neo4j/test neo4j:4.4.36-community
# NEO4J_TEST_URI=bolt://localhost:17687 NEO4J_TEST_PASSWORD=test pytest tests/test_goblin.py

@pytest.mark.skipif("NEO4J_TEST_URI" not in os.environ, reason="NEO4J_TEST_URI not set")
def test_against_real_neo4j(tmp_path, monkeypatch):
    uri, password = os.environ["NEO4J_TEST_URI"], os.environ.get("NEO4J_TEST_PASSWORD", "test")
    driver = goblin.connect(uri, "neo4j", password)
    with driver.session() as session:
        session.run("MATCH (n) DETACH DELETE n").consume()
        session.run("UNWIND $ids AS id CREATE (:Artifact {id: id, found: true})", ids=sorted(ARTIFACTS)).consume()
        session.run("""
            UNWIND $releases AS rel
            CREATE (r:Release {id: rel.id, version: rel.version, timestamp: rel.ts})
            WITH r, rel
            MATCH (a:Artifact {id: rel.ga}) CREATE (a)-[:relationship_AR]->(r)
        """, releases=[{"id": r, "ga": r.rsplit(":", 1)[0], "version": r.rsplit(":", 1)[1], "ts": ts}
                       for r, ts in RELEASES.items()]).consume()
        session.run("UNWIND $ids AS id MERGE (:Artifact {id: id})",
                    ids=sorted({r.rsplit(":", 1)[0] for r in RELEASES})).consume()
        session.run("""
            UNWIND $deps AS dep
            MATCH (r:Release {id: dep.release}), (a:Artifact {id: dep.artifact})
            CREATE (r)-[:dependency {targetVersion: dep.version, scope: dep.scope}]->(a)
        """, deps=[{"release": r, "artifact": a, "version": v, "scope": s}
                   for r, a, v, s in DEPENDENCIES]).consume()
    goblin.ensure_indexes(driver)
    goblin.ensure_indexes(driver)  # idempotent

    entry = build_index.add_library(tmp_path, LIB, driver=driver)
    assert entry["edges"] == 4
    counts, deps = select_dependents.load_dependents(str(tmp_path), LIB, "1.0")
    assert counts == {"releases": 3, "releases_non_test": 2, "projects": 1}
    assert deps[0]["reach"] == 2

    assert goblin.describe_missing(goblin.library_status(driver, LIB, "9.9"), LIB, "9.9").endswith(
        "released after the snapshot")
    assert "not in the Goblin snapshot" in goblin.describe_missing(
        goblin.library_status(driver, "no:such", "1"), "no:such", "1")
    driver.close()
