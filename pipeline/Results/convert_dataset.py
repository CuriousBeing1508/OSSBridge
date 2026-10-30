#!/usr/bin/env python3
"""
================================================================================
Dataset → Result Tables Converter
================================================================================

Converts the file-based OSSBridge dataset into result tables (schema.py).
The dataset is only read, never modified.

INPUT (dataset folder, per library version):
    processed_csvs/<group>:<artifact>-<version>.csv           dependents
    LibraryJars/<artifact>-<version>.jar                      library jar (packages)
    LibraryJars/<artifact>-<version>_available_apis.csv       public API
    TestCoverage/<artifact>-<version>_method_coverage.csv     JaCoCo coverage
    StaticAnaResults/<artifact>-<version>/Dependents/*_third_party_calls.csv
    StaticAnaResults/<artifact>-<version>/analysis_summary.csv

DATA FIXES APPLIED:
    - Usage is kept only when the target class is in a package of the library
      jar. The analysis files also contain calls to other libraries (e.g.
      commons-lang3 for commons-codec) and to shaded copies of the library
      (e.g. com.couchbase...deps.com.fasterxml.jackson.databind).
    - Constructors are named <init> everywhere (javap prints the class name),
      so constructor APIs match their coverage and usage.

OUTPUT:
    <results>/<table>/<group>__<artifact>@<version>.parquet
    <results>/runs/<run_id>.parquet
    <results>/_reports/<run_id>.json   data-quality report

USAGE:
    python convert_dataset.py --dataset ../../data/dataset --results ../../data/results
================================================================================
"""

import argparse
import csv
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from result_tables import write_run, write_table

USAGE_SUFFIX = "_third_party_calls.csv"


def discover(dataset):
    """Yield (library_ga, version, key) for each dependents file in processed_csvs."""
    for path in sorted((Path(dataset) / "processed_csvs").glob("*.csv")):
        with open(path, newline="", encoding="utf-8") as f:
            first = next(csv.DictReader(f), None)
        if not first or not path.stem.startswith(first["artifact_id"] + "-"):
            print(f"  Skipping {path.name}: cannot determine library and version")
            continue
        library_ga = first["artifact_id"]
        version = path.stem[len(library_ga) + 1:]
        yield library_ga, version, f"{library_ga.split(':', 1)[1]}-{version}"


def jar_packages(jar_path):
    """Packages of the classes in a jar (multi-release copies under META-INF excluded)."""
    packages = set()
    with zipfile.ZipFile(jar_path) as jar:
        for name in jar.namelist():
            if name.endswith(".class") and not name.startswith("META-INF/"):
                packages.add(name.rsplit("/", 1)[0].replace("/", ".") if "/" in name else "")
    return sorted(packages)


def sql_str(value):
    return "'" + value.replace("'", "''") + "'"


def sql_files(paths):
    return "[" + ", ".join(sql_str(str(p)) for p in paths) + "]"


def qualified(package_col, rest):
    return f"CASE WHEN coalesce({package_col}, '') = '' THEN {rest} ELSE {package_col} || '.' || {rest} END"


def convert_apis(con, path, ga, v):
    con.execute(f"""
        CREATE OR REPLACE TABLE apis AS
        WITH src AS (
            SELECT DISTINCT Package AS package, Class AS class_name,
                   CASE WHEN Method = Class OR Method LIKE '%.%' THEN '<init>' ELSE Method END AS member,
                   MethodDescriptor AS descriptor
            FROM read_csv({sql_str(str(path))}, all_varchar = true, header = true)
        )
        SELECT {sql_str(ga)} AS library_ga, {sql_str(v)} AS version,
               {qualified('package', "class_name || '.' || member || descriptor")} AS api_id,
               package, class_name, member, descriptor,
               CASE WHEN member = '<init>' THEN 'constructor' ELSE 'method' END AS kind
        FROM src
    """)


def convert_coverage(con, path, ga, v):
    counters = ["INSTRUCTION", "BRANCH", "LINE", "COMPLEXITY"]
    columns = ", ".join(
        f"max(CAST({c}_{kind} AS BIGINT)) AS {c.lower()}_{kind.lower()}"
        for c in counters for kind in ("MISSED", "COVERED"))
    con.execute(f"""
        CREATE OR REPLACE TABLE api_coverage AS
        SELECT {sql_str(ga)} AS library_ga, {sql_str(v)} AS version,
               {qualified('Package', "Class || '.' || Method || MethodDescriptor")} AS api_id,
               {columns}
        FROM read_csv({sql_str(str(path))}, all_varchar = true, header = true)
        GROUP BY ALL
    """)


def convert_dependents(con, path, summary_path, ga, v):
    summary = "(SELECT NULL::VARCHAR AS JarFile, NULL::VARCHAR AS TotalInstructions WHERE FALSE)"
    if summary_path.exists():
        summary = f"read_csv({sql_str(str(summary_path))}, all_varchar = true, header = true)"
    con.execute(f"""
        CREATE OR REPLACE TABLE dependents AS
        WITH src AS (
            SELECT DISTINCT
                regexp_extract(release_id, '^(.*):[^:]*$', 1) AS dependent_ga,
                regexp_extract(release_id, ':([^:]*)$', 1) AS dependent_version,
                TRY_CAST(regexp_extract(dependency, '''timestamp'':\\s*(\\d+)', 1) AS BIGINT) AS release_ts
            FROM read_csv({sql_str(str(path))}, all_varchar = true, header = true)
            WHERE release_id LIKE '%:%:%'
        ), keyed AS (
            SELECT *, replace(split_part(dependent_ga, ':', 1), '.', '_') || '-'
                      || split_part(dependent_ga, ':', 2) || '-' || dependent_version AS jar_key
            FROM src
        )
        SELECT {sql_str(ga)} AS library_ga, {sql_str(v)} AS version,
               k.dependent_ga, k.dependent_version, k.release_ts,
               NULL::VARCHAR AS tier, NULL::BIGINT AS reach,
               s.JarFile IS NOT NULL AS analyzed,
               TRY_CAST(s.TotalInstructions AS BIGINT) AS bytecode_instructions,
               k.jar_key
        FROM keyed k
        LEFT JOIN (SELECT DISTINCT JarFile, TotalInstructions FROM {summary}) s
               ON s.JarFile = k.jar_key || '.jar'
    """)


def convert_usage(con, usage_dir, ga, v, packages, report):
    files = [p for p in sorted(Path(usage_dir).glob(f"*{USAGE_SUFFIX}")) if p.stat().st_size > 0]
    report["usage_files"] = len(files)
    if not files:
        con.execute("CREATE OR REPLACE TABLE api_usage AS SELECT * FROM (SELECT 1) WHERE FALSE")
        return False

    con.execute("CREATE OR REPLACE TABLE lib_packages (package VARCHAR)")
    con.executemany("INSERT INTO lib_packages VALUES (?)", [[p] for p in packages])
    con.execute(f"""
        CREATE OR REPLACE TABLE raw_usage AS
        SELECT regexp_extract(filename, '([^/]*){USAGE_SUFFIX}$', 1) AS jar_key,
               CallerClass AS caller_class, Usage AS usage, Category AS category
        FROM read_csv({sql_files(files)}, all_varchar = true, header = true, filename = true,
                      columns = {{'JarFile': 'VARCHAR', 'CallerClass': 'VARCHAR',
                                  'Usage': 'VARCHAR', 'Category': 'VARCHAR'}})
    """)
    con.execute("""
        CREATE OR REPLACE TABLE parsed_usage AS
        WITH p AS (
            SELECT *,
                CASE
                    WHEN category IN ('METHOD_CALL', 'FIELD_ACCESS') THEN split_part(usage, ' : ', 1)
                    WHEN category = 'CLASS_USAGE' THEN regexp_replace(usage, '<[^>]*>$', '')
                    WHEN category = 'FINAL_FIELD' THEN split_part(usage, ' ', 1)
                    ELSE usage
                END AS target,
                CASE WHEN category IN ('METHOD_CALL', 'FIELD_ACCESS')
                     THEN nullif(split_part(usage, ' : ', 2), '') END AS target_descriptor,
                CASE WHEN category = 'CLASS_USAGE'
                     THEN nullif(regexp_extract(usage, '(<[^>]*>)$', 1), '') END AS relation
            FROM raw_usage
        )
        SELECT jar_key, caller_class, category, target_descriptor,
               CASE WHEN category IN ('METHOD_CALL', 'FIELD_ACCESS')
                    THEN regexp_extract(target, '^(.*)\\.[^.]*$', 1) ELSE target END AS target_class,
               CASE WHEN category IN ('METHOD_CALL', 'FIELD_ACCESS')
                    THEN regexp_extract(target, '\\.([^.]*)$', 1) ELSE relation END AS target_member,
               CASE WHEN category = 'METHOD_CALL' THEN target || target_descriptor END AS api_id
        FROM p
    """)
    con.execute("""
        CREATE OR REPLACE TABLE parsed_usage AS
        SELECT *, CASE WHEN target_class LIKE '%.%'
                       THEN regexp_extract(target_class, '^(.*)\\.[^.]*$', 1) ELSE '' END AS target_package
        FROM parsed_usage
    """)

    totals = con.execute("""
        SELECT count(*),
               count(*) FILTER (WHERE target_package IN (SELECT package FROM lib_packages)),
               count(DISTINCT jar_key),
               count(DISTINCT jar_key) FILTER (WHERE jar_key NOT IN (SELECT jar_key FROM dependents))
        FROM parsed_usage
    """).fetchone()
    report["usage_rows"], report["usage_rows_in_library"], report["usage_jars"], report["usage_jars_unmatched"] = totals
    report["usage_rows_dropped_top_packages"] = dict(con.execute("""
        SELECT target_package, count(*) FROM parsed_usage
        WHERE target_package NOT IN (SELECT package FROM lib_packages)
        GROUP BY 1 ORDER BY 2 DESC LIMIT 5
    """).fetchall())

    con.execute(f"""
        CREATE OR REPLACE TABLE api_usage AS
        SELECT {sql_str(ga)} AS library_ga, {sql_str(v)} AS version,
               d.dependent_ga, d.dependent_version,
               u.category, u.target_class, u.target_member, u.target_descriptor, u.api_id,
               count(*) AS occurrences, count(DISTINCT u.caller_class) AS caller_classes
        FROM parsed_usage u
        JOIN dependents d USING (jar_key)
        WHERE u.target_package IN (SELECT package FROM lib_packages)
        GROUP BY ALL
    """)
    return True


def convert_one(con, dataset, results_dir, ga, v, key, run_id):
    dataset = Path(dataset)
    report = {"library": ga, "version": v, "tables": []}
    jar = dataset / "LibraryJars" / f"{key}.jar"
    apis_csv = dataset / "LibraryJars" / f"{key}_available_apis.csv"
    coverage_csv = dataset / "TestCoverage" / f"{key}_method_coverage.csv"
    analysis_dir = dataset / "StaticAnaResults" / key

    convert_dependents(con, dataset / "processed_csvs" / f"{ga}-{v}.csv",
                       analysis_dir / "analysis_summary.csv", ga, v)
    write_table(results_dir, "dependents", ga, v,
                con.sql("SELECT * EXCLUDE (jar_key) FROM dependents").to_arrow_table())
    report["tables"].append("dependents")
    report["dependent_releases"], report["dependent_projects"], report["dependents_analyzed"] = con.execute(
        "SELECT count(*), count(DISTINCT dependent_ga), count(*) FILTER (WHERE analyzed) FROM dependents"
    ).fetchone()

    has_apis = apis_csv.exists()
    if has_apis:
        convert_apis(con, apis_csv, ga, v)
        write_table(results_dir, "apis", ga, v, con.sql("SELECT * FROM apis").to_arrow_table())
        report["tables"].append("apis")
        report["apis"], report["constructors"] = con.execute(
            "SELECT count(*), count(*) FILTER (WHERE kind = 'constructor') FROM apis").fetchone()

    if jar.exists():
        packages = jar_packages(jar)
        report["packages_from"] = "jar"
    elif has_apis:
        packages = [p for (p,) in con.execute("SELECT DISTINCT package FROM apis ORDER BY 1").fetchall()]
        report["packages_from"] = "apis"
    else:
        packages = []
        report["packages_from"] = None
    report["packages"] = len(packages)

    if coverage_csv.exists():
        convert_coverage(con, coverage_csv, ga, v)
        write_table(results_dir, "api_coverage", ga, v,
                    con.sql("SELECT * FROM api_coverage").to_arrow_table())
        report["tables"].append("api_coverage")
        if has_apis:
            report["apis_with_coverage"], report["constructors_with_coverage"] = con.execute("""
                SELECT count(*), count(*) FILTER (WHERE a.kind = 'constructor')
                FROM apis a JOIN api_coverage c USING (api_id)
            """).fetchone()

    if packages and convert_usage(con, analysis_dir / "Dependents", ga, v, packages, report):
        write_table(results_dir, "api_usage", ga, v, con.sql("SELECT * FROM api_usage").to_arrow_table())
        report["tables"].append("api_usage")
        if has_apis:
            report["method_calls_matching_apis"], report["method_calls"] = con.execute("""
                SELECT count(*) FILTER (WHERE api_id IN (SELECT api_id FROM apis)), count(*)
                FROM api_usage WHERE category = 'METHOD_CALL'
            """).fetchone()

    write_table(results_dir, "library_versions", ga, v,
                [{"library_ga": ga, "version": v, "packages": packages, "run_id": run_id}])
    return report


def main():
    parser = argparse.ArgumentParser(description="Convert the file-based dataset into result tables")
    parser.add_argument("--dataset", required=True, help="Dataset folder (processed_csvs, LibraryJars, ...)")
    parser.add_argument("--results", required=True, help="Output results folder")
    args = parser.parse_args()

    started = datetime.now(timezone.utc)
    run_id = "convert-" + started.strftime("%Y%m%dT%H%M%SZ")
    libraries = list(discover(args.dataset))
    if not libraries:
        sys.exit(f"No library versions found in {args.dataset}/processed_csvs")

    reports = []
    for ga, v, key in libraries:
        print(f"Converting {ga}:{v}")
        con = duckdb.connect()
        report = convert_one(con, args.dataset, args.results, ga, v, key, run_id)
        con.close()
        reports.append(report)
        print(f"  tables: {', '.join(report['tables'])}")

    write_run(args.results, {"run_id": run_id, "kind": "convert_dataset", "started_at": started.isoformat(
        timespec="seconds"), "params": json.dumps({"dataset": args.dataset})})
    report_path = Path(args.results) / "_reports" / f"{run_id}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(reports, indent=2) + "\n")
    print(f"✓ {len(reports)} library versions converted; report: {report_path}")


if __name__ == "__main__":
    main()
