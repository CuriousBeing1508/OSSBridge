#!/usr/bin/env python3
"""
================================================================================
Step 2: Download Dependent Jars
================================================================================

Downloads the jar of each dependent release listed in a dependents CSV
(column release_id = group:artifact:version) from Maven Central.

Each dependent gets one status, written to a status CSV:
    downloaded   new jar saved
    present      a valid jar was already there
    no_classes   jar is valid but contains no .class files (nothing to analyze)
    not_found    no jar on Maven Central (e.g. pom-only artifacts)
    failed       network error or the file is not a valid jar

Jars are written to a temporary file and checked before they are renamed, so a
partial download never looks like a finished jar. Existing invalid jars are
downloaded again. The SHA-256 of every jar is recorded, so a jar can be deleted
after analysis and later downloaded again and checked to be the same file
(releases on Maven Central cannot be changed).

USAGE:
    python -m ossbridge_pipeline.download_jars \
        --dependents ../data/selections/commons-codec-1.17.1.csv \
        --out ../data/runs/commons-codec__commons-codec@1.17.1/dependent-jars
================================================================================
"""

import argparse
import csv
import hashlib
import os
import sys
import threading
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .coords import MAVEN_CENTRAL, jar_file_name, jar_url, parse_release

STATUS_COLUMNS = ["release_id", "file", "status", "bytes", "sha256", "detail"]
TIMEOUT = (10, 120)  # connect, read (seconds)
CHUNK = 1 << 16

_local = threading.local()


def session():
    """One HTTP session per thread, retrying throttling and server errors."""
    if not hasattr(_local, "session"):
        retry = Retry(total=5, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504],
                      allowed_methods=["GET"])
        s = requests.Session()
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.mount("http://", HTTPAdapter(max_retries=retry))
        s.headers["User-Agent"] = "OSSBridge-pipeline"
        _local.session = s
    return _local.session


def inspect_jar(path):
    """Return 'ok', 'no_classes' or None if the file is not a readable zip."""
    try:
        with zipfile.ZipFile(path) as jar:
            names = jar.namelist()
    except (zipfile.BadZipFile, OSError):
        return None
    return "ok" if any(n.endswith(".class") for n in names) else "no_classes"


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_one(release_id, out_dir, base_url=MAVEN_CENTRAL):
    try:
        group, artifact, version = parse_release(release_id)
    except ValueError as e:
        return {"release_id": release_id, "file": "", "status": "failed", "bytes": 0, "sha256": "",
                "detail": str(e)}

    name = jar_file_name(group, artifact, version)
    dest = Path(out_dir) / name
    result = {"release_id": release_id, "file": name, "bytes": 0, "sha256": "", "detail": ""}

    if dest.exists():
        kind = inspect_jar(dest)
        if kind is not None:
            return dict(result, status="present" if kind == "ok" else "no_classes",
                        bytes=dest.stat().st_size, sha256=sha256_of(dest))

    url = jar_url(group, artifact, version, base_url)
    part = dest.with_name(dest.name + ".part")
    digest = hashlib.sha256()
    try:
        with session().get(url, stream=True, timeout=TIMEOUT) as resp:
            if resp.status_code == 404:
                return dict(result, status="not_found", detail=url)
            if resp.status_code != 200:
                return dict(result, status="failed", detail=f"HTTP {resp.status_code}: {url}")
            with open(part, "wb") as f:
                for chunk in resp.iter_content(CHUNK):
                    f.write(chunk)
                    digest.update(chunk)
    except requests.RequestException as e:
        part.unlink(missing_ok=True)
        return dict(result, status="failed", detail=f"{type(e).__name__}: {e}")

    kind = inspect_jar(part)
    if kind is None:
        part.unlink(missing_ok=True)
        return dict(result, status="failed", detail=f"not a valid jar: {url}")
    os.replace(part, dest)
    return dict(result, status="downloaded" if kind == "ok" else "no_classes", bytes=dest.stat().st_size,
                sha256=digest.hexdigest())


def read_release_ids(dependents_csv):
    with open(dependents_csv, newline="", encoding="utf-8") as f:
        ids = [row["release_id"].strip() for row in csv.DictReader(f) if row.get("release_id")]
    return list(dict.fromkeys(ids))  # dedupe, keep order


def download_releases(release_ids, out_dir, workers=4, base_url=MAVEN_CENTRAL, progress=None):
    """Download the jars of the given releases; returns one result per release, in input order.

    progress(done, total, result) is called after each release, e.g. to update a
    job's status.
    """
    release_ids = list(dict.fromkeys(release_ids))
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(download_one, rid, out_dir, base_url) for rid in release_ids]
        for future in as_completed(futures):
            results.append(future.result())
            if progress:
                progress(len(results), len(release_ids), results[-1])

    order = {rid: i for i, rid in enumerate(release_ids)}
    results.sort(key=lambda r: order[r["release_id"]])
    return results


def write_status(status_csv, results):
    status_csv = Path(status_csv)
    status_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(status_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=STATUS_COLUMNS)
        writer.writeheader()
        writer.writerows(results)


def count_statuses(results):
    counts = Counter(r["status"] for r in results)
    return {"total": len(results), **{s: counts.get(s, 0) for s in
                                      ("downloaded", "present", "no_classes", "not_found", "failed")}}


def download_dependent_jars(dependents_csv, out_dir, status_csv, workers=4,
                            base_url=MAVEN_CENTRAL, progress=None):
    """Download all dependent jars listed in a CSV; returns counts per status."""
    results = download_releases(read_release_ids(dependents_csv), out_dir, workers, base_url, progress)
    write_status(status_csv, results)
    return count_statuses(results)


def download_library_jar(workspace, base_url=MAVEN_CENTRAL):
    """Download the library's own jar into the workspace; returns its path."""
    workspace.dir.mkdir(parents=True, exist_ok=True)
    result = download_one(f"{workspace.library_ga}:{workspace.version}", workspace.dir, base_url)
    if result["status"] not in ("downloaded", "present"):
        raise RuntimeError(f"Library jar not available ({result['status']}): {result['detail']}")
    return workspace.library_jar


def run(workspace, workers=4, base_url=MAVEN_CENTRAL, progress=None):
    """Step 2 for a workspace: reads dependents.csv, fills dependent-jars/."""
    return download_dependent_jars(workspace.dependents_csv, workspace.dependent_jars_dir,
                                   workspace.dependent_jars_status, workers=workers,
                                   base_url=base_url, progress=progress)


def main():
    parser = argparse.ArgumentParser(description="Download dependent jars from Maven Central")
    parser.add_argument("--dependents", required=True, help="CSV with a release_id column")
    parser.add_argument("--out", required=True, help="Folder for the jars")
    parser.add_argument("--status", help="Status CSV (default: <out>.csv)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel downloads")
    parser.add_argument("--base-url", default=MAVEN_CENTRAL)
    args = parser.parse_args()

    def progress(done, total, result):
        print(f"\r  {done}/{total}  {result['status']:<10} {result['release_id'][:60]:<60}", end="", flush=True)

    summary = download_dependent_jars(args.dependents, args.out, args.status or f"{args.out.rstrip('/')}.csv",
                                      workers=args.workers, base_url=args.base_url, progress=progress)
    print()
    print("  " + ", ".join(f"{k}: {v}" for k, v in summary.items()))
    if summary["total"] and summary["failed"] == summary["total"]:
        sys.exit("All downloads failed")


if __name__ == "__main__":
    main()
