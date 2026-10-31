#!/usr/bin/env python3
"""
================================================================================
Dependents Index Builder
================================================================================

Builds a lightweight, server-free index of "who depends on which library
version" so the pipeline no longer needs a running Neo4j instance.

OUTPUT (in the index directory):
    edges.parquet   one row per (library version, dependent release)
                    columns: library_ga, library_version, scope,
                             dependent_ga, dependent_version, release_ts
                    sorted by library_ga, library_version so readers (DuckDB,
                    also over HTTPS) only fetch the row groups they need
    reach.parquet   ga, reach  -- number of distinct artifacts that depend on
                    any version of ga (used to rank dependents by impact)
    added/<library>/edges.parquet, reach.parquet
                    libraries added one at a time with add-library
    manifest.json   source, build time, row counts, added libraries

SOURCES:
    from-neo4j   Full export from the Goblin Weaver Neo4j database (run once).
    add-library  Adds all versions of one library from Neo4j to an existing
                 (or new, empty) index. Reach for its dependents is computed
                 in Neo4j, so it is exact even without a full export.
    from-csv     Builds the index from previously exported dependents CSVs
                 (release_id, dependency, artifact_id, ...), one file per
                 library version named <group>:<artifact>-<version>.csv.
                 Scope is unknown for these files, and reach only counts
                 dependents within the exported libraries.

USAGE:
    python build_index.py from-neo4j --out ../../data/dependents-index
    python build_index.py add-library --library org.slf4j:slf4j-api \
                                      --out ../../data/dependents-index
    python build_index.py from-csv --csv-dir ../../data/dataset/Neo4jDataset \
                                   --out ../../data/dependents-index

    Neo4j connection: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
    (defaults: bolt://localhost:7687, neo4j, Password1).
================================================================================
"""

import argparse
import csv
import json
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

RAW_SCHEMA = pa.schema([
    ("library_ga", pa.string()),
    ("library_version", pa.string()),
    ("scope", pa.string()),
    ("dependent_release", pa.string()),
    ("release_ts", pa.int64()),
])

TIMESTAMP_RE = re.compile(r"'timestamp':\s*(\d+)")
ROW_GROUP_SIZE = 100_000


class RawWriter:
    """Writes raw edge batches as Parquet part files."""

    def __init__(self, raw_dir, batch_size):
        self.raw_dir = Path(raw_dir)
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.batch_size = batch_size
        self.rows = {name: [] for name in RAW_SCHEMA.names}
        self.parts = 0
        self.total = 0

    def add(self, library_ga, library_version, scope, dependent_release, release_ts):
        self.rows["library_ga"].append(library_ga)
        self.rows["library_version"].append(library_version)
        self.rows["scope"].append(scope)
        self.rows["dependent_release"].append(dependent_release)
        self.rows["release_ts"].append(release_ts)
        if len(self.rows["library_ga"]) >= self.batch_size:
            self.flush()

    def flush(self):
        n = len(self.rows["library_ga"])
        if n == 0:
            return
        table = pa.Table.from_pydict(self.rows, schema=RAW_SCHEMA)
        pq.write_table(table, self.raw_dir / f"part-{self.parts:05d}.parquet")
        self.parts += 1
        self.total += n
        self.rows = {name: [] for name in RAW_SCHEMA.names}
        print(f"\r  Exported {self.total:,} edges...", end="", flush=True)


def export_from_csv(writer, csv_dir):
    files = sorted(Path(csv_dir).glob("*.csv"))
    if not files:
        sys.exit(f"No CSV files found in {csv_dir}")
    csv.field_size_limit(sys.maxsize)
    for path in files:
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                library_ga = row["artifact_id"]
                # File name is <library_ga>-<version>.csv
                prefix = f"{library_ga}-"
                if not path.stem.startswith(prefix):
                    print(f"\n  Skipping {path.name}: name does not match artifact_id {library_ga}")
                    break
                match = TIMESTAMP_RE.search(row.get("dependency", ""))
                writer.add(
                    library_ga,
                    path.stem[len(prefix):],
                    None,
                    row["release_id"],
                    int(match.group(1)) if match else None,
                )


def write_edges(raw_dir, out_dir, compute_reach=True):
    """Deduplicate, split coordinates, sort and write edges (and reach) Parquet.

    Returns (edges, libraries, library_versions) counts and the distinct
    non-test dependent artifacts.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_glob = str(Path(raw_dir) / "*.parquet")
    con = duckdb.connect()
    con.execute(f"""
        CREATE TABLE edges AS
        SELECT DISTINCT
            library_ga,
            library_version,
            lower(scope) AS scope,
            regexp_extract(dependent_release, '^(.*):[^:]*$', 1) AS dependent_ga,
            regexp_extract(dependent_release, ':([^:]*)$', 1)    AS dependent_version,
            release_ts
        FROM read_parquet('{raw_glob}')
        WHERE library_ga IS NOT NULL
          AND library_version IS NOT NULL
          AND dependent_release LIKE '%:%:%'
    """)
    con.execute(f"""
        COPY (SELECT * FROM edges ORDER BY library_ga, library_version, dependent_ga, dependent_version)
        TO '{out_dir / "edges.parquet"}' (FORMAT parquet, ROW_GROUP_SIZE {ROW_GROUP_SIZE})
    """)
    if compute_reach:
        con.execute(f"""
            COPY (
                SELECT library_ga AS ga, count(DISTINCT dependent_ga) AS reach
                FROM edges GROUP BY library_ga ORDER BY ga
            ) TO '{out_dir / "reach.parquet"}' (FORMAT parquet)
        """)
    counts = con.execute("""
        SELECT count(*), count(DISTINCT library_ga),
               count(DISTINCT (library_ga, library_version))
        FROM edges
    """).fetchone()
    dependent_gas = [ga for (ga,) in con.execute("""
        SELECT DISTINCT dependent_ga FROM edges
        WHERE coalesce(scope, '') <> 'test' ORDER BY 1
    """).fetchall()]
    con.close()
    return counts, dependent_gas


def write_reach(path, reach_rows):
    gas, values = zip(*sorted(reach_rows)) if reach_rows else ((), ())
    table = pa.Table.from_pydict({"ga": list(gas), "reach": list(values)},
                                 schema=pa.schema([("ga", pa.string()), ("reach", pa.int64())]))
    pq.write_table(table, path)


def read_manifest(index_dir):
    path = Path(index_dir) / "manifest.json"
    return json.loads(path.read_text()) if path.exists() else {}


def write_manifest(index_dir, manifest):
    (Path(index_dir) / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def library_dir_name(library):
    return library.replace(":", "__")


def finalize(raw_dir, out_dir, source):
    """Write a full index (edges + reach computed from the edges) and its manifest."""
    (edges, libraries, versions), _ = write_edges(raw_dir, out_dir)
    manifest = read_manifest(out_dir)
    manifest.update({
        "source": source,
        "built_at": now(),
        "edges": edges,
        "libraries": libraries,
        "library_versions": versions,
    })
    write_manifest(out_dir, manifest)
    return manifest


def add_library(index_dir, library, driver=None, batch_size=500_000):
    """Add all versions of one library from Neo4j to the index.

    Returns the manifest entry for the library, or None if Neo4j has no
    dependents for it.
    """
    import goblin

    index_dir = Path(index_dir)
    own_driver = driver is None
    if own_driver:
        driver = goblin.connect()
        goblin.ensure_indexes(driver)
    try:
        start = time.time()
        print(f"Adding {library} to {index_dir} from Neo4j")
        raw_dir = index_dir / "_raw" / library_dir_name(library)
        if raw_dir.exists():
            shutil.rmtree(raw_dir)
        writer = RawWriter(raw_dir, batch_size)
        for edge in goblin.iter_edges(driver, library):
            writer.add(*edge)
        writer.flush()
        print()
        if writer.total == 0:
            shutil.rmtree(raw_dir)
            return None

        lib_dir = index_dir / "added" / library_dir_name(library)
        (edges, _, versions), dependent_gas = write_edges(raw_dir, lib_dir, compute_reach=False)
        shutil.rmtree(index_dir / "_raw")
        write_reach(lib_dir / "reach.parquet", list(goblin.iter_reach(driver, dependent_gas)))
    finally:
        if own_driver:
            driver.close()

    entry = {"edges": edges, "versions": versions, "dependents": len(dependent_gas),
             "added_at": now(), "seconds": round(time.time() - start, 1)}
    manifest = read_manifest(index_dir)
    manifest.setdefault("added", {})[library] = entry
    write_manifest(index_dir, manifest)
    print(f"  {library}: {edges:,} edges, {versions} versions, "
          f"{len(dependent_gas):,} non-test dependents in {entry['seconds']}s")
    return entry


def main():
    parser = argparse.ArgumentParser(description="Build the dependents index (Parquet)")
    sub = parser.add_subparsers(dest="source", required=True)

    from_neo4j = sub.add_parser("from-neo4j", help="Full export from a Goblin Weaver Neo4j database")
    add = sub.add_parser("add-library", help="Add one library (all versions) from Neo4j")
    add.add_argument("--library", required=True, help="groupId:artifactId")
    from_csv = sub.add_parser("from-csv", help="Build from existing dependents CSV exports")
    from_csv.add_argument("--csv-dir", required=True)

    for p in (from_neo4j, add, from_csv):
        p.add_argument("--out", required=True, help="Index directory")
        p.add_argument("--batch-size", type=int, default=500_000)

    args = parser.parse_args()
    out_dir = Path(args.out)

    if args.source == "add-library":
        if add_library(out_dir, args.library, batch_size=args.batch_size) is None:
            sys.exit(f"No dependents found in Neo4j for {args.library}")
        return

    raw_dir = out_dir / "_raw"
    if raw_dir.exists():
        shutil.rmtree(raw_dir)

    start = time.time()
    print(f"Building dependents index ({args.source}) -> {out_dir}")
    writer = RawWriter(raw_dir, args.batch_size)
    if args.source == "from-neo4j":
        import goblin

        driver = goblin.connect()
        goblin.ensure_indexes(driver)
        for edge in goblin.iter_edges(driver):
            writer.add(*edge)
        driver.close()
        source = {"type": "neo4j", "snapshot": goblin.SNAPSHOT_DATE}
    else:
        export_from_csv(writer, args.csv_dir)
        source = {"type": "csv", "csv_dir": args.csv_dir}
    writer.flush()
    print()

    if writer.total == 0:
        sys.exit("No edges exported; index not written")

    print("  Sorting and writing index...")
    manifest = finalize(raw_dir, out_dir, source)
    shutil.rmtree(raw_dir)
    print(f"  Done: {manifest['edges']:,} edges, {manifest['libraries']:,} libraries, "
          f"{manifest['library_versions']:,} library versions in {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
