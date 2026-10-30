#!/usr/bin/env python3

# Parse coverage XML
# python3 scripts/parse_jacoco_xmlV2.py Dataset/TestCoverage/jackson-databind-2.17.2_coverage.xml Dataset/TestCoverage/jackson-databind-2.17.2_method_coverage.csv

# Match with APIs
# python scripts/match_apis_coverageV2.py \
#   Dataset/LibraryJars/jackson-databind-2.17.2_available_apis.csv \
#   Dataset/TestCoverage/jackson-databind-2.17.2_method_coverage.csv \
#   Dataset/TestCoverage/jackson-databind-2.17.2_final.csv
# TODO: Now no need to execute V2 script, need to remove, I am keeping for sanity check.

"""Orchestrate the data pipeline"""
import yaml
import subprocess
from pathlib import Path
from datetime import datetime

def load_config():
    config_path = Path(__file__).parent.parent / "config" / "libraries.yaml"
    with open(config_path) as f:
        return yaml.safe_load(f)

def run_pipeline(lib_config):
    lib = lib_config['name']
    ver = lib_config['version']
    
    print(f"\n{'='*60}")
    print(f"Processing: {lib} v{ver}")
    print(f"{'='*60}\n")
    
    base = Path(__file__).parent.parent / "Dataset"
    scripts = Path(__file__).parent
    
    # Paths
    coverage_xml = base / f"TestCoverage/{lib}-{ver}_coverage.xml"
    # this is one extracted from parse_jacoco_xml.py
    coverage_csv = base / f"TestCoverage/{lib}-{ver}_method_coverage.csv"
    available_apis = base / f"LibraryJars/{lib}-{ver}_available_apis.csv"
    # this is the output of matching..
    final_output = base / f"TestCoverage/{lib}-{ver}_all_apis_coverage.csv"
    
    # Step 1: Check coverage XML exists
    if not coverage_xml.exists():
        print(f" Coverage XML not found: {coverage_xml}")
        print("   Run: ./ExtractCoverageFromSourceZip.sh first")
        return False
    
    # Step 2: Parse XML to CSV if needed
    if not coverage_csv.exists():
        print("  Parsing XML to CSV...")
        result = subprocess.run([
            "python3", scripts / "parse_jacoco_xmlV2.py",
            str(coverage_xml), str(coverage_csv)
        ])
        if result.returncode != 0:
            return False
    else:
        print(f" Coverage CSV exists")
    
    # Step 3: Check available APIs exists
    if not available_apis.exists():
        print(f" Available APIs not found: {available_apis}")
        print("   Run: ./ExtractDetailsFromJar.sh first")
        return False
    
    # Step 4: Match all available APIs with coverage
    print("  Matching all APIs with coverage...")
    result = subprocess.run([
        "python3", scripts / "match_apis_coverageV2.py",
        str(available_apis),
        str(coverage_csv),
        str(final_output)
    ])
    
    if result.returncode == 0:
        print(f"\n Complete: {lib}-{ver}")
        print(f"   Output: {final_output}")
        return True
    return False

def main():
    config = load_config()
    libraries = config.get('libraries', [])
    
    print(f" Data Pipeline - API Coverage Extraction")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Libraries: {len(libraries)}\n")
    
    results = []
    for lib_config in libraries:
        success = run_pipeline(lib_config)
        results.append((lib_config['name'], lib_config['version'], success))
    
    # Summary
    print(f"\n{'='*60}")
    print("Summary:")
    print(f"{'='*60}")
    successful = sum(1 for _, _, s in results if s)
    print(f" Successful: {successful}/{len(results)}")
    print(f" Failed: {len(results) - successful}/{len(results)}")

if __name__ == "__main__":
    main()