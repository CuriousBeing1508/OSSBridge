import csv
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import build_index  # noqa: E402
import select_dependents  # noqa: E402
from ossbridge_pipeline.candidates import CANDIDATE_COLUMNS, random_order, rank_candidates  # noqa: E402

LIB = "org.example:lib"


def write_raw(raw_dir, rows):
    """rows: (library_ga, library_version, scope, dependent_release, release_ts)"""
    writer = build_index.RawWriter(raw_dir, batch_size=2)
    for row in rows:
        writer.add(*row)
    writer.flush()


@pytest.fixture
def index(tmp_path):
    rows = [
        # app:core has three releases depending on lib 1.0 -> collapsed to the latest
        (LIB, "1.0", "compile", "com.acme:core:1.0", 100),
        (LIB, "1.0", "compile", "com.acme:core:1.1", 300),
        (LIB, "1.0", "compile", "com.acme:core:1.2", 200),
        (LIB, "1.0", "compile", "com.acme:core:1.2", 200),  # duplicate edge
        (LIB, "1.0", "test", "com.acme:tests-only:1.0", 100),
        (LIB, "1.0", None, "org.small:a:1.0", 100),
        (LIB, "1.0", None, "org.small:b:1.0", 100),
        (LIB, "1.0", None, "net.other:c:2.0", 100),
        (LIB, "2.0", "compile", "com.acme:core:2.0", 400),
        # com.acme:core is itself depended on by two projects -> reach 2
        ("com.acme:core", "1.1", "compile", "x.y:user1:1.0", 100),
        ("com.acme:core", "1.1", "compile", "x.y:user2:1.0", 100),
        ("com.acme:core", "1.2", "compile", "x.y:user2:1.1", 100),
    ]
    raw = tmp_path / "_raw"
    write_raw(raw, rows)
    out = tmp_path / "index"
    out.mkdir()
    manifest = build_index.finalize(raw, out, {"type": "test"})
    return out, manifest


def test_finalize_dedupes_and_computes_reach(index):
    out, manifest = index
    assert manifest["edges"] == 11
    assert manifest["libraries"] == 2

    import duckdb
    reach = dict(duckdb.sql(f"SELECT ga, reach FROM '{out}/reach.parquet'").fetchall())
    assert reach == {LIB: 5, "com.acme:core": 2}


def test_load_dependents_filters_test_scope_and_collapses(index):
    out, _ = index
    counts, deps = select_dependents.load_dependents(str(out), LIB, "1.0")
    assert counts == {"releases": 7, "releases_non_test": 6, "projects": 4}

    by_ga = {d["dependent_ga"]: d for d in deps}
    assert "com.acme:tests-only" not in by_ga
    assert by_ga["com.acme:core"]["dependent_version"] == "1.1"  # latest by timestamp
    assert deps[0]["dependent_ga"] == "com.acme:core"  # highest reach first
    assert by_ga["com.acme:core"]["reach"] == 2


def test_include_test_scope(index):
    out, _ = index
    counts, deps = select_dependents.load_dependents(str(out), LIB, "1.0", include_test_scope=True)
    assert counts["projects"] == 5
    assert any(d["dependent_ga"] == "com.acme:tests-only" for d in deps)


def test_only_dependents_with_reach_are_ranked_by_reach(index):
    out, _ = index
    _, deps = select_dependents.load_dependents(str(out), LIB, "1.0")
    ranked = {d["dependent_ga"]: d for d in rank_candidates(deps, seed=1)}
    assert ranked["com.acme:core"]["rank_reach"] == 1
    assert [d["rank_reach"] for d in ranked.values()].count(None) == 3
    assert sorted(d["rank_random"] for d in ranked.values()) == [1, 2, 3, 4]


def test_random_order_is_seeded_and_independent_of_input_order():
    deps = [{"dependent_ga": f"g{g}:a{i}", "reach": 0} for g in range(3) for i in range(5)]
    first = random_order(deps, seed=7)
    assert first == random_order(list(reversed(deps)), seed=7)
    assert first != random_order(deps, seed=8)
    assert sorted(d["dependent_ga"] for d in first) == sorted(d["dependent_ga"] for d in deps)


def test_from_csv_parses_version_and_timestamp(tmp_path):
    csv_dir = tmp_path / "csvs"
    csv_dir.mkdir()
    with open(csv_dir / f"{LIB}-1.0-RC.2.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["release_id", "dependency", "artifact_id"])
        w.writerow(["com.acme:core:1.0",
                    "({'id': 'com.acme:core:1.0', 'version': '1.0', 'timestamp': 1713152911000}, "
                    "'dependency', {'found': True, 'id': 'org.example:lib'})", LIB])
    writer = build_index.RawWriter(tmp_path / "_raw", batch_size=10)
    build_index.export_from_csv(writer, csv_dir)
    assert writer.rows["library_version"] == ["1.0-RC.2"]
    assert writer.rows["release_ts"] == [1713152911000]


def test_cli_writes_candidates_and_summary(index, tmp_path, monkeypatch):
    out, _ = index
    target = tmp_path / "sel" / "candidates.csv"
    monkeypatch.setattr(sys, "argv", [
        "select_dependents.py", "--index", str(out), "--library", LIB,
        "--version", "1.0", "--out", str(target),
    ])
    select_dependents.main()

    rows = list(csv.DictReader(open(target)))
    assert list(rows[0]) == CANDIDATE_COLUMNS
    assert rows[0]["release_id"] == "com.acme:core:1.1"
    assert rows[0]["rank_reach"] == "1"
    assert len(rows) == 4
    summary = json.loads(target.with_suffix(".summary.json").read_text())
    assert summary["dependent_projects"] == 4
    assert summary["ranked_by_reach"] == 1


def test_validate_helpers(tmp_path):
    import validate_sampling

    assert validate_sampling.jar_key("cloud.pangea:pangea-sdk:3.12.0") == "cloud_pangea-pangea-sdk-3.12.0"
    assert validate_sampling.kendall_tau([3, 2, 1], [30, 20, 10]) == 1.0
    assert validate_sampling.kendall_tau([3, 2, 1], [10, 20, 30]) == -1.0

    deps_csv = tmp_path / "deps.csv"
    deps_csv.write_text("release_id\ncom.acme:core:1.0\ncom.acme:core:1.1\n")
    dep_dir = tmp_path / "Dependents"
    dep_dir.mkdir()
    for version, usage in (("1.0", "org.example.lib.Old.m : ()V"), ("1.1", "org.example.lib.New.m : ()V")):
        (dep_dir / f"com_acme-core-{version}_third_party_calls.csv").write_text(
            "JarFile,CallerClass,Usage,Category\n"
            f"x.jar,C,{usage},METHOD_CALL\n"
            "x.jar,C,org.other.Thing.m : ()V,METHOD_CALL\n")
    projects, unmatched = validate_sampling.load_projects(dep_dir, deps_csv, "org.example.lib")
    assert unmatched == 0
    assert projects == {"com.acme:core": {"org.example.lib.New.m : ()V"}}
