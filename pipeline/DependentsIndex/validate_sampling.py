#!/usr/bin/env python3
"""
================================================================================
Sampling Validation
================================================================================

Checks whether analyzing a sample of dependents gives the same API ranking as
analyzing all of them, using existing full usage-analysis results
(StaticAnaResults/<lib>-<version>/Dependents/*_third_party_calls.csv).

For each analyzed project (latest analyzed release per groupId:artifactId),
an API's popularity is the number of projects that call it. The ranking from
the full set is compared with rankings from stratified samples of several
sizes, over several seeds:
    top-20 overlap   share of the full top-20 APIs found in the sample top-20
    kendall tau      rank agreement on the full top-50 APIs
    found >=1%       share of APIs used by >=1% of projects that the sample finds

USAGE:
    python validate_sampling.py \
        --dependents-dir ../../data/dataset/StaticAnaResults/commons-codec-1.17.1/Dependents \
        --dependents-csv ../../data/dataset/processed_csvs/commons-codec:commons-codec-1.17.1.csv \
        --package org.apache.commons.codec
================================================================================
"""

import argparse
import csv
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

from select_dependents import stratified_sample

SUFFIX = "_third_party_calls.csv"


def jar_key(release_id):
    """Matches the jar names written by mavenDepJarDownload.py."""
    group_id, artifact_id, version = release_id.split(":")
    return f"{group_id.replace('.', '_')}-{artifact_id}-{version}"


def load_projects(dependents_dir, dependents_csv, package):
    """Return {groupId:artifactId: set(APIs)} using the latest analyzed release per project.

    Only APIs under `package` are kept: the analysis files list calls to every
    third-party library, not just the target.
    """
    prefix = package.rstrip(".") + "."
    releases = {}
    with open(dependents_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            releases[jar_key(row["release_id"])] = row["release_id"]

    csv.field_size_limit(sys.maxsize)
    latest = {}
    unmatched = 0
    for path in Path(dependents_dir).glob(f"*{SUFFIX}"):
        release_id = releases.get(path.name[:-len(SUFFIX)])
        if release_id is None:
            unmatched += 1
            continue
        with open(path, newline="", encoding="utf-8") as f:
            apis = {row["Usage"] for row in csv.DictReader(f) if row["Usage"].startswith(prefix)}
        ga, version = release_id.rsplit(":", 1)
        # Release timestamps are not in the analysis output, so take the highest version string
        if ga not in latest or version > latest[ga][0]:
            latest[ga] = (version, apis)
    return {ga: apis for ga, (_, apis) in latest.items()}, unmatched


def ranking(project_apis):
    counts = Counter()
    for apis in project_apis:
        counts.update(apis)
    return counts


def kendall_tau(xs, ys):
    concordant = discordant = 0
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            s = (xs[i] - xs[j]) * (ys[i] - ys[j])
            if s > 0:
                concordant += 1
            elif s < 0:
                discordant += 1
    pairs = concordant + discordant
    return (concordant - discordant) / pairs if pairs else 1.0


def compare(full, sample, n_projects):
    full_top = [api for api, _ in full.most_common(50)]
    sample_top20 = {api for api, _ in sample.most_common(20)}
    common = [api for api, _ in full.most_common(1000) if api in full_top]
    threshold = 0.01 * n_projects
    frequent = [api for api, c in full.items() if c >= threshold]
    return {
        "top20_overlap": len(set(full_top[:20]) & sample_top20) / min(20, len(full_top)),
        "kendall_tau_top50": kendall_tau([full[a] for a in common], [sample.get(a, 0) for a in common]),
        "found_ge_1pct": sum(1 for a in frequent if a in sample) / len(frequent) if frequent else 1.0,
    }


def main():
    parser = argparse.ArgumentParser(description="Validate dependent sampling against a full analysis")
    parser.add_argument("--dependents-dir", required=True)
    parser.add_argument("--dependents-csv", required=True, help="Dependents list used for the full run")
    parser.add_argument("--package", required=True, help="Target library package, e.g. org.apache.commons.codec")
    parser.add_argument("--sizes", default="25,50,100,200,400")
    parser.add_argument("--seeds", type=int, default=20)
    parser.add_argument("--out", help="Optional JSON output path")
    args = parser.parse_args()

    projects, unmatched = load_projects(args.dependents_dir, args.dependents_csv, args.package)
    if not projects:
        sys.exit("No analysis files matched the dependents CSV")
    full = ranking(projects.values())
    deps = [{"dependent_ga": ga} for ga in sorted(projects)]
    print(f"Projects analyzed: {len(projects)} (unmatched files: {unmatched}), APIs used: {len(full)}")
    print(f"{'sample':>7} {'top20 overlap':>14} {'kendall tau':>12} {'found >=1%':>11}   (mean ± sd over {args.seeds} seeds)")

    results = []
    for size in (int(s) for s in args.sizes.split(",")):
        if size >= len(projects):
            break
        runs = []
        for seed in range(args.seeds):
            picked = stratified_sample(deps, size, seed)
            runs.append(compare(full, ranking(projects[d["dependent_ga"]] for d in picked), len(projects)))
        row = {"sample": size}
        for metric in runs[0]:
            values = [r[metric] for r in runs]
            row[metric] = {"mean": round(statistics.mean(values), 3), "sd": round(statistics.stdev(values), 3)}
        results.append(row)
        print(f"{size:>7} " + " ".join(
            f"{row[m]['mean']:>{w}.2f}±{row[m]['sd']:.2f}"
            for m, w in (("top20_overlap", 9), ("kendall_tau_top50", 7), ("found_ge_1pct", 6))
        ))

    if args.out:
        Path(args.out).write_text(json.dumps(
            {"projects": len(projects), "apis": len(full), "results": results}, indent=2) + "\n")


if __name__ == "__main__":
    main()
