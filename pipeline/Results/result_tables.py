"""Read and write the OSSBridge result tables (see schema.py)."""

import os
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from schema import TABLES, file_name


def write_table(results_dir, table, library_ga, version, rows):
    """Write one library version's rows (a pyarrow Table or a list of dicts) atomically."""
    schema = TABLES[table]
    if not isinstance(rows, pa.Table):
        rows = pa.Table.from_pylist(rows, schema=schema)
    rows = rows.select(schema.names).cast(schema)
    out = Path(results_dir) / table / file_name(library_ga, version)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    pq.write_table(rows, tmp)
    os.replace(tmp, out)
    return out


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
            source = "read_parquet([" + ", ".join(f"'{f}'" for f in files) + "])"
            con.execute(f"CREATE VIEW {table} AS SELECT * FROM {source}")
        else:
            empty = pa.Table.from_pylist([], schema=schema)
            con.register(f"_{table}_empty", empty)
            con.execute(f"CREATE VIEW {table} AS SELECT * FROM _{table}_empty")
    return con
