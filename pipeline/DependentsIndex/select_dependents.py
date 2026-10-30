#!/usr/bin/env python3
"""
================================================================================
Impact-based Dependent Selection
================================================================================

Selects which dependents of a library version to analyze, using the
dependents index built by build_index.py (local directory or HTTPS URL).

STEPS:
    1. Find all releases that depend on <library>:<version>
    2. Drop test-scoped dependencies (their main jar never calls the library)
    3. Collapse to one release per dependent project (the latest one)
    4. Rank dependents by reach (how many projects depend on them)
    5. Tier A: the top-K dependents by reach (only those with reach > 0)
       Tier B: a seeded random sample of the remaining dependents, spread
               across organizations (groupIds) round-robin

OUTPUT:
    <out>.csv           release_id, artifact_id, depGroupId, depArtifactId,
                        Depversion, tier, reach, release_ts
                        (same leading columns as processed_csvs/, so
                        mavenDepJarDownload.py can read it directly)
    <out>.summary.json  counts before/after each step and the share of total
                        reach covered by the selection

USAGE:
    python select_dependents.py --index ../../data/dependents-index \
        --library commons-codec:commons-codec --version 1.15 \
        --top-k 200 --sample 200 --out ../../data/commons-codec-1.15/dependents.csv
================================================================================
"""

import argparse
import csv
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import duckdb

OUTPUT_COLUMNS = ["release_id", "artifact_id", "depGroupId", "depArtifactId",
                  "Depversion", "tier", "reach", "release_ts"]


def is_url(index):
    return index.startswith(("http://", "https://", "s3://"))


def index_files(index, name):
    """Index files named `name`: the base file plus libraries added with add-library.

    Remote indexes (URLs) only have the base file.
    """
    if is_url(index):
        return [f"{index.rstrip('/')}/{name}"]
    root = Path(index)
    files = [root / name] if (root / name).exists() else []
    files += sorted(root.glob(f"added/*/{name}"))
    return [str(f) for f in files]


def parquet_source(files, columns):
    """SQL for reading a list of Parquet files (or an empty relation)."""
    if not files:
        return f"(SELECT {', '.join(f'NULL::{t} AS {c}' for c, t in columns)} WHERE FALSE)"
    return "read_parquet([" + ", ".join(f"'{f}'" for f in files) + "])"


def load_dependents(index, library, version, include_test_scope=False):
    """Return (counts, dependents) where dependents has one row per project."""
    edges = parquet_source(index_files(index, "edges.parquet"), [
        ("library_ga", "VARCHAR"), ("library_version", "VARCHAR"), ("scope", "VARCHAR"),
        ("dependent_ga", "VARCHAR"), ("dependent_version", "VARCHAR"), ("release_ts", "BIGINT")])
    reach = parquet_source(index_files(index, "reach.parquet"),
                           [("ga", "VARCHAR"), ("reach", "BIGINT")])
    con = duckdb.connect()
    # DISTINCT: a library added with add-library may also be in the base index
    con.execute(f"""
        CREATE TEMP TABLE matched AS
        SELECT DISTINCT * FROM {edges}
        WHERE library_ga = ? AND library_version = ?
    """, [library, version])

    scope_filter = "TRUE" if include_test_scope else "coalesce(scope, '') <> 'test'"
    counts = dict(zip(
        ["releases", "releases_non_test", "projects"],
        con.execute(f"""
            SELECT count(DISTINCT (dependent_ga, dependent_version)),
                   count(DISTINCT (dependent_ga, dependent_version)) FILTER (WHERE {scope_filter}),
                   count(DISTINCT dependent_ga) FILTER (WHERE {scope_filter})
            FROM matched
        """).fetchone(),
    ))

    rows = con.execute(f"""
        WITH latest AS (
            SELECT *, row_number() OVER (
                PARTITION BY dependent_ga
                ORDER BY release_ts DESC NULLS LAST, dependent_version DESC
            ) AS rn
            FROM matched
            WHERE {scope_filter}
        )
        SELECT l.dependent_ga, l.dependent_version, l.release_ts,
               coalesce(r.reach, 0) AS reach
        FROM latest l
        LEFT JOIN (SELECT ga, max(reach) AS reach FROM {reach} GROUP BY ga) r
               ON r.ga = l.dependent_ga
        WHERE l.rn = 1
        ORDER BY reach DESC, l.dependent_ga
    """).fetchall()
    con.close()

    dependents = [
        {"dependent_ga": ga, "dependent_version": v, "release_ts": ts, "reach": reach}
        for ga, v, ts, reach in rows
    ]
    return counts, dependents


def stratified_sample(dependents, size, seed):
    """Random sample spread across groupIds: one pick per group per round."""
    rng = random.Random(seed)
    by_group = defaultdict(list)
    for d in dependents:
        by_group[d["dependent_ga"].split(":")[0]].append(d)
    groups = sorted(by_group)
    rng.shuffle(groups)
    for group in groups:
        rng.shuffle(by_group[group])

    picked = []
    while len(picked) < size and groups:
        remaining = []
        for group in groups:
            if len(picked) == size:
                break
            picked.append(by_group[group].pop())
            if by_group[group]:
                remaining.append(group)
        groups = remaining
    return picked


def select(dependents, top_k, sample_size, seed):
    """Split ranked dependents into tier A (top-K by reach) and tier B (sample).

    Only dependents with reach > 0 can be in tier A; ranking ties at zero
    would otherwise fall back to alphabetical order.
    """
    tier_a = [d for d in dependents[:top_k] if d["reach"] > 0]
    tier_b = stratified_sample(dependents[len(tier_a):], sample_size, seed)
    return ([dict(d, tier="A") for d in tier_a] +
            [dict(d, tier="B") for d in tier_b])


def summarize(library, version, counts, dependents, selected, args):
    total_reach = sum(d["reach"] for d in dependents)
    selected_reach = sum(d["reach"] for d in selected)
    return {
        "library": library,
        "version": version,
        "index": args.index,
        "params": {"top_k": args.top_k, "sample": args.sample, "seed": args.seed,
                   "include_test_scope": args.include_test_scope},
        "dependent_releases": counts["releases"],
        "dependent_releases_non_test": counts["releases_non_test"],
        "dependent_projects": counts["projects"],
        "selected": len(selected),
        "selected_tier_a": sum(1 for d in selected if d["tier"] == "A"),
        "selected_tier_b": sum(1 for d in selected if d["tier"] == "B"),
        "reach_total": total_reach,
        "reach_covered": selected_reach,
        "reach_covered_pct": round(100 * selected_reach / total_reach, 2) if total_reach else None,
    }


def write_csv(path, library, selected):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        for d in selected:
            group_id, artifact_id = d["dependent_ga"].split(":", 1)
            writer.writerow({
                "release_id": f"{d['dependent_ga']}:{d['dependent_version']}",
                "artifact_id": library,
                "depGroupId": group_id,
                "depArtifactId": artifact_id,
                "Depversion": d["dependent_version"],
                "tier": d["tier"],
                "reach": d["reach"],
                "release_ts": "" if d["release_ts"] is None else d["release_ts"],
            })


def fetch_missing(args):
    """Add the library to a local index from Neo4j; exit with the reason if Neo4j has nothing."""
    import build_index
    import goblin

    if is_url(args.index):
        sys.exit("--fetch-missing needs a local index directory")
    driver = goblin.connect()
    try:
        already_added = args.library in build_index.read_manifest(args.index).get("added", {})
        if not already_added:
            goblin.ensure_indexes(driver)
            build_index.add_library(args.index, args.library, driver=driver)
        counts, _ = load_dependents(args.index, args.library, args.version, args.include_test_scope)
        if counts["releases"] == 0:
            status = goblin.library_status(driver, args.library, args.version)
            sys.exit(goblin.describe_missing(status, args.library, args.version))
    finally:
        driver.close()


def main():
    parser = argparse.ArgumentParser(description="Select dependents to analyze for a library version")
    parser.add_argument("--index", required=True, help="Index directory or HTTPS base URL")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--top-k", type=int, default=200, help="Tier A: top dependents by reach")
    parser.add_argument("--sample", type=int, default=200, help="Tier B: random long-tail sample size")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--include-test-scope", action="store_true")
    parser.add_argument("--fetch-missing", action="store_true",
                        help="If the library version is not in the index, add the library "
                             "from Neo4j (NEO4J_URI/USER/PASSWORD) and retry")
    parser.add_argument("--out", required=True, help="Output CSV path")
    args = parser.parse_args()

    counts, dependents = load_dependents(args.index, args.library, args.version,
                                         args.include_test_scope)
    if counts["releases"] == 0 and args.fetch_missing:
        fetch_missing(args)
        counts, dependents = load_dependents(args.index, args.library, args.version,
                                             args.include_test_scope)
    if not dependents:
        hint = "" if args.fetch_missing else " (use --fetch-missing to look it up in Neo4j)"
        sys.exit(f"No dependents found for {args.library}:{args.version} in the index{hint}")

    selected = select(dependents, args.top_k, args.sample, args.seed)
    out = Path(args.out)
    write_csv(out, args.library, selected)
    summary = summarize(args.library, args.version, counts, dependents, selected, args)
    out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    print(f"{args.library}:{args.version}")
    print(f"  dependent releases      : {summary['dependent_releases']:,}")
    print(f"  after test-scope filter : {summary['dependent_releases_non_test']:,}")
    print(f"  distinct projects       : {summary['dependent_projects']:,}")
    print(f"  selected                : {summary['selected']:,} "
          f"(A={summary['selected_tier_a']}, B={summary['selected_tier_b']})")
    if summary["reach_covered_pct"] is not None:
        print(f"  reach covered           : {summary['reach_covered_pct']}%")
    print(f"✓ Saved {out}")


if __name__ == "__main__":
    main()
