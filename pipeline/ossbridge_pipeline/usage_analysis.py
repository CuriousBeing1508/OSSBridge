#!/usr/bin/env python3
"""
================================================================================
Step 3: Usage Analysis
================================================================================

Runs the bytecode analyzer (JavaUsageExtractor, ossbridge-usage-analyzer.jar)
on the downloaded dependent jars.

OUTPUT (in the workspace):
    usage.csv           one row per (dependent jar, category, target, declaring class)
                        with occurrences and number of calling classes
    usage-summary.csv   one row per dependent jar: status, classes, bundled library
                        classes, bytecode instructions, usage rows

The analyzer jar is taken from OSSBRIDGE_USAGE_ANALYZER or, by default, the
Maven build output (run `./mvnw package` in JavaUsageExtractor/asm-based-analysis).

USAGE:
    python -m ossbridge_pipeline.usage_analysis --library commons-codec:commons-codec --version 1.17.1
================================================================================
"""

import argparse
import csv
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

from .download_jars import download_library_jar
from .workspace import Workspace

# Output columns of the analyzer (AnalyzeUsage.java)
USAGE_COLUMNS = ["dependent_jar", "category", "target_class", "target_member", "target_descriptor",
                 "declaring_class", "resolution", "occurrences", "caller_classes"]
SUMMARY_COLUMNS = ["dependent_jar", "status", "classes", "bundled_library_classes",
                   "bytecode_instructions", "usage_rows", "detail"]

# OSSBRIDGE_USAGE_ANALYZER (set in the pipeline image), else the Maven build output
DEFAULT_ANALYZER = Path(os.environ.get("OSSBRIDGE_USAGE_ANALYZER") or
                        Path(__file__).resolve().parents[1] / "JavaUsageExtractor" / "asm-based-analysis"
                        / "target" / "ossbridge-usage-analyzer.jar")


def analyzer_jar():
    path = Path(os.environ.get("OSSBRIDGE_USAGE_ANALYZER") or DEFAULT_ANALYZER)
    if not path.exists():
        raise FileNotFoundError(f"Usage analyzer not found at {path}; build it with ./mvnw package "
                                f"in JavaUsageExtractor/asm-based-analysis")
    return path


def analyze_usage(library_jar, dependents_dir, usage_csv, summary_csv, progress=None, java="java", jars=None):
    """Run the analyzer; returns counts per dependent jar status and the number of usage rows.

    Analyzes every jar in dependents_dir, or only the given jars (paths) if
    jars is set. progress(done, total, jar_name) is called after each jar.
    """
    cmd = [java, "-jar", str(analyzer_jar()), "--library-jar", str(library_jar),
           "--usage-out", str(usage_csv), "--summary-out", str(summary_csv)]
    if jars is None:
        cmd += ["--dependents-dir", str(dependents_dir)]
    else:
        jar_list = Path(str(summary_csv) + ".jars.txt")
        jar_list.parent.mkdir(parents=True, exist_ok=True)
        jar_list.write_text("".join(f"{Path(j).resolve()}\n" for j in jars), encoding="utf-8")
        cmd += ["--jar-list", str(jar_list)]
    output = []
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as proc:
        for line in proc.stdout:
            if line.startswith("PROGRESS "):
                if progress:
                    _, counts, jar_name, _status = line.split(" ", 3)
                    done, total = counts.split("/")
                    progress(int(done), int(total), jar_name)
            else:
                output.append(line.rstrip())
    if proc.returncode != 0:
        raise RuntimeError(f"Usage analyzer failed (exit {proc.returncode}): " + "\n".join(output[-20:]))

    with open(summary_csv, newline="", encoding="utf-8") as f:
        statuses = Counter(row["status"] for row in csv.DictReader(f))
    with open(usage_csv, newline="", encoding="utf-8") as f:
        usage_rows = sum(1 for _ in csv.DictReader(f))
    return {"jars": sum(statuses.values()), "analyzed": statuses.get("analyzed", 0),
            "errors": statuses.get("error", 0), "usage_rows": usage_rows}


def jars_using_library(usage_csv):
    """Dependent jars with at least one use of the library.

    Rows resolved to a class outside the library (resolution 'external', e.g.
    Enum.ordinal() called on a library enum) do not count on their own.
    """
    with open(usage_csv, newline="", encoding="utf-8") as f:
        return {row["dependent_jar"] for row in csv.DictReader(f) if row["resolution"] != "external"}


def run(workspace, progress=None):
    """Step 3 for a workspace: needs dependent-jars/ (step 2); downloads the library jar if missing."""
    library_jar = workspace.library_jar if workspace.library_jar.exists() else download_library_jar(workspace)
    return analyze_usage(library_jar, workspace.dependent_jars_dir, workspace.usage_csv,
                         workspace.usage_summary_csv, progress=progress)


def main():
    parser = argparse.ArgumentParser(description="Analyze library usage in downloaded dependent jars")
    parser.add_argument("--library", required=True, help="groupId:artifactId")
    parser.add_argument("--version", required=True)
    args = parser.parse_args()

    def progress(done, total, jar_name):
        print(f"\r  {done}/{total}  {jar_name[:70]:<70}", end="", flush=True)

    try:
        summary = run(Workspace(args.library, args.version), progress=progress)
    except (FileNotFoundError, RuntimeError) as e:
        sys.exit(str(e))
    print()
    print("  " + ", ".join(f"{k}: {v}" for k, v in summary.items()))


if __name__ == "__main__":
    main()
