#!/usr/bin/env python3
"""
================================================================================
Verify a Collection
================================================================================

The collection loop deletes the dependent jars after analyzing them, keeping
their SHA-256 (dependent-jars.csv) and the SHA-256 of the library jar and the
analyzer (collection.json). This check shows that the stored results can be
reproduced:

    1. Download a random sample of the selected dependents again and check that
       each jar has the recorded SHA-256 (Maven Central releases cannot change).
    2. Check the library jar and the analyzer against their recorded SHA-256.
    3. Analyze the sample again and compare the rows with usage.csv.

A changed analyzer is reported, since its results can then differ for good
reason (e.g. after a fix); the comparison is still made.

USAGE:
    python -m ossbridge_pipeline.verify --library commons-codec:commons-codec --version 1.17.1 --sample 10
================================================================================
"""

import argparse
import csv
import json
import random
import sys
import tempfile
from collections import Counter
from pathlib import Path

from .coords import MAVEN_CENTRAL
from .download_jars import download_one, download_releases, sha256_of
from .usage_analysis import USAGE_COLUMNS, analyze_usage, analyzer_jar
from .workspace import Workspace


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def usage_rows(path, jars):
    """Usage rows of the given jars as a multiset (row order does not matter)."""
    return Counter(tuple(row[c] for c in USAGE_COLUMNS) for row in read_csv(path) if row["dependent_jar"] in jars)


def verify(workspace, sample=10, seed=0, base_url=MAVEN_CENTRAL):
    collection = json.loads(workspace.collection_json.read_text(encoding="utf-8"))
    recorded = {r["release_id"]: r for r in read_csv(workspace.dependent_jars_status)}
    selected = [r["release_id"] for r in read_csv(workspace.dependents_csv) if r["selected"] == "True"]
    picked = sorted(random.Random(seed).sample(selected, min(sample, len(selected))))
    result = {"checked": len(picked), "jar_mismatches": [], "usage_mismatches": [],
              "library_jar_matches": None, "analyzer_changed": None}

    with tempfile.TemporaryDirectory(prefix="ossbridge-verify-") as tmp:
        tmp = Path(tmp)
        library_jar = workspace.library_jar
        if not library_jar.exists():
            download_one(f"{workspace.library_ga}:{workspace.version}", tmp, base_url)
            library_jar = tmp / workspace.library_jar.name
        result["library_jar_matches"] = sha256_of(library_jar) == collection["library_jar_sha256"]
        result["analyzer_changed"] = sha256_of(analyzer_jar()) != collection["analyzer_jar_sha256"]

        downloads = download_releases(picked, tmp / "jars", base_url=base_url)
        for d in downloads:
            if d["sha256"] != recorded[d["release_id"]]["sha256"]:
                result["jar_mismatches"].append(d["release_id"])

        jars = [tmp / "jars" / d["file"] for d in downloads if d["status"] in ("downloaded", "present")]
        if jars:
            analyze_usage(library_jar, None, tmp / "usage.csv", tmp / "summary.csv", jars=jars)
            names = {j.name for j in jars}
            again, stored = usage_rows(tmp / "usage.csv", names), usage_rows(workspace.usage_csv, names)
            for name in sorted(names):
                if Counter({k: v for k, v in again.items() if k[0] == name}) != \
                        Counter({k: v for k, v in stored.items() if k[0] == name}):
                    result["usage_mismatches"].append(name)

    result["ok"] = (not result["jar_mismatches"] and not result["usage_mismatches"]
                    and result["library_jar_matches"])
    return result


def main():
    parser = argparse.ArgumentParser(description="Check that a collection's usage results can be reproduced")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--sample", type=int, default=10, help="Selected dependents to check")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    ws = Workspace(args.library, args.version)
    if not ws.collection_json.exists():
        sys.exit(f"{ws.collection_json} not found; run the collection loop first")
    r = verify(ws, args.sample, args.seed)
    print(f"  dependents checked      : {r['checked']}")
    print(f"  jar SHA-256 mismatches  : {len(r['jar_mismatches'])} {r['jar_mismatches'] or ''}")
    print(f"  usage mismatches        : {len(r['usage_mismatches'])} {r['usage_mismatches'] or ''}")
    print(f"  library jar matches     : {r['library_jar_matches']}")
    if r["analyzer_changed"]:
        print("  note: the analyzer differs from the one used for the collection")
    print("  result: " + ("reproduced" if r["ok"] else "NOT reproduced"))
    if not r["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
