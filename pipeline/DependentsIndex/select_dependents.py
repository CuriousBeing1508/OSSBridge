#!/usr/bin/env python3
"""
================================================================================
Step 1: Dependent Candidates (command line)
================================================================================

Writes the ranked list of every project that depends on a library version, using
the dependents index built by build_index.py (local directory or HTTPS URL). The
collection loop (ossbridge_pipeline/collect.py) then walks this list to find the
dependents that use the library. See ossbridge_pipeline/candidates.py.

OUTPUT:
    <out>               candidates.csv (default: the run folder
                        data/runs/<group>__<artifact>@<version>/candidates.csv)
    <out>.summary.json  counts before/after each filter

USAGE:
    python select_dependents.py --index ../../data/dependents-index \
        --library commons-codec:commons-codec --version 1.15 --fetch-missing
================================================================================
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline.candidates import (is_url, load_dependents, rank_candidates,  # noqa: E402
                                           write_candidates)
from ossbridge_pipeline.workspace import Workspace  # noqa: E402


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
    parser = argparse.ArgumentParser(description="List and rank the dependents of a library version")
    parser.add_argument("--index", required=True, help="Index directory or HTTPS base URL")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--seed", type=int, default=42, help="Seed of the random order")
    parser.add_argument("--include-test-scope", action="store_true")
    parser.add_argument("--fetch-missing", action="store_true",
                        help="If the library version is not in the index, add the library "
                             "from Neo4j (NEO4J_URI/USER/PASSWORD) and retry")
    parser.add_argument("--out", help="Output CSV (default: candidates.csv in the run folder)")
    args = parser.parse_args()

    counts, dependents = load_dependents(args.index, args.library, args.version, args.include_test_scope)
    if counts["releases"] == 0 and args.fetch_missing:
        fetch_missing(args)
        counts, dependents = load_dependents(args.index, args.library, args.version, args.include_test_scope)
    if not dependents:
        hint = "" if args.fetch_missing else " (use --fetch-missing to look it up in Neo4j)"
        sys.exit(f"No dependents found for {args.library}:{args.version} in the index{hint}")

    candidates = rank_candidates(dependents, args.seed)
    out = Path(args.out) if args.out else Workspace(args.library, args.version).candidates_csv
    write_candidates(out, args.library, candidates)
    summary = {
        "library": args.library,
        "version": args.version,
        "index": args.index,
        "params": {"seed": args.seed, "include_test_scope": args.include_test_scope},
        "dependent_releases": counts["releases"],
        "dependent_releases_non_test": counts["releases_non_test"],
        "dependent_projects": counts["projects"],
        "ranked_by_reach": sum(1 for c in candidates if c["rank_reach"] is not None),
    }
    out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    print(f"{args.library}:{args.version}")
    print(f"  dependent releases      : {summary['dependent_releases']:,}")
    print(f"  after test-scope filter : {summary['dependent_releases_non_test']:,}")
    print(f"  dependent projects      : {summary['dependent_projects']:,}")
    print(f"  ranked by reach         : {summary['ranked_by_reach']:,}")
    print(f"  saved {out}")


if __name__ == "__main__":
    main()
