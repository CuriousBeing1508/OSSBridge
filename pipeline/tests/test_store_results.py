import csv
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import result_tables, store_results  # noqa: E402
from ossbridge_pipeline.api_coverage import API_COVERAGE_COLUMNS  # noqa: E402
from ossbridge_pipeline.download_jars import STATUS_COLUMNS  # noqa: E402
from ossbridge_pipeline.public_api import API_COLUMNS  # noqa: E402
from ossbridge_pipeline.usage_analysis import SUMMARY_COLUMNS, USAGE_COLUMNS  # noqa: E402
from ossbridge_pipeline.workspace import Workspace  # noqa: E402

GA, V, P = "org.example:lib", "1.0", "org.example.lib."


def write_csv(path, columns, rows):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in rows:
            writer.writerow({c: "" for c in columns} | row)


def make_run(tmp_path, with_coverage=True):
    ws = Workspace(GA, V, root=tmp_path / "runs")
    ws.dir.mkdir(parents=True)
    with zipfile.ZipFile(ws.library_jar, "w") as z:
        z.writestr("org/example/lib/Codec.class", b"")
        z.writestr("org/example/lib/internal/Util.class", b"")
    write_csv(ws.apis_csv, API_COLUMNS, [
        {"api_id": P + "Codec.encode([B)[B", "package": "org.example.lib", "class_name": "Codec",
         "member": "encode", "descriptor": "([B)[B", "kind": "method", "visibility": "public", "static": "false",
         "abstract": "false", "class_kind": "class", "deprecated": "true", "deprecated_for_removal": "false",
         "class_deprecated": "false", "exported": "true"},
        {"api_id": P + "Codec.MAX:I", "package": "org.example.lib", "class_name": "Codec", "member": "MAX",
         "descriptor": "I", "kind": "field", "visibility": "public", "static": "true", "abstract": "false",
         "class_kind": "class", "deprecated": "false", "deprecated_for_removal": "false",
         "class_deprecated": "false", "exported": "true"},
    ])
    write_csv(ws.candidates_csv, ["release_id", "release_ts"], [
        {"release_id": "com.acme:app:2.0", "release_ts": "1700000000000"},
        {"release_id": "com.other:tool:1.0", "release_ts": ""},
    ])
    write_csv(ws.dependents_csv, ["release_id", "dependent_ga", "reach", "tier", "rank", "download_status",
                                  "uses_library", "selected", "reason"], [
        {"release_id": "com.acme:app:2.0", "dependent_ga": "com.acme:app", "reach": "5", "tier": "A", "rank": "1",
         "download_status": "downloaded", "uses_library": "True", "selected": "True"},
        {"release_id": "com.other:tool:1.0", "dependent_ga": "com.other:tool", "reach": "0", "tier": "B",
         "rank": "3", "download_status": "not_found", "uses_library": "False", "selected": "False",
         "reason": "jar not_found"},
    ])
    write_csv(ws.dependent_jars_status, STATUS_COLUMNS, [
        {"release_id": "com.acme:app:2.0", "file": "com_acme-app-2.0.jar", "status": "downloaded"},
        {"release_id": "com.other:tool:1.0", "file": "com_other-tool-1.0.jar", "status": "not_found"},
    ])
    write_csv(ws.usage_summary_csv, SUMMARY_COLUMNS, [
        {"dependent_jar": "com_acme-app-2.0.jar", "status": "analyzed", "bytecode_instructions": "123"}])
    write_csv(ws.usage_csv, USAGE_COLUMNS, [
        {"dependent_jar": "com_acme-app-2.0.jar", "category": "METHOD_CALL", "target_class": "com.acme.App",
         "target_member": "encode", "target_descriptor": "([B)[B", "declaring_class": P + "Codec",
         "resolution": "subclass", "occurrences": "3", "caller_classes": "2"},
        {"dependent_jar": "com_acme-app-2.0.jar", "category": "FIELD_ACCESS", "target_class": P + "Codec",
         "target_member": "MAX", "target_descriptor": "I", "declaring_class": P + "Codec",
         "resolution": "declared", "occurrences": "1", "caller_classes": "1"},
        {"dependent_jar": "com_acme-app-2.0.jar", "category": "METHOD_CALL", "target_class": P + "Mode",
         "target_member": "ordinal", "target_descriptor": "()I", "declaring_class": "java.lang.Enum",
         "resolution": "external", "occurrences": "1", "caller_classes": "1"},
        {"dependent_jar": "com_acme-app-2.0.jar", "category": "TYPE_REFERENCE", "target_class": P + "Codec",
         "occurrences": "2", "caller_classes": "1"},
    ])
    (ws.collection_json).write_text(json.dumps({"candidates": 2, "tried": 2, "using_library": 1, "selected": 1,
                                                "target_reached": False}))
    if with_coverage:
        write_csv(ws.api_coverage_csv, API_COVERAGE_COLUMNS, [
            {"api_id": P + "Codec.encode([B)[B", "kind": "method", "status": "covered_by_override",
             "overrides": "2", "overrides_covered": "1", "instruction_missed": "4", "instruction_covered": "0"}])
        ws.coverage_json.write_text(json.dumps({"status": "ok", "tests": {"tests": 42}}))
        ws.coverage_xml.write_text('<report name="lib"><package name="org/example/lib">'
                                   '<counter type="INSTRUCTION" missed="1" covered="2"/></package>'
                                   '<counter type="INSTRUCTION" missed="30" covered="70"/>'
                                   '<counter type="LINE" missed="3" covered="7"/></report>')
    else:
        ws.coverage_json.write_text(json.dumps({
            "status": "build_failed", "tests": None, "jdks_tried": [8, 11], "detail": "no tests ran with JDK 8, 11",
            "attempts": [{"jdk": 8, "reason": "Source option 5 is no longer supported."},
                         {"jdk": 11, "reason": "Source option 5 is no longer supported."}]}))
    return ws


def test_store_writes_all_tables(tmp_path):
    ws = make_run(tmp_path)
    results = tmp_path / "results"
    written = store_results.store(ws, results)
    assert written == {"apis": 2, "dependents": 2, "api_usage": 4, "api_coverage": 1, "library_versions": 1}

    con = result_tables.connect(results)
    assert con.execute("SELECT packages, dependent_projects, dependents_using, target_reached, coverage_status, "
                   "tests, api_coverage_pct, instructions_missed, instructions_covered "
                   "FROM library_versions").fetchall() == [
        (["org.example.lib", "org.example.lib.internal"], 2, 1, False, "ok", 42, 100.0, 30, 70)]
    assert con.execute("SELECT dependent_ga, dependent_version, release_ts, tier, rank, uses_library, selected, "
                   "analyzed, bytecode_instructions FROM dependents ORDER BY rank").fetchall() == [
        ("com.acme:app", "2.0", 1700000000000, "A", 1, True, True, True, 123),
        ("com.other:tool", "1.0", None, "B", 3, False, False, None, None)]
    usage = dict(con.execute("SELECT category || ' ' || coalesce(target_member, ''), api_id FROM api_usage").fetchall())
    assert usage == {"METHOD_CALL encode": P + "Codec.encode([B)[B",      # declaring class, not com.acme.App
                     "FIELD_ACCESS MAX": P + "Codec.MAX:I",
                     "METHOD_CALL ordinal": None,                       # resolved outside the library
                     "TYPE_REFERENCE ": None}
    assert con.execute("SELECT count(*) FROM api_usage u JOIN apis a USING (library_ga, version, api_id)").fetchone() == (2,)
    assert con.execute("SELECT status, overrides, instruction_missed, branch_missed FROM api_coverage").fetchall() == [
        ("covered_by_override", 2, 4, None)]
    assert con.execute("SELECT deprecated, static FROM apis WHERE kind = 'method'").fetchall() == [(True, False)]
    assert con.execute("SELECT kind FROM runs").fetchall() == [("pipeline",)]


def test_new_run_replaces_the_tables_of_the_version(tmp_path):
    results = tmp_path / "results"
    store_results.store(make_run(tmp_path / "a"), results)
    store_results.store(make_run(tmp_path / "b", with_coverage=False), results)
    con = result_tables.connect(results)
    assert con.execute("SELECT count(*) FROM api_coverage").fetchone() == (0,)   # old coverage removed
    assert con.execute("SELECT coverage_status, tests, api_coverage_pct FROM library_versions").fetchall() == [
        ("build_failed", None, None)]


def test_missing_coverage_is_stored_with_a_reason_and_the_raw_error(tmp_path):
    results = tmp_path / "results"
    store_results.store(make_run(tmp_path, with_coverage=False), results)
    con = result_tables.connect(results)
    assert con.execute("SELECT coverage_reason, coverage_error FROM library_versions").fetchall() == [(
        "We could not build the library's source code and run its tests (tried Java 8, 11).",
        "JDK 8: Source option 5 is no longer supported.\nJDK 11: Source option 5 is no longer supported.")]


def test_coverage_that_was_not_run_says_so(tmp_path):
    ws = make_run(tmp_path, with_coverage=False)
    ws.coverage_json.unlink()
    store_results.store(ws, tmp_path / "results")
    con = result_tables.connect(tmp_path / "results")
    assert con.execute("SELECT coverage_status, coverage_reason FROM library_versions").fetchall() == [
        ("not_run", "Test coverage was not measured in this analysis.")]


def test_coverage_without_api_coverage_is_not_shown_as_measured(tmp_path):
    ws = make_run(tmp_path)
    ws.api_coverage_csv.unlink()
    store_results.store(ws, tmp_path / "results")
    con = result_tables.connect(tmp_path / "results")
    status, reason = con.execute("SELECT coverage_status, coverage_reason FROM library_versions").fetchone()
    assert status == "no_api_coverage" and "problem on our side" in reason


def test_converter_tables_get_null_columns(tmp_path):
    result_tables.write_table(tmp_path, "apis", GA, V, [{"library_ga": GA, "version": V, "api_id": "x"}])
    con = result_tables.connect(tmp_path)
    assert con.execute("SELECT api_id, deprecated FROM apis").fetchall() == [("x", None)]


def test_conform_rewrites_files_with_an_older_schema(tmp_path):
    import pyarrow as pa
    import pyarrow.parquet as pq
    old = tmp_path / "apis" / result_tables.file_name(GA, V)
    old.parent.mkdir(parents=True)
    pq.write_table(pa.table({"library_ga": [GA], "version": [V], "api_id": ["x"], "kind": ["method"]}), old)
    assert result_tables.conform(tmp_path) == [old]
    assert pq.read_schema(old).names == result_tables.TABLES["apis"].names
    assert result_tables.conform(tmp_path) == []          # already conforming
