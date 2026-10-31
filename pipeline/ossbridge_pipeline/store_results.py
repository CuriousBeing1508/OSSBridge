#!/usr/bin/env python3
"""
================================================================================
Step 7: Store Results
================================================================================

Writes the outputs of a run folder into the result tables (result_tables.py),
replacing any earlier tables of the same library version:

    library_versions  one summary row: dependents found / tried / using /
                      selected, coverage status, tests run, API coverage
    apis              apis.csv (step 4)
    dependents        dependents.csv (collection loop), with release dates from
                      candidates.csv and bytecode sizes from usage-summary.csv
    api_usage         usage.csv (step 3; selected dependents), with api_id of the
                      declaring class for method calls, method references and
                      field accesses that resolve inside the library
    api_coverage      api-coverage.csv (step 6)
    runs              one row with the run's summaries (collection.json,
                      coverage.json) as JSON

Tables whose step has no output (e.g. coverage failed) are not written; the
summary row says why.

USAGE:
    python -m ossbridge_pipeline.store_results --library commons-codec:commons-codec --version 1.17.1
================================================================================
"""

import argparse
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from . import result_tables
from .paths import RESULTS_DIR
from .workspace import Workspace

DEFAULT_RESULTS = RESULTS_DIR


def jar_packages(jar_path):
    """Packages of the classes in a jar (multi-release copies under META-INF excluded)."""
    with zipfile.ZipFile(jar_path) as jar:
        return sorted({n.rsplit("/", 1)[0].replace("/", ".") if "/" in n else ""
                       for n in jar.namelist() if n.endswith(".class") and not n.startswith("META-INF/")})


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def csv_source(path):
    return f"read_csv('{path}', all_varchar = true, header = true)"


def store(workspace, results_dir=DEFAULT_RESULTS):
    """Write the run folder's outputs as result tables; returns rows written per table."""
    ws, ga, v = workspace, workspace.library_ga, workspace.version
    if not ws.library_jar.exists():
        raise FileNotFoundError(f"{ws.library_jar} not found; run the pipeline first")
    collection = read_json(ws.collection_json)
    coverage = read_json(ws.coverage_json)
    started = datetime.now(timezone.utc)
    run_id = f"pipeline-{ga.replace(':', '__')}@{v}-{started.strftime('%Y%m%dT%H%M%SZ')}"

    con = duckdb.connect()
    lib = {"ga": ga, "v": v}
    written = {}
    result_tables.delete_version(results_dir, ga, v)

    def write(table, sql):
        rows = con.sql(sql, params=lib).to_arrow_table()
        result_tables.write_table(results_dir, table, ga, v, rows)
        written[table] = rows.num_rows

    if ws.apis_csv.exists():
        write("apis", f"""
            SELECT $ga AS library_ga, $v AS version, api_id, package, class_name, member, descriptor, kind,
                   visibility, static::BOOLEAN AS static, abstract::BOOLEAN AS abstract, class_kind,
                   deprecated::BOOLEAN AS deprecated, deprecated_for_removal::BOOLEAN AS deprecated_for_removal,
                   class_deprecated::BOOLEAN AS class_deprecated, exported::BOOLEAN AS exported
            FROM {csv_source(ws.apis_csv)}""")

    if ws.dependents_csv.exists():
        candidates = csv_source(ws.candidates_csv) if ws.candidates_csv.exists() else \
            "(SELECT NULL AS release_id, NULL AS release_ts WHERE FALSE)"
        summary = csv_source(ws.usage_summary_csv) if ws.usage_summary_csv.exists() else \
            "(SELECT NULL AS dependent_jar, NULL AS status, NULL AS bytecode_instructions WHERE FALSE)"
        jars = csv_source(ws.dependent_jars_status) if ws.dependent_jars_status.exists() else \
            "(SELECT NULL AS release_id, NULL AS file WHERE FALSE)"
        write("dependents", f"""
            SELECT $ga AS library_ga, $v AS version, d.dependent_ga,
                   regexp_extract(d.release_id, ':([^:]*)$', 1) AS dependent_version,
                   TRY_CAST(c.release_ts AS BIGINT) AS release_ts, d.tier, TRY_CAST(d.rank AS BIGINT) AS rank,
                   TRY_CAST(d.reach AS BIGINT) AS reach, d.download_status,
                   d.uses_library = 'True' AS uses_library, d.selected = 'True' AS selected,
                   s.status = 'analyzed' AS analyzed, TRY_CAST(s.bytecode_instructions AS BIGINT) AS bytecode_instructions
            FROM {csv_source(ws.dependents_csv)} d
            LEFT JOIN {candidates} c USING (release_id)
            LEFT JOIN {jars} j USING (release_id)
            LEFT JOIN {summary} s ON s.dependent_jar = j.file""")

    if ws.usage_csv.exists() and ws.dependent_jars_status.exists():
        write("api_usage", f"""
            SELECT $ga AS library_ga, $v AS version,
                   regexp_extract(j.release_id, '^(.*):[^:]*$', 1) AS dependent_ga,
                   regexp_extract(j.release_id, ':([^:]*)$', 1) AS dependent_version,
                   u.category, u.target_class, nullif(u.target_member, '') AS target_member,
                   nullif(u.target_descriptor, '') AS target_descriptor, nullif(u.declaring_class, '') AS declaring_class,
                   nullif(u.resolution, '') AS resolution,
                   CASE WHEN u.resolution IN ('declared', 'inherited', 'subclass') THEN
                        CASE WHEN u.category = 'FIELD_ACCESS'
                             THEN u.declaring_class || '.' || u.target_member || ':' || u.target_descriptor
                             ELSE u.declaring_class || '.' || u.target_member || u.target_descriptor END
                   END AS api_id,
                   u.occurrences::BIGINT AS occurrences, u.caller_classes::BIGINT AS caller_classes
            FROM {csv_source(ws.usage_csv)} u
            JOIN {csv_source(ws.dependent_jars_status)} j ON j.file = u.dependent_jar""")

    api_coverage_pct = None
    if ws.api_coverage_csv.exists():
        counters = ", ".join(f"nullif({c}, '')::BIGINT AS {c}" for c, _ in result_tables.COUNTERS)
        write("api_coverage", f"""
            SELECT $ga AS library_ga, $v AS version, api_id, status, overrides::BIGINT AS overrides,
                   overrides_covered::BIGINT AS overrides_covered, {counters}
            FROM {csv_source(ws.api_coverage_csv)}""")
        covered, reachable = con.execute(f"""
            SELECT count(*) FILTER (WHERE status IN ('covered', 'covered_by_override')),
                   count(*) FILTER (WHERE status IN ('covered', 'covered_by_override', 'not_covered'))
            FROM {csv_source(ws.api_coverage_csv)}""").fetchone()
        api_coverage_pct = round(100 * covered / reachable, 1) if reachable else None

    tests = (coverage or {}).get("tests") or {}
    result_tables.write_table(results_dir, "library_versions", ga, v, [{
        "library_ga": ga, "version": v, "packages": jar_packages(ws.library_jar), "run_id": run_id,
        "dependent_projects": (collection or {}).get("candidates"),
        "dependents_tried": (collection or {}).get("tried"),
        "dependents_using": (collection or {}).get("using_library"),
        "dependents_selected": (collection or {}).get("selected"),
        "target_reached": (collection or {}).get("target_reached"),
        "coverage_status": (coverage or {}).get("status", "not_run"),
        "tests": tests.get("tests"),
        "api_coverage_pct": api_coverage_pct,
    }])
    written["library_versions"] = 1
    result_tables.write_run(results_dir, {
        "run_id": run_id, "kind": "pipeline", "started_at": started.isoformat(timespec="seconds"),
        "params": json.dumps({"library": ga, "version": v, "collection": collection, "coverage": coverage}),
    })
    return written


def run(workspace, results_dir=DEFAULT_RESULTS):
    """Step 7 for a workspace."""
    return store(workspace, results_dir)


def main():
    parser = argparse.ArgumentParser(description="Write a run folder's outputs as result tables")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="Results folder")
    args = parser.parse_args()
    try:
        written = run(Workspace(args.library, args.version), Path(args.results))
    except FileNotFoundError as e:
        sys.exit(str(e))
    print("  rows written: " + ", ".join(f"{t}: {n:,}" for t, n in written.items()))


if __name__ == "__main__":
    main()
