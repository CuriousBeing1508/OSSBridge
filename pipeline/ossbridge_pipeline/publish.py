#!/usr/bin/env python3
"""
================================================================================
Publish Results to the Hugging Face Dataset
================================================================================

Uploads the result tables (data/results/) and the dependents index
(data/dependents-index/) to a Hugging Face dataset repository, and writes its
dataset card (README.md) from the current results:

    <repo>/README.md                         dataset card (tables, columns, versions, limits)
    <repo>/results/<table>/<lib>@<v>.parquet result tables (result_tables.py)
    <repo>/results/runs/<run_id>.parquet
    <repo>/dependents-index/                 dependents index (DependentsIndex/)

Only files whose content changed are transferred. The token comes from
`hf auth login` or the HF_TOKEN environment variable (GitHub Actions secret).

Before uploading, versions that other runs published meanwhile are downloaded (only
files missing locally, so the version just analyzed is never overwritten), so the card
lists every version.

USAGE:
    python -m ossbridge_pipeline.publish --download           # get the published index and results
    python -m ossbridge_pipeline.publish --download --app-only  # only the files the app reads
    python -m ossbridge_pipeline.publish                      # results, index and card
    python -m ossbridge_pipeline.publish --no-index           # skip the index
    python -m ossbridge_pipeline.publish --card-only --dry-run  # print the card only
================================================================================
"""

import argparse
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .paths import DATA_DIR, INDEX_DIR, RESULTS_DIR
from .result_tables import TABLES, VERSION_TABLES, conform, connect

DEFAULT_REPO = os.environ.get("OSSBRIDGE_HF_DATASET", "rachna1508/ossbridge-results")
CODE_URL = "https://github.com/CuriousBeing1508/OSSBridge"
ISSUES_URL = f"{CODE_URL}/issues"

TABLE_DESCRIPTIONS = {
    "library_versions": "One row per library version: dependents found, tried, using the library and selected; "
                        "test coverage status, tests run and API coverage.",
    "apis": "The API of the library jar: each class member a dependent can use (public, and protected unless the "
            "class is final), with deprecation and module export information.",
    "dependents": "Each dependent project that was tried: its release, rank, reach, download status, whether it "
                  "uses the library and whether it was selected.",
    "api_usage": "Uses of the library by each selected dependent, per target and category (method call, method "
                 "reference, field access, type reference, annotation, ...), with the declaring class and the "
                 "number of occurrences and calling classes.",
    "api_coverage": "Coverage of each API method and constructor by the library's own test suite (JaCoCo), "
                    "including coverage through overriding methods.",
    "runs": "Provenance: one row per pipeline or conversion run, with its parameters and summaries as JSON.",
}


def versions_table(results_dir):
    """Markdown rows describing the library versions in the results."""
    con = connect(results_dir)
    rows = con.execute("""
        SELECT library_ga, version, run_id, dependents_using, dependents_selected, coverage_status, tests,
               api_coverage_pct
        FROM library_versions ORDER BY library_ga, version
    """).fetchall()
    lines = ["| Library | Version | Source | Dependents using it (selected) | Test coverage | Tests | API coverage |",
             "|---|---|---|---|---|---|---|"]
    for ga, v, run_id, using, selected, cov_status, tests, pct in rows:
        source = "pipeline" if (run_id or "").startswith("pipeline") else "converted from the original dataset"
        dependents = "" if using is None else f"{using} ({selected})"
        lines.append(f"| `{ga}` | {v} | {source} | {dependents} | {cov_status or ''} | "
                     f"{'' if tests is None else f'{tests:,}'} | {'' if pct is None else f'{pct}%'} |")
    return "\n".join(lines), len(rows)


def columns_markdown(table):
    return ", ".join(f"`{f.name}`" for f in TABLES[table])


def render_card(results_dir, repo_id=DEFAULT_REPO, license_id="cc-by-4.0"):
    """The dataset card (README.md) for the current results."""
    versions, count = versions_table(results_dir)
    configs = "\n".join(
        f"- config_name: {t}\n  data_files: results/{t}/*.parquet" for t in VERSION_TABLES)
    tables = "\n".join(f"| `{t}` | {TABLE_DESCRIPTIONS[t]} |" for t in TABLES)
    columns = "\n".join(f"- **{t}**: {columns_markdown(t)}" for t in TABLES)
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"""---
license: {license_id}
pretty_name: OSSBridge results
tags:
- software-engineering
- java
- maven
- api-usage
- test-coverage
configs:
{configs}
---

# OSSBridge results

How Java libraries on Maven Central are used by the projects that depend on them, and how
well the libraries' own test suites cover the APIs those projects use. Produced by the
[OSSBridge]({CODE_URL}) data pipeline and read by the OSSBridge app.

{count} library versions (updated {updated}):

{versions}

## Tables

All tables are Parquet files, one per library version, under `results/<table>/`.
Every table starts with `library_ga` (`groupId:artifactId`) and `version`.

| Table | Contents |
|---|---|
{tables}

An API is identified by `api_id`: `<package>.<Class>.<member><descriptor>` for methods and
constructors (`<init>`), and `<package>.<Class>.<field>:<descriptor>` for fields. In
`api_usage` it is the API of the declaring class, so usage joins with `apis` and
`api_coverage` on `(library_ga, version, api_id)`.

Columns:

{columns}

`dependents-index/` holds the index of which projects depend on which library version
that the pipeline selects dependents from: `edges.parquet` (every dependency in the Goblin
graph of Maven Central), `releases.parquet` (the release date of each dependent release),
`reach.parquet` (for each artifact, the number of distinct artifacts that depend on any of
its versions), and the summaries `versions.parquet` and `libraries.parquet` (dependent
projects per library version and per library).

## How the data is produced

For each library version, the pipeline:

1. lists the projects that depend on it (dependents index, built from the Goblin Maven
   Central dependency graph), keeping each project's latest release and dropping
   test-scoped dependencies;
2. downloads dependents' jars from Maven Central and
3. analyzes their bytecode (ASM) until enough dependents that use the library are found:
   a top tier by reach and a random tier; dependents that only declare the dependency are
   counted but not selected;
4. lists the library's API from its jar;
5. builds the library from its release tag and runs its test suite with JaCoCo;
6. matches coverage to each API, following overriding methods;
7. writes these tables.

Every downloaded jar's SHA-256 and the analyzer's SHA-256 are kept in the run summaries
(`runs`), so the usage analysis can be reproduced.

## Limitations

- Dependents come from a snapshot of Maven Central (Goblin, 20 April 2025); releases after
  it have no dependents in the index.
- Versions analyzed before the index had reach values (31 October 2026) selected all
  dependents at random; each run's settings, including `top_target`, are in `runs`.
- Test coverage needs a GitHub repository with a release tag and a Maven or Gradle build;
  `coverage_status` says why when there is none.

## Use

```python
import duckdb
duckdb.sql(\"\"\"
    SELECT * FROM 'hf://datasets/{repo_id}/results/library_versions/*.parquet'
\"\"\").show()
```

```python
from datasets import load_dataset
apis = load_dataset("{repo_id}", "apis", split="train")
```

## Contact

Questions and problems: {ISSUES_URL}
"""


def quiet_hub():
    """Plain output: no progress bars (they draw tick marks)."""
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    from huggingface_hub.utils import disable_progress_bars
    disable_progress_bars()


# The app reads only these files of the dependents index.
APP_INDEX_FILES = ("libraries.parquet", "versions.parquet", "manifest.json")


def download(repo_id=DEFAULT_REPO, data_dir=DATA_DIR, folders=("results", "dependents-index"),
             only_missing=False, app_only=False):
    """Download published folders into data_dir (data_dir/results, data_dir/dependents-index).

    only_missing keeps local files and adds only those that are not there yet.
    app_only downloads only the index files that the app reads.
    Returns the number of files written.
    """
    quiet_hub()
    from huggingface_hub import snapshot_download

    patterns = []
    for f in folders:
        if f == "dependents-index" and app_only:
            patterns += [f"{f}/{name}" for name in APP_INDEX_FILES]
        else:
            patterns.append(f"{f}/**")
    with tempfile.TemporaryDirectory(prefix="ossbridge-download-") as tmp:
        snapshot_download(repo_id=repo_id, repo_type="dataset", local_dir=tmp,
                          allow_patterns=patterns)
        written = 0
        for folder in folders:
            src_root = Path(tmp) / folder
            for src in src_root.rglob("*") if src_root.exists() else []:
                if not src.is_file() or ".cache" in src.parts:
                    continue
                dest = Path(data_dir) / folder / src.relative_to(src_root)
                if only_missing and dest.exists():
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dest)
                written += 1
    return written


def publish(repo_id=DEFAULT_REPO, results_dir=RESULTS_DIR, index_dir=INDEX_DIR, include_index=True,
            card_only=False, message=None):
    """Upload results, index and card; returns what was uploaded."""
    quiet_hub()
    from huggingface_hub import HfApi

    api = HfApi()
    message = message or f"OSSBridge results {datetime.now(timezone.utc).isoformat(timespec='seconds')}"
    uploaded = []
    if not card_only:
        added = download(repo_id, Path(results_dir).parent, folders=("results",), only_missing=True)
        if added:
            print(f"  Added {added} files published meanwhile by other runs")
        conform(results_dir)   # every file of a table needs the same columns (dataset viewer)
        print(f"  Uploading result tables from {results_dir}")
        api.upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=str(results_dir),
                          path_in_repo="results", commit_message=f"{message}: result tables",
                          ignore_patterns=["*.tmp", "_reports/*"])
        uploaded.append("results")
        if include_index and Path(index_dir).exists():
            print(f"  Uploading the dependents index from {index_dir}")
            api.upload_folder(repo_id=repo_id, repo_type="dataset", folder_path=str(index_dir),
                              path_in_repo="dependents-index", commit_message=f"{message}: dependents index",
                              ignore_patterns=["_raw/*", "*.tmp"])
            uploaded.append("dependents-index")
    print("  Uploading the dataset card")
    api.upload_file(repo_id=repo_id, repo_type="dataset", path_or_fileobj=render_card(results_dir, repo_id).encode(),
                    path_in_repo="README.md", commit_message=f"{message}: dataset card")
    uploaded.append("README.md")
    return uploaded


def main():
    parser = argparse.ArgumentParser(description="Publish the OSSBridge results to a Hugging Face dataset")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Dataset repository (owner/name)")
    parser.add_argument("--results", default=str(RESULTS_DIR))
    parser.add_argument("--index", default=str(INDEX_DIR))
    parser.add_argument("--no-index", action="store_true", help="Do not upload the dependents index")
    parser.add_argument("--card-only", action="store_true", help="Only update the dataset card")
    parser.add_argument("--dry-run", action="store_true", help="Print the dataset card; upload nothing")
    parser.add_argument("--download", action="store_true",
                        help="Download the published dependents index and results into the data folder")
    parser.add_argument("--app-only", action="store_true",
                        help="With --download, get only the index files the app reads")
    parser.add_argument("--message", help="Commit message prefix")
    args = parser.parse_args()

    if args.dry_run:
        print(render_card(Path(args.results), args.repo))
        return
    if args.download:
        try:
            written = download(args.repo, Path(args.results).parent, app_only=args.app_only)
        except Exception as e:
            sys.exit(f"Download failed: {type(e).__name__}: {e}")
        print(f"Downloaded {written} files from https://huggingface.co/datasets/{args.repo}")
        return
    try:
        uploaded = publish(args.repo, Path(args.results), Path(args.index), not args.no_index, args.card_only,
                           args.message)
    except Exception as e:   # authentication and network errors from huggingface_hub
        sys.exit(f"Upload failed: {type(e).__name__}: {e}")
    print(f"Uploaded {', '.join(uploaded)} to https://huggingface.co/datasets/{args.repo}")


if __name__ == "__main__":
    main()
