#!/usr/bin/env python3
"""Parse JaCoCo XML report to method-level CSV"""

import xmltodict
import pandas as pd
import sys
from pathlib import Path

def parse_jacoco_xml(xml_path):
    print(f"📖 Parsing: {xml_path}")
    
    with open(xml_path, 'r') as f:
        data = xmltodict.parse(f.read())
    
    methods = []
    packages = data.get('report', {}).get('package', [])
    if not isinstance(packages, list):
        packages = [packages]
    
    for package in packages:
        package_name = package.get('@name', '').replace('/', '.')
        classes = package.get('class', [])
        if not isinstance(classes, list):
            classes = [classes]
        
        for cls in classes:
            class_full_name = cls.get('@name', '').replace('/', '.')
            class_name = class_full_name.split('.')[-1]
            class_methods = cls.get('method', [])
            if not isinstance(class_methods, list):
                class_methods = [class_methods]
            
            for method in class_methods:
                method_name = method.get('@name', '')
                method_desc = method.get('@desc', '')
                
                # Full signature WITH descriptor (unique)
                full_signature = f"{class_full_name}.{method_name}{method_desc}"
                
                # Simple signature WITHOUT descriptor (for matching)
                simple_signature = f"{class_full_name}.{method_name}"
                
                counters = method.get('counter', [])
                if not isinstance(counters, list):
                    counters = [counters]
                
                coverage_data = {
                    'Package': package_name,
                    'Class': class_name,
                    'Method': method_name,
                    'MethodDescriptor': method_desc,
                    'FullSignature': full_signature,
                    'SimpleSignature': simple_signature,
                    'INSTRUCTION_MISSED': 0,
                    'INSTRUCTION_COVERED': 0,
                    'BRANCH_MISSED': 0,
                    'BRANCH_COVERED': 0,
                    'LINE_MISSED': 0,
                    'LINE_COVERED': 0,
                    'COMPLEXITY_MISSED': 0,
                    'COMPLEXITY_COVERED': 0
                }
                
                for counter in counters:
                    ctype = counter.get('@type', '')
                    missed = int(counter.get('@missed', 0))
                    covered = int(counter.get('@covered', 0))
                    
                    if ctype == 'INSTRUCTION':
                        coverage_data['INSTRUCTION_MISSED'] = missed
                        coverage_data['INSTRUCTION_COVERED'] = covered
                    elif ctype == 'BRANCH':
                        coverage_data['BRANCH_MISSED'] = missed
                        coverage_data['BRANCH_COVERED'] = covered
                    elif ctype == 'LINE':
                        coverage_data['LINE_MISSED'] = missed
                        coverage_data['LINE_COVERED'] = covered
                    elif ctype == 'COMPLEXITY':
                        coverage_data['COMPLEXITY_MISSED'] = missed
                        coverage_data['COMPLEXITY_COVERED'] = covered
                
                methods.append(coverage_data)
    
    df = pd.DataFrame(methods)
    print(f"Found {len(df)} methods")
    return df

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python parse_jacoco_xml.py <jacoco.xml> <output.csv>")
        sys.exit(1)
    
    df = parse_jacoco_xml(Path(sys.argv[1]))
    df.to_csv(Path(sys.argv[2]), index=False)
    print(f"Saved to: {sys.argv[2]}")