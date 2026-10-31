#!/usr/bin/env python3
"""
================================================================================
Collection Loop: Steps 2 and 3 Until Enough Dependents Use the Library
================================================================================

Many declared dependents never call the library directly (they only pass it on
to their own users), so a fixed list of dependents gives an unpredictable
number of real users. This loop walks the ranked candidates (candidates.py) in
batches, downloads and analyzes each batch, and keeps the dependents that use
the library, until it has enough:

    Tier A (top)     walk candidates by reach, highest first, until top_target
                     using dependents are selected
    Tier B (random)  walk the seeded random order, skipping dependents already
                     tried, until the total reaches target

The loop stops when the target is reached, the candidates run out, or max_tried
candidates have been tried. If fewer using dependents exist than the target, it
keeps what it found and reports the shortfall.

Jars are only needed while they are analyzed: jars of dependents that are not
selected are deleted after each batch, and the selected ones at the end (unless
keep_jars). The SHA-256 of every jar is kept in dependent-jars.csv, so the
analysis can be checked later by downloading them again (see verify.py).

OUTPUT (in the workspace):
    dependents.csv       every candidate tried: tier, rank, download status,
                         whether it uses the library, whether it was selected
    dependent-jars.csv   download status and SHA-256 of every tried candidate
    usage.csv            usage rows of the selected dependents
    usage-summary.csv    analyzer summary of every analyzed jar
    collection.json      parameters, counts, stop reasons, whether the target was
                         reached, and the SHA-256 of the library jar and analyzer
    batches/             per-batch analyzer output

USAGE:
    python -m ossbridge_pipeline.collect --library commons-codec:commons-codec --version 1.17.1
================================================================================
"""

import argparse
import csv
import json
import shutil
import sys
from collections import Counter

from .candidates import read_candidates
from .coords import MAVEN_CENTRAL, jar_file_name, parse_release
from .download_jars import download_library_jar, download_releases, sha256_of, write_status
from .usage_analysis import SUMMARY_COLUMNS, USAGE_COLUMNS, analyze_usage, analyzer_jar, jars_using_library
from .workspace import Workspace

DEFAULTS = {"target": 400, "top_target": 300, "batch_size": 50, "max_tried": 3000}

DEPENDENT_COLUMNS = ["release_id", "dependent_ga", "reach", "tier", "rank", "download_status",
                     "uses_library", "selected", "reason"]
ANALYZABLE = ("downloaded", "present")


class Collection:
    def __init__(self, workspace, candidates, library_jar, params, workers, base_url, progress, keep_jars=False):
        self.keep_jars = keep_jars
        self.ws = workspace
        self.candidates = candidates
        self.library_jar = library_jar
        self.p = params
        self.workers = workers
        self.base_url = base_url
        self.progress = progress
        self.tried = {}                    # release_id -> record
        self.downloads = []
        self.selected = Counter()          # tier -> count
        self.batch_no = 0
        self.stop_reasons = {}

    def walk(self, tier, rank_key, quota):
        """Select up to quota using dependents of this tier; returns the stop reason."""
        remaining = sorted((c for c in self.candidates if c[rank_key] is not None), key=lambda c: c[rank_key])
        while self.selected[tier] < quota:
            budget = self.p["max_tried"] - len(self.tried)
            if budget <= 0:
                return "max_tried"
            batch = self.next_batch(remaining, min(self.p["batch_size"], budget))
            if not batch:
                return "candidates_exhausted"
            self.process(batch, tier, rank_key, quota)
        return "target_reached"

    def next_batch(self, remaining, size):
        """The next candidates in order that have not been tried yet (e.g. by the other tier)."""
        remaining[:] = [c for c in remaining if c["release_id"] not in self.tried]
        batch = remaining[:size]
        del remaining[:size]
        return batch

    def process(self, batch, tier, rank_key, quota):
        self.batch_no += 1
        results = download_releases([c["release_id"] for c in batch], self.ws.dependent_jars_dir,
                                    workers=self.workers, base_url=self.base_url)
        self.downloads += results
        status = {r["release_id"]: r["status"] for r in results}

        jar_names = {c["release_id"]: jar_file_name(*parse_release(c["release_id"])) for c in batch}
        jars = [self.ws.dependent_jars_dir / jar_names[c["release_id"]]
                for c in batch if status[c["release_id"]] in ANALYZABLE]
        users = set()
        if jars:
            usage_csv, summary_csv = self.batch_files(self.batch_no)
            analyze_usage(self.library_jar, None, usage_csv, summary_csv, jars=jars)
            users = jars_using_library(usage_csv)

        for c in batch:
            uses = jar_names[c["release_id"]] in users
            record = {"release_id": c["release_id"], "dependent_ga": c["dependent_ga"], "reach": c["reach"],
                      "tier": tier, "rank": c[rank_key], "download_status": status[c["release_id"]],
                      "uses_library": uses, "selected": False, "reason": ""}
            if status[c["release_id"]] not in ANALYZABLE:
                record["reason"] = f"jar {status[c['release_id']]}"
            elif not uses:
                record["reason"] = "no library usage"
            elif self.selected[tier] >= quota:
                record["reason"] = "tier full"
            else:
                record["selected"] = True
                self.selected[tier] += 1
            self.tried[c["release_id"]] = record
            if not record["selected"]:
                (self.ws.dependent_jars_dir / jar_names[c["release_id"]]).unlink(missing_ok=True)

        if self.progress:
            self.progress({"batch": self.batch_no, "tier": tier, "tried": len(self.tried),
                           "selected": sum(self.selected.values()), "target": self.p["target"]})

    def batch_files(self, n):
        self.ws.batches_dir.mkdir(parents=True, exist_ok=True)
        return (self.ws.batches_dir / f"batch-{n:03d}-usage.csv",
                self.ws.batches_dir / f"batch-{n:03d}-summary.csv")

    def write_outputs(self):
        records = list(self.tried.values())
        with open(self.ws.dependents_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=DEPENDENT_COLUMNS)
            writer.writeheader()
            writer.writerows(records)
        write_status(self.ws.dependent_jars_status, self.downloads)

        selected_jars = {jar_file_name(*parse_release(r["release_id"])) for r in records if r["selected"]}
        concat_csv(sorted(self.ws.batches_dir.glob("batch-*-usage.csv")), self.ws.usage_csv, USAGE_COLUMNS,
                   keep=lambda row: row["dependent_jar"] in selected_jars)
        concat_csv(sorted(self.ws.batches_dir.glob("batch-*-summary.csv")), self.ws.usage_summary_csv,
                   SUMMARY_COLUMNS)

        if not self.keep_jars:
            for name in selected_jars:
                (self.ws.dependent_jars_dir / name).unlink(missing_ok=True)
            if self.ws.dependent_jars_dir.exists() and not any(self.ws.dependent_jars_dir.iterdir()):
                self.ws.dependent_jars_dir.rmdir()
        return records

    def summary(self, records):
        analyzed = [r for r in records if r["download_status"] in ANALYZABLE]
        using = [r for r in analyzed if r["uses_library"]]
        selected = [r for r in records if r["selected"]]
        total_reach = sum(c["reach"] for c in self.candidates)
        selected_reach = sum(r["reach"] for r in selected)
        target = self.p["target"]
        if len(selected) >= target:
            message = f"Selected {len(selected)} dependents that use the library (target {target})."
        elif "max_tried" in self.stop_reasons.values():
            message = (f"Found {len(selected)} of {target} dependents that use the library: stopped after "
                       f"trying {len(records)} candidates (max_tried).")
        else:
            message = (f"Found {len(selected)} of {target} dependents that use the library: all "
                       f"{len(records)} candidates were tried; no more dependents of this version are known.")
        analyzer = analyzer_jar()
        return {
            "library": self.ws.library_ga,
            "version": self.ws.version,
            "message": message,
            "target_reached": len(selected) >= target,
            "shortfall": max(0, target - len(selected)),
            "params": self.p,
            "candidates": len(self.candidates),
            "tried": len(records),
            "jar_available": len(analyzed),
            "using_library": len(using),
            "using_share_pct": round(100 * len(using) / len(analyzed), 1) if analyzed else None,
            "selected": len(selected),
            "selected_top": self.selected["A"],
            "selected_random": self.selected["B"],
            "reach_total": total_reach,
            "reach_selected": selected_reach,
            "reach_covered_pct": round(100 * selected_reach / total_reach, 1) if total_reach else None,
            "stop_reasons": self.stop_reasons,
            "batches": self.batch_no,
            "jars_kept": self.keep_jars,
            # To check the analysis later (verify.py): which library jar and analyzer produced it
            "library_jar": self.library_jar.name,
            "library_jar_sha256": sha256_of(self.library_jar),
            "analyzer_jar": analyzer.name,
            "analyzer_jar_sha256": sha256_of(analyzer),
        }


def concat_csv(parts, out, columns, keep=None):
    """Concatenate CSV files with the given header, optionally filtering rows."""
    with open(out, "w", newline="", encoding="utf-8") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=columns)
        writer.writeheader()
        for part in parts:
            with open(part, newline="", encoding="utf-8") as f_in:
                for row in csv.DictReader(f_in):
                    if keep is None or keep(row):
                        writer.writerow(row)


def collect_using_dependents(workspace, target=DEFAULTS["target"], top_target=DEFAULTS["top_target"],
                             batch_size=DEFAULTS["batch_size"], max_tried=DEFAULTS["max_tried"], workers=4,
                             base_url=MAVEN_CENTRAL, progress=None, keep_jars=False):
    """Run steps 2 and 3 in batches over candidates.csv; returns the collection summary.

    progress(event) is called after each batch with tried/selected counts. Jars of
    dependents that are not selected are always deleted; keep_jars keeps the selected ones.
    """
    params = {"target": target, "top_target": min(top_target, target), "batch_size": batch_size,
              "max_tried": max_tried}
    candidates = read_candidates(workspace.candidates_csv)
    library_jar = workspace.library_jar if workspace.library_jar.exists() else \
        download_library_jar(workspace, base_url)
    if workspace.batches_dir.exists():
        shutil.rmtree(workspace.batches_dir)

    c = Collection(workspace, candidates, library_jar, params, workers, base_url, progress, keep_jars)
    c.stop_reasons["top"] = c.walk("A", "rank_reach", params["top_target"])
    c.stop_reasons["random"] = c.walk("B", "rank_random", target - c.selected["A"])
    records = c.write_outputs()
    summary = c.summary(records)
    workspace.collection_json.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def run(workspace, progress=None, **params):
    """Steps 2 and 3 for a workspace with candidates.csv (step 1)."""
    return collect_using_dependents(workspace, progress=progress, **params)


def main():
    parser = argparse.ArgumentParser(description="Download and analyze dependents until enough use the library")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    parser.add_argument("--target", type=int, default=DEFAULTS["target"], help="Using dependents to select")
    parser.add_argument("--top-target", type=int, default=DEFAULTS["top_target"],
                        help="How many of them are taken in order of reach (the rest at random)")
    parser.add_argument("--batch-size", type=int, default=DEFAULTS["batch_size"])
    parser.add_argument("--max-tried", type=int, default=DEFAULTS["max_tried"],
                        help="Stop after trying this many candidates")
    parser.add_argument("--keep-jars", action="store_true",
                        help="Keep the jars of the selected dependents (others are always deleted)")
    args = parser.parse_args()

    def progress(e):
        print(f"\r  batch {e['batch']} (tier {e['tier']}): tried {e['tried']}, "
              f"selected {e['selected']}/{e['target']}   ", end="", flush=True)

    ws = Workspace(args.library, args.version)
    if not ws.candidates_csv.exists():
        sys.exit(f"{ws.candidates_csv} not found; run step 1 (DependentsIndex/select_dependents.py) first")
    summary = run(ws, progress=progress, target=args.target, top_target=args.top_target,
                  batch_size=args.batch_size, max_tried=args.max_tried, keep_jars=args.keep_jars)
    print()
    print(f"  {summary['message']}")
    for key in ("candidates", "tried", "jar_available", "using_library", "using_share_pct", "selected",
                "selected_top", "selected_random", "reach_covered_pct", "stop_reasons"):
        print(f"  {key:<24}: {summary[key]}")


if __name__ == "__main__":
    main()
