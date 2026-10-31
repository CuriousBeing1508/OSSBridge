"""
The OSSBridge result tables: schema, writing and reading.

The results folder holds Parquet files, one file per table per library version,
queried with DuckDB:

    <results>/<table>/<group>__<artifact>@<version>.parquet
    <results>/runs/<run_id>.parquet

Every table starts with (library_ga, version). An API is identified by
api_id = "<package>.<Class>.<member><descriptor>" for methods and constructors
(<init>, the JVM / JaCoCo convention) and "<package>.<Class>.<field>:<descriptor>"
for fields, e.g.
    org.apache.commons.codec.binary.Hex.<init>(Ljava/nio/charset/Charset;)V

Columns that a source does not provide (e.g. the converter of the old dataset
folder has no deprecation information) are written as nulls.
"""

import os
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

COUNTERS = [(f"{c}_{kind}", pa.int64()) for c in ("instruction", "branch", "line", "complexity")
            for kind in ("missed", "covered")]

TABLES = {
    # One row per library version: what was found, for listing and overview pages
    "library_versions": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("packages", pa.list_(pa.string())),    # packages in the library jar
        ("run_id", pa.string()),
        ("dependent_projects", pa.int64()),     # candidates in the dependents index
        ("dependents_tried", pa.int64()),
        ("dependents_using", pa.int64()),       # tried dependents that use the library
        ("dependents_selected", pa.int64()),
        ("target_reached", pa.bool_()),
        ("coverage_status", pa.string()),       # ok, or why there is no coverage (coverage.json)
        ("tests", pa.int64()),                  # tests run by the library's own suite
        ("api_coverage_pct", pa.float64()),
        ("instructions_missed", pa.int64()),    # whole library (JaCoCo report totals)
        ("instructions_covered", pa.int64()),
    ]),
    # API of the library jar (step 4)
    "apis": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("api_id", pa.string()),
        ("package", pa.string()),
        ("class_name", pa.string()),
        ("member", pa.string()),                # method or field name, or <init>
        ("descriptor", pa.string()),
        ("kind", pa.string()),                  # method | constructor | field
        ("visibility", pa.string()),            # public | protected
        ("static", pa.bool_()),
        ("abstract", pa.bool_()),
        ("class_kind", pa.string()),            # class | interface | enum | annotation | record
        ("deprecated", pa.bool_()),
        ("deprecated_for_removal", pa.bool_()),
        ("class_deprecated", pa.bool_()),
        ("exported", pa.bool_()),
    ]),
    # Dependents that were tried (steps 1-3): one row per dependent release
    "dependents": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("dependent_ga", pa.string()),
        ("dependent_version", pa.string()),
        ("release_ts", pa.int64()),             # epoch millis
        ("tier", pa.string()),                  # A (top by reach) | B (random)
        ("rank", pa.int64()),
        ("reach", pa.int64()),
        ("download_status", pa.string()),
        ("uses_library", pa.bool_()),
        ("selected", pa.bool_()),
        ("analyzed", pa.bool_()),               # usage analysis ran on its jar
        ("bytecode_instructions", pa.int64()),
    ]),
    # Uses of the library by a dependent release, per target and category (step 3)
    "api_usage": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("dependent_ga", pa.string()),
        ("dependent_version", pa.string()),
        ("category", pa.string()),              # METHOD_CALL, METHOD_REFERENCE, FIELD_ACCESS, ...
        ("target_class", pa.string()),
        ("target_member", pa.string()),         # method/field name, <extends>/<implements>, or null
        ("target_descriptor", pa.string()),
        ("declaring_class", pa.string()),
        ("resolution", pa.string()),            # declared | inherited | subclass | external | unknown
        ("api_id", pa.string()),                # of the declaring class; joins with apis
        ("occurrences", pa.int64()),
        ("caller_classes", pa.int64()),
    ]),
    # Coverage of each API by the library's own test suite (steps 5-6)
    "api_coverage": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("api_id", pa.string()),
        ("status", pa.string()),                # covered | covered_by_override | not_covered | ...
        ("overrides", pa.int64()),
        ("overrides_covered", pa.int64()),
        *COUNTERS,
    ]),
    # Provenance: one row per pipeline or conversion run
    "runs": pa.schema([
        ("run_id", pa.string()),
        ("kind", pa.string()),
        ("started_at", pa.string()),
        ("params", pa.string()),                # JSON
    ]),
}

VERSION_TABLES = [t for t in TABLES if t != "runs"]


def file_name(library_ga, version):
    return f"{library_ga.replace(':', '__')}@{version}.parquet"


def write_table(results_dir, table, library_ga, version, rows):
    """Write one library version's rows (a pyarrow Table or a list of dicts) atomically."""
    schema = TABLES[table]
    if not isinstance(rows, pa.Table):
        rows = pa.Table.from_pylist(rows, schema=schema)
    for field in schema:
        if field.name not in rows.column_names:
            rows = rows.append_column(field.name, pa.nulls(rows.num_rows, field.type))
    rows = rows.select(schema.names).cast(schema)
    out = Path(results_dir) / table / file_name(library_ga, version)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    pq.write_table(rows, tmp)
    os.replace(tmp, out)
    return out


def conform(results_dir):
    """Rewrite files written with an older schema to the current one (new columns as nulls).

    All files of a table must have the same columns, e.g. for the Hugging Face dataset viewer.
    Returns the files that were rewritten.
    """
    rewritten = []
    for table, schema in TABLES.items():
        for path in sorted((Path(results_dir) / table).glob("*.parquet")):
            if pq.read_schema(path).names == schema.names:
                continue
            rows = pq.read_table(path)
            for field in schema:
                if field.name not in rows.column_names:
                    rows = rows.append_column(field.name, pa.nulls(rows.num_rows, field.type))
            tmp = path.with_suffix(".tmp")
            pq.write_table(rows.select(schema.names).cast(schema), tmp)
            os.replace(tmp, path)
            rewritten.append(path)
    return rewritten


def delete_version(results_dir, library_ga, version):
    """Remove every table file of a library version (before writing a new run of it)."""
    for table in VERSION_TABLES:
        (Path(results_dir) / table / file_name(library_ga, version)).unlink(missing_ok=True)


def write_run(results_dir, run):
    out = Path(results_dir) / "runs" / f"{run['run_id']}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist([run], schema=TABLES["runs"]), out)


def connect(results_dir):
    """DuckDB connection with one view per table over all its Parquet files."""
    con = duckdb.connect()
    for table, schema in TABLES.items():
        files = sorted(str(p) for p in (Path(results_dir) / table).glob("*.parquet"))
        if files:
            source = "read_parquet([" + ", ".join(f"'{f}'" for f in files) + "], union_by_name = true)"
            con.execute(f"CREATE VIEW {table} AS SELECT * FROM {source}")
        else:
            empty = pa.Table.from_pylist([], schema=schema)
            con.register(f"_{table}_empty", empty)
            con.execute(f"CREATE VIEW {table} AS SELECT * FROM _{table}_empty")
    return con
