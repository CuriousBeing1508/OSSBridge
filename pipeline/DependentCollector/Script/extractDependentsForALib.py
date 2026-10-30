"""
================================================================================
Library Dependents Extractor
================================================================================

DESCRIPTION:
    This script extracts ALL dependents for a specific library version from a 
    Neo4j graph database and saves the results to a CSV file.

WHAT IT DOES:
    1. Connects to a Neo4j database containing library dependency data
    2. Queries for all projects (Releases) that depend on a specific library 
       and version
    3. Extracts the dependency relationships and saves them to a CSV file
    4. Logs execution time and results for tracking purposes

OUTPUT:
    - CSV file: ../AutomatedJarDownload/DataFromNeo4j/{library_name}-{version}.csv
    - Log file: ../AutomatedJarDownload/ErrorLog/{library_name}-extraction.log

CSV COLUMNS:
    - release_id: The project/release that has the dependency
    - dependency: The dependency relationship details
    - artifact_id: The library being depended upon

LOG FILE FORMAT:
    Each log entry includes:
    - Timestamp (ISO format)
    - Library name and version
    - Number of dependents found
    - Execution time
    - Status (SUCCESS/FAILURE)

REQUIREMENTS:
    - Python 3.x
    - neo4j Python driver (install: pip install neo4j)
    - Running Neo4j database with dependency data
    - Network access to Neo4j instance

CONFIGURATION:
    Update the following variables if needed:
    - uri: Neo4j connection URI (default: bolt://localhost:7687)
    - user: Neo4j username (default: neo4j)
    - password: Neo4j password (default: Password1)
    - csv_output_path: Output directory for CSV files
    - log_dir_path: Directory for log files

USAGE:
    python script.py <library_name> <version>

EXAMPLES:
    # Extract dependents for Kotlin stdlib version 2.3.0
    python script.py "org.jetbrains.kotlin:kotlin-stdlib" "2.3.0"
    
    # Extract dependents for Scala library
    python script.py "org.scala-lang:scala-library" "2.13.10"
    
    # Extract dependents for JUnit
    python script.py "junit:junit" "4.13.2"
    
    # Get help
    python script.py --help

NOTES:
    - Library names typically follow the format: groupId:artifactId
    - The script extracts ALL dependents (no limit)
    - For popular libraries with many dependents, the query may take some time
    - Progress is displayed every 1,000 records
    - Output directory is created automatically if it doesn't exist
    - Each library has its own log file for easier tracking

================================================================================
"""

import csv
from neo4j import GraphDatabase
import os
import argparse
from datetime import datetime
import time

# Configuration
script_dir = os.path.dirname(os.path.abspath(__file__))
csv_output_path = os.path.join(script_dir, '../AutomatedDepDownload/DataFromNeo4j')
log_dir_path = os.path.join(script_dir, '../AutomatedDepDownload/ErrorLog')


# Neo4j connection details
uri = "bolt://localhost:7687"
user = "neo4j"
password = "Password1"

def fetch_data(library_name, version):
    """Fetch dependents data from Neo4j for a specific library version"""
    query = """
    MATCH (r:Release)-[d:dependency]->(a:Artifact)
    WHERE a.id = $library_name AND d.targetVersion = $version
    RETURN r, d, a
    """
    
    start_time = time.time()
    driver = GraphDatabase.driver(uri, auth=(user, password))
    
    with driver.session() as session:
        result = session.run(query, library_name=library_name, version=version)
        
        # Fetch all data with progress indicator
        data = []
        print("  Fetching data from Neo4j...", end='', flush=True)
        for record in result:
            data.append(record.data())
            if len(data) % 1000 == 0:
                print(f"\r  Fetched {len(data)} dependents...", end='', flush=True)
        
        elapsed_time = time.time() - start_time
        
        if data:
            print(f"\r  ✓ Fetched {len(data)} dependents from Neo4j in {elapsed_time:.2f} seconds")
        else:
            print(f"\r  No dependents found in database (took {elapsed_time:.2f} seconds)")
    
    driver.close()
    return data, elapsed_time

def save_to_csv(library_name, version, data):
    """Save fetched data to CSV file"""
    # Create output directory if it doesn't exist
    os.makedirs(csv_output_path, exist_ok=True)
    
    if data:
        # Sanitize filename
        safe_lib_name = library_name.replace(':', '_').replace('/', '_')
        file_name = f"{csv_output_path}/{safe_lib_name}-{version}.csv"
        
        with open(file_name, mode='w', newline='', encoding='utf-8') as file:
            writer = csv.DictWriter(file, fieldnames=["release_id", "dependency", "artifact_id"])
            writer.writeheader()
            
            for record in data:
                try:
                    release_id = record["r"]["id"]
                    dependency = str(record["d"])
                    artifact_id = record["a"]["id"]
                    
                    writer.writerow({
                        "release_id": release_id,
                        "dependency": dependency,
                        "artifact_id": artifact_id
                    })
                except (KeyError, IndexError, TypeError) as e:
                    print(f"Skipping record due to missing data: {record} - Error: {e}")
        
        print(f"✓ Data for {library_name} version {version} saved to {file_name}")
        print(f"✓ Total dependents found: {len(data)}")
        return file_name
    else:
        return None

def log_extraction(library_name, version, num_dependents, elapsed_time, status):
    """Log extraction details with timestamp, library-specific log file"""
    # Create log directory if it doesn't exist
    os.makedirs(log_dir_path, exist_ok=True)
    
    # Create library-specific log file
    safe_lib_name = library_name.replace(':', '_').replace('/', '_')
    log_file_path = f"{log_dir_path}/{safe_lib_name}-extraction.log"
    
    # Format timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Create log entry
    log_entry = (
        f"[{timestamp}] "
        f"Library: {library_name} | "
        f"Version: {version} | "
        f"Dependents: {num_dependents} | "
        f"Time: {elapsed_time:.2f}s | "
        f"Status: {status}\n"
    )
    
    # Write to log file
    with open(log_file_path, mode='a', encoding='utf-8') as log_file:
        log_file.write(log_entry)
    
    if status == "SUCCESS":
        print(f"✓ Extraction logged to {log_file_path}")
    else:
        print(f"✗ No dependents found for {library_name} version {version}")
        print(f"  Failure logged to {log_file_path}")

def main():
    parser = argparse.ArgumentParser(description='Extract dependents for a specific library version from Neo4j')
    parser.add_argument('library', help='Library name (e.g., org.jetbrains.kotlin:kotlin-stdlib)')
    parser.add_argument('version', help='Version number (e.g., 2.3.0)')
    
    args = parser.parse_args()
    
    print(f"\n🔍 Searching for dependents of {args.library} version {args.version}...")
    print("-" * 70)
    
    # Fetch data and record time
    data, elapsed_time = fetch_data(args.library, args.version)
    
    # Save to CSV if data exists
    csv_file = save_to_csv(args.library, args.version, data)
    
    # Log the extraction
    if data:
        log_extraction(args.library, args.version, len(data), elapsed_time, "SUCCESS")
    else:
        log_extraction(args.library, args.version, 0, elapsed_time, "FAILURE")
    
    print("-" * 70)

if __name__ == "__main__":
    main()