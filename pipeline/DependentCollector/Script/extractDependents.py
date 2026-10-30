import json
import csv
from neo4j import GraphDatabase
from datetime import datetime
import os
# This script allows you to extract dependents for top 50 java libraries extracted from libraries.io, however, 
# if you want to extract dependents for a particulat library, use extractDependentsForALib.py

# File paths
json_file_path = 'popular_libraries.json'  # Replace with your actual JSON file path
csv_output_path = './Data/'  # Folder to save CSV files
log_file_path = "./Data/log_file.txt"
# Neo4j connection details
uri = "bolt://localhost:7687"
user = "neo4j"
password = "Password1"

# Load JSON data
def load_libraries(json_file_path):
    with open(json_file_path, 'r') as file:
        libraries = json.load(file)
    return libraries

# Function to fetch dependents data from Neo4j
def fetch_data(library_name, version):
    query = """
    MATCH (r:Release)-[d:dependency]->(a:Artifact)
    WHERE a.id = $library_name AND d.targetVersion = $version
    RETURN r, d, a
    """
    driver = GraphDatabase.driver(uri, auth=(user, password))
    with driver.session() as session:
        result = session.run(query, library_name=library_name, version=version)
        data = [record.data() for record in result]
    driver.close()
    return data

def save_to_csv(library_name, version, data):
    if data:
        file_name = f"{csv_output_path}/{library_name}-{version}.csv"
        
        with open(file_name, mode='w', newline='', encoding='utf-8') as file:
            writer = csv.DictWriter(file, fieldnames=["release_id", "dependency", "artifact_id"])
            writer.writeheader()
            
            for record in data:
                try:
                    release_id = record["r"]["id"]  # Extract `id` from Release node
                    dependency = str(record["d"])  # Store `d` as a string exactly as received
                    artifact_id = record["a"]["id"]  # Extract `id` from Artifact node
                    
                    writer.writerow({
                        "release_id": release_id,
                        "dependency": dependency,
                        "artifact_id": artifact_id
                    })
                except (KeyError, IndexError, TypeError) as e:
                    print(f"Skipping record due to missing data: {record} - Error: {e}")
        
        print(f" Data for {library_name} version {version} saved to {file_name}")
    else:
        log_failure(library_name, version)

# Log failure case to a log file
def log_failure(library_name, version):
    log_message = f"No data found for {library_name} version {version}\n"
    
    # Ensure the log file exists and write the failure message
    if not os.path.exists(log_file_path):
        # Create a new log file if it doesn't exist
        with open(log_file_path, mode='w', encoding='utf-8') as log_file:
            log_file.write(log_message)
    else:
        # Append to the log file if it already exists
        with open(log_file_path, mode='a', encoding='utf-8') as log_file:
            log_file.write(log_message)
    
    print(f"Log for {library_name} version {version} added to {log_file_path}")

# Sort versions by published_at and fetch the latest 10 versions
def sort_versions_by_date(library):
    versions = library['versions']
    # Sort by published_at (in descending order)
    versions_sorted = sorted(versions, key=lambda x: datetime.strptime(x['published_at'], "%Y-%m-%dT%H:%M:%S.000Z"), reverse=True)
    return versions_sorted[:10]  # Return the top 10 latest versions

# Main function to fetch and process data for libraries
def process_libraries():
    libraries = load_libraries(json_file_path)
    for library in libraries[2:50]:  # Process first 50 libraries
        library_name = library['name']
        versions_sorted = sort_versions_by_date(library)  # Get top 10 versions sorted by published_at

        for version_info in versions_sorted:
            version = version_info['number']
            print(f"Processing {library_name} version {version}...")
            data = fetch_data(library_name, version)
            save_to_csv(library_name, version, data)

    # data = fetch_data('org.scala-lang:scala-library', '2.13.10')
    # save_to_csv('org.scala-lang:scala-library', '2.13.10', data)

# Run the script
process_libraries()
