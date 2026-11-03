"""
================================================================================
Step 1: Dependent Candidates
================================================================================

Lists every project that depends on a library version, from the dependents
index (DependentsIndex/build_index.py; local directory or HTTPS URL), in the
two orders the collection loop (collect.py) walks:

    rank_reach    by reach (number of projects that depend on the dependent),
                  highest first; only dependents with reach > 0 are ranked
    rank_random   seeded random order; every project has the same chance

Before ranking: test-scoped dependencies are dropped (their main jar never calls
the library) and each dependent project keeps only its latest release.

OUTPUT:
    candidates.csv   release_id, artifact_id, depGroupId, depArtifactId, Depversion,
                     reach, release_ts, rank_reach, rank_random
                     (same leading columns as the dataset's processed_csvs/)
================================================================================
"""

import csv
import random
from pathlib import Path

import duckdb

CANDIDATE_COLUMNS = ["release_id", "artifact_id", "depGroupId", "depArtifactId", "Depversion",
                     "reach", "release_ts", "rank_reach", "rank_random"]


def is_url(index):
    return str(index).startswith(("http://", "https://", "s3://"))


def index_files(index, name):
    """Index files named `name`: the base file plus libraries added with add-library.

    Remote indexes (URLs) only have the base file.
    """
    if is_url(index):
        return [f"{str(index).rstrip('/')}/{name}"]
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
    """Return (counts, dependents) where dependents has one row per project, highest reach first."""
    edge_files = index_files(index, "edges.parquet")
    edges = parquet_source(edge_files, [
        ("library_ga", "VARCHAR"), ("library_version", "VARCHAR"), ("scope", "VARCHAR"),
        ("dependent_ga", "VARCHAR"), ("dependent_version", "VARCHAR")])
    releases = parquet_source(index_files(index, "releases.parquet"), [
        ("dependent_ga", "VARCHAR"), ("dependent_version", "VARCHAR"), ("release_ts", "BIGINT")])
    reach = parquet_source(index_files(index, "reach.parquet"),
                           [("ga", "VARCHAR"), ("reach", "BIGINT")])
    con = duckdb.connect()
    # Indexes built before releases.parquet existed have release_ts in the edges
    columns = [c for (c, *_) in con.execute(f"DESCRIBE SELECT * FROM {edges}").fetchall()]
    ts_in_edges = "release_ts" in columns
    # DISTINCT: a library added with add-library may also be in the base index
    con.execute(f"""
        CREATE TEMP TABLE matched AS
        SELECT DISTINCT library_ga, library_version, scope, dependent_ga, dependent_version
               {", release_ts" if ts_in_edges else ""}
        FROM {edges}
        WHERE library_ga = ? AND library_version = ?
    """, [library, version])
    if not ts_in_edges:
        con.execute(f"""
            CREATE TEMP TABLE with_ts AS
            SELECT m.*, r.release_ts
            FROM matched m
            LEFT JOIN (SELECT dependent_ga, dependent_version, max(release_ts) AS release_ts
                       FROM {releases}
                       WHERE dependent_ga IN (SELECT dependent_ga FROM matched)
                       GROUP BY ALL) r
              USING (dependent_ga, dependent_version)
        """)
        con.execute("DROP TABLE matched")
        con.execute("ALTER TABLE with_ts RENAME TO matched")

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


def random_order(dependents, seed):
    """Seeded random order of the dependents, independent of their input order."""
    ordered = sorted(dependents, key=lambda d: d["dependent_ga"])
    random.Random(seed).shuffle(ordered)
    return ordered


def rank_candidates(dependents, seed):
    """Add rank_reach (1.., reach > 0 only) and rank_random (1..) to each dependent."""
    ranked = [dict(d, rank_reach=None, rank_random=None) for d in dependents]
    by_ga = {d["dependent_ga"]: d for d in ranked}
    with_reach = sorted((d for d in ranked if d["reach"] > 0), key=lambda d: (-d["reach"], d["dependent_ga"]))
    for i, d in enumerate(with_reach, 1):
        d["rank_reach"] = i
    for i, d in enumerate(random_order(ranked, seed), 1):
        by_ga[d["dependent_ga"]]["rank_random"] = i
    return ranked


def write_candidates(path, library, candidates):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CANDIDATE_COLUMNS)
        writer.writeheader()
        for d in candidates:
            group_id, artifact_id = d["dependent_ga"].split(":", 1)
            writer.writerow({
                "release_id": f"{d['dependent_ga']}:{d['dependent_version']}",
                "artifact_id": library,
                "depGroupId": group_id,
                "depArtifactId": artifact_id,
                "Depversion": d["dependent_version"],
                "reach": d["reach"],
                "release_ts": "" if d["release_ts"] is None else d["release_ts"],
                "rank_reach": "" if d["rank_reach"] is None else d["rank_reach"],
                "rank_random": d["rank_random"],
            })


def read_candidates(path):
    """Candidates as dicts with dependent_ga, reach and integer ranks (None if unranked)."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["dependent_ga"] = f"{r['depGroupId']}:{r['depArtifactId']}"
        r["reach"] = int(r["reach"] or 0)
        r["rank_reach"] = int(r["rank_reach"]) if r["rank_reach"] else None
        r["rank_random"] = int(r["rank_random"]) if r["rank_random"] else None
    return rows


def run(workspace, index, seed=42, include_test_scope=False):
    """Step 1 for a workspace: writes candidates.csv; returns counts."""
    counts, dependents = load_dependents(index, workspace.library_ga, workspace.version, include_test_scope)
    candidates = rank_candidates(dependents, seed)
    write_candidates(workspace.candidates_csv, workspace.library_ga, candidates)
    return {**counts, "candidates": len(candidates),
            "ranked_by_reach": sum(1 for c in candidates if c["rank_reach"] is not None)}
