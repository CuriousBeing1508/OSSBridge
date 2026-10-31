#!/usr/bin/env python3
"""
================================================================================
Run the Whole Pipeline for a Library Version
================================================================================

    python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.16

Runs the two branches and stores the results:

    usage branch   1 dependents (candidates.py)  ->  2+3 collection loop (collect.py)
    API branch     4 API (public_api.py)  ->  5 coverage (coverage.py)  ->  6 API coverage
    then           7 store results (store_results.py)

A failed step does not stop the run: the other branch still runs, steps that need
its output are skipped, and step 7 stores what there is. Each step's status,
duration and summary are written to run.json in the run folder (also while the
run is going on), and progress is printed as the run goes.

Step statuses: ok | failed | skipped. The exit code is 0 when step 7 stored the
results, even if some steps failed (see run.json), and 1 otherwise.
================================================================================
"""

import argparse
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from . import api_coverage, candidates, collect, coverage, public_api, store_results
from .coords import parse_release
from .workspace import DEFAULT_ROOT, Workspace

DEFAULT_INDEX = Path(__file__).resolve().parents[2] / "data" / "dependents-index"

STEPS = [
    ("dependents", "1 Dependents"),
    ("collect", "2-3 Download and analyze dependents"),
    ("api", "4 Library API"),
    ("coverage", "5 Test coverage"),
    ("api_coverage", "6 API coverage"),
    ("store", "7 Store results"),
]


class StepFailed(Exception):
    pass


class Run:
    def __init__(self, workspace, options, progress):
        self.ws = workspace
        self.options = options
        self.progress = progress
        self.record = {"library": workspace.library_ga, "version": workspace.version,
                       "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                       "options": {k: v for k, v in options.items() if k != "results_dir"},
                       "status": "running",
                       "steps": {name: {"title": title, "status": "pending"} for name, title in STEPS}}

    def save(self):
        self.ws.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.ws.run_json.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.record, indent=2, default=str) + "\n", encoding="utf-8")
        tmp.replace(self.ws.run_json)

    def step(self, name, function, needs=()):
        """Run one step unless a step it needs did not succeed; record the outcome."""
        entry = self.record["steps"][name]
        missing = [n for n in needs if self.record["steps"][n]["status"] != "ok"]
        if missing:
            entry.update(status="skipped", detail=f"needs {', '.join(missing)}")
            self.progress(name, "skipped", entry["detail"])
            self.save()
            return None
        entry["status"] = "running"
        self.save()
        self.progress(name, "start", "")
        started = time.time()
        try:
            summary = function()
            entry.update(status="ok", summary=summary)
        except StepFailed as e:
            entry.update(status="failed", detail=str(e))
        except Exception as e:   # a step's bug or environment problem must not stop the other branch
            entry.update(status="failed", detail=f"{type(e).__name__}: {e}",
                         traceback=traceback.format_exc(limit=5))
        entry["seconds"] = round(time.time() - started)
        self.progress(name, entry["status"], entry.get("detail", ""))
        self.save()
        return entry.get("summary")


def run_pipeline(library_ga, version, index=DEFAULT_INDEX, target=collect.DEFAULTS["target"],
                 top_target=collect.DEFAULTS["top_target"], max_tried=collect.DEFAULTS["max_tried"],
                 fetch_missing=False, skip_coverage=False, keep_jars=False, timeout=coverage.DEFAULT_TIMEOUT,
                 root=DEFAULT_ROOT, results_dir=store_results.DEFAULT_RESULTS, progress=None):
    """Run steps 1-7 for a library version; returns the run record (also in run.json)."""
    progress = progress or (lambda step, event, detail: None)
    ws = Workspace(library_ga, version, root=root)
    options = {"index": str(index), "target": target, "top_target": top_target, "max_tried": max_tried,
               "fetch_missing": fetch_missing, "skip_coverage": skip_coverage, "keep_jars": keep_jars,
               "timeout": timeout}
    r = Run(ws, options, progress)
    r.save()

    def dependents():
        summary = candidates.run(ws, index)
        if summary["releases"] == 0 and fetch_missing:
            summary = fetch_from_neo4j(ws, index)
        if summary["candidates"] == 0:
            raise StepFailed(f"no dependents of {library_ga}:{version} in the dependents index"
                             + ("" if fetch_missing else " (--fetch-missing looks the library up in Neo4j)"))
        return summary

    def collection():
        return collect.run(ws, target=target, top_target=top_target, max_tried=max_tried, keep_jars=keep_jars,
                           progress=lambda e: progress("collect", "progress",
                                                       f"batch {e['batch']} (tier {e['tier']}): tried {e['tried']}, "
                                                       f"selected {e['selected']}/{e['target']}"))

    def test_coverage():
        if skip_coverage:
            raise StepFailed("skipped with --skip-coverage")
        summary = coverage.run(ws, timeout=timeout,
                               progress=lambda stage, detail: progress("coverage", "progress", f"{stage}: {detail}"))
        if summary["status"] != "ok":
            raise StepFailed(f"coverage {summary['status']}: {summary['detail']}")
        return {k: summary[k] for k in ("repository", "tag", "build_tool", "jdk", "tests", "seconds")}

    r.step("dependents", dependents)
    r.step("collect", collection, needs=["dependents"])
    r.step("api", lambda: public_api.run(ws))
    r.step("coverage", test_coverage, needs=["api"])
    r.step("api_coverage", lambda: api_coverage.run(ws), needs=["api", "coverage"])
    r.step("store", lambda: store_results.run(ws, results_dir))

    statuses = [s["status"] for s in r.record["steps"].values()]
    r.record["status"] = ("ok" if all(s == "ok" for s in statuses)
                          else "partial" if r.record["steps"]["store"]["status"] == "ok" else "failed")
    r.record["finished_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    r.save()
    return r.record


def fetch_from_neo4j(ws, index):
    """Add the library to the dependents index from Neo4j (DependentsIndex/build_index.py), then rank again."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "DependentsIndex"))
    import build_index

    if build_index.add_library(index, ws.library_ga) is None:
        raise StepFailed(f"Neo4j has no dependents of {ws.library_ga}")
    return candidates.run(ws, index)


def main():
    parser = argparse.ArgumentParser(description="Run the OSSBridge pipeline for a library version")
    parser.add_argument("release", help="groupId:artifactId:version, e.g. org.mybatis:mybatis:3.5.16")
    parser.add_argument("--index", default=str(DEFAULT_INDEX), help="Dependents index directory or HTTPS URL")
    parser.add_argument("--target", type=int, default=collect.DEFAULTS["target"],
                        help="Dependents that use the library to select")
    parser.add_argument("--top-target", type=int, default=collect.DEFAULTS["top_target"],
                        help="How many of them are taken in order of reach (the rest at random)")
    parser.add_argument("--max-tried", type=int, default=collect.DEFAULTS["max_tried"])
    parser.add_argument("--fetch-missing", action="store_true",
                        help="Add the library from Neo4j if it is not in the dependents index")
    parser.add_argument("--skip-coverage", action="store_true", help="Do not run the library's test suite")
    parser.add_argument("--keep-jars", action="store_true", help="Keep the selected dependents' jars")
    parser.add_argument("--timeout", type=int, default=coverage.DEFAULT_TIMEOUT,
                        help="Seconds per test-suite build attempt")
    parser.add_argument("--results", default=str(store_results.DEFAULT_RESULTS), help="Results folder")
    args = parser.parse_args()
    try:
        group, artifact, version = parse_release(args.release)
    except ValueError as e:
        sys.exit(str(e))

    started = time.time()
    titles = dict(STEPS)
    state = {"line": False}

    def progress(step, event, detail):
        elapsed = int(time.time() - started)
        stamp = f"[{elapsed // 60:02d}:{elapsed % 60:02d}]"
        if event == "progress":
            print(f"\r  {stamp} {detail}"[:140].ljust(140), end="", flush=True)
            state["line"] = True
            return
        if state["line"]:
            print()
            state["line"] = False
        text = {"start": "...", "ok": "done", "failed": f"FAILED: {detail}", "skipped": f"skipped ({detail})"}[event]
        print(f"{stamp} {titles[step]}: {text}", flush=True)

    record = run_pipeline(f"{group}:{artifact}", version, index=args.index, target=args.target,
                          top_target=args.top_target, max_tried=args.max_tried, fetch_missing=args.fetch_missing,
                          skip_coverage=args.skip_coverage, keep_jars=args.keep_jars, timeout=args.timeout,
                          results_dir=Path(args.results), progress=progress)
    print(f"\nRun {record['status']}: {Workspace(f'{group}:{artifact}', version).run_json}")
    collection = record["steps"]["collect"].get("summary")
    if collection:
        print(f"  {collection['message']}")
    api_cov = record["steps"]["api_coverage"].get("summary")
    if api_cov:
        print(f"  API coverage: {api_cov['covered_pct']}% of {api_cov['apis']} APIs")
    sys.exit(0 if record["steps"]["store"]["status"] == "ok" else 1)


if __name__ == "__main__":
    main()
