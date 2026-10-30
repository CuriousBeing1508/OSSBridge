#!/usr/bin/env python3
"""Match available APIs with test coverage"""

import pandas as pd
import sys
from pathlib import Path

def match_apis_with_coverage(available_apis_path, coverage_path, output_path):
    print(f" Reading available APIs: {available_apis_path}")
    available_apis = pd.read_csv(available_apis_path)
    print(f"  Found {len(available_apis)} APIs")
    
    print(f" Reading coverage: {coverage_path}")
    coverage = pd.read_csv(coverage_path)
    print(f"  Found {len(coverage)} methods")
    
    # Match on FullSignature (unique with descriptors)
    merged = available_apis.merge(
        coverage, 
        on='FullSignature',  # Match on detailed signature
        how='left', 
        suffixes=('', '_cov')
    )
    
    # Clean up duplicate columns
    for col in ['Package', 'Class', 'Method', 'MethodDescriptor', 'SimpleSignature']:
        if f'{col}_cov' in merged.columns:
            merged[col] = merged[col].fillna(merged[f'{col}_cov'])
            merged = merged.drop(columns=[f'{col}_cov'])
    
    # Add status
    merged['IsCovered'] = merged['INSTRUCTION_COVERED'] > 0
    merged['CoverageStatus'] = merged.apply(
        lambda x: 'COVERED' if x['INSTRUCTION_COVERED'] > 0 
                  else 'NOT_COVERED' if pd.notna(x['INSTRUCTION_COVERED']) 
                  else 'NOT_FOUND',
        axis=1
    )
    
    merged.to_csv(output_path, index=False)
    print(f" Saved: {output_path}")
    
    # Summary
    total = len(merged)
    found = merged['INSTRUCTION_COVERED'].notna().sum()
    covered = (merged['INSTRUCTION_COVERED'] > 0).sum()
    
    print(f"\n{'='*50}")
    print(f"Total APIs: {total}")
    print(f"Found in Coverage: {found}")
    print(f"   Covered: {covered}")
    print(f"   Not Covered: {found - covered}")
    print(f"  Not Found: {total - found}")
    if found > 0:
        print(f"\n Coverage: {covered/found*100:.2f}%")
    print(f"{'='*50}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python match_apis_coverage.py <available_apis.csv> <coverage.csv> <output.csv>")
        sys.exit(1)
    
    match_apis_with_coverage(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))