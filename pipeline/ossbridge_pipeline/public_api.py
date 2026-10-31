#!/usr/bin/env python3
"""
================================================================================
Step 4: Library API
================================================================================

Lists the API of the library jar: the classes, methods, constructors and fields
a dependent can use (public, and protected unless the class is final), with
deprecation and module export information. Runs ExtractApi from the analyzer jar
(JavaUsageExtractor), so API ids match the usage analysis of step 3.

OUTPUT (in the workspace):
    apis.csv            api_id, package, class_name, member, descriptor, kind, visibility,
                        static, abstract, class_kind, deprecated, deprecated_for_removal,
                        class_deprecated, exported
    api-overrides.csv   api_id, override_id: library methods that override or implement
                        each API method (used by step 6 to follow virtual dispatch)

USAGE:
    python -m ossbridge_pipeline.public_api --library commons-codec:commons-codec --version 1.17.1
================================================================================
"""

import argparse
import csv
import subprocess
import sys
from collections import Counter

from .download_jars import download_library_jar
from .usage_analysis import analyzer_jar
from .workspace import Workspace

API_COLUMNS = ["api_id", "package", "class_name", "member", "descriptor", "kind", "visibility", "static", "abstract",
               "class_kind", "deprecated", "deprecated_for_removal", "class_deprecated", "exported"]


def extract_api(library_jar, apis_csv, overrides_csv=None, java="java"):
    """Run ExtractApi; returns counts per kind and visibility, and of deprecated APIs."""
    cmd = [java, "-cp", str(analyzer_jar()), "com.realise.asm_based_analysis.ExtractApi",
           "--library-jar", str(library_jar), "--out", str(apis_csv)]
    if overrides_csv:
        cmd += ["--overrides-out", str(overrides_csv)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"API extraction failed (exit {proc.returncode}): {proc.stderr.strip()}")

    with open(apis_csv, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    counts = Counter(f"{r['visibility']}_{r['kind']}" for r in rows)
    return {"apis": len(rows), **dict(sorted(counts.items())),
            "deprecated": sum(r["deprecated"] == "true" for r in rows),
            "not_exported": sum(r["exported"] == "false" for r in rows)}


def run(workspace):
    """Step 4 for a workspace: downloads the library jar if missing and writes apis.csv."""
    library_jar = workspace.library_jar if workspace.library_jar.exists() else download_library_jar(workspace)
    return extract_api(library_jar, workspace.apis_csv, workspace.api_overrides_csv)


def main():
    parser = argparse.ArgumentParser(description="List the API of a library jar")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        summary = run(Workspace(args.library, args.version))
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(str(e))
    print("  " + ", ".join(f"{k}: {v}" for k, v in summary.items()))


if __name__ == "__main__":
    main()
