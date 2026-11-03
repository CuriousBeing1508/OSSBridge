# Complete Setup Guide - Maven Dependency Extractor

This guide explains how to set up the environment for extracting Maven library dependents using the Goblin Weaver dataset.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [Understanding the Components](#understanding-the-components)
5. [Running the Extraction](#running-the-extraction)
6. [Troubleshooting](#troubleshooting)
7. [Advanced Usage](#advanced-usage)

---

## Overview

### What This Tool Does

This tool extracts all Maven projects (dependents) that use a specific library version. For example, if you want to find all projects that depend on `kotlin-stdlib version 2.3.0`, this tool queries the complete Maven Central dependency graph and exports the results to CSV.

### The Technology Stack
```
Your Python Script
   Neo4j Database (graph database)
   Goblin Weaver Dataset (Maven Central snapshot)
   Neo4jWeaverDocker (containerization)
```

**Components:**
- **Goblin Weaver Dataset** - Complete Maven Central dependency graph (~3-5GB)
- **Neo4jWeaverDocker** - Docker setup that deploys Neo4j with the dataset
- **Neo4j** - Graph database for querying dependency relationships
- **Python Script** - Connects directly to Neo4j and exports to CSV

**Important Note:** The Neo4jWeaverDocker repository provides both Neo4j and a Weaver REST API. **We only use Neo4j** - the script connects directly to the database, bypassing the API layer.

---

## Prerequisites

### Required Software

1. **Docker Desktop**
   - **Purpose:** Runs Neo4j database container
   - **Download:** https://www.docker.com/products/docker-desktop
   - **Version:** 20.10 or higher
   - **Installation time:** ~5 minutes

2. **Python 3.8+**
   - **Purpose:** Runs extraction script
   - **Check version:** `python --version` or `python3 --version`
   - **Download:** https://www.python.org/downloads/

3. **Git** (optional, for cloning)
   - **Purpose:** Clone the dataset repository
   - **Alternative:** Download repository as ZIP
   - **Download:** https://git-scm.com/downloads

### System Requirements

- **Disk Space:** 20GB free (3-5GB download + ~15GB database)
- **RAM:** 8GB minimum, 16GB recommended
- **Network:** Internet connection for initial dataset download
- **Operating System:** Windows 10+, macOS 10.14+, or Linux

---

## Step-by-Step Setup

### Step 1: Install Docker Desktop

**Why:** Docker provides a consistent environment for Neo4j across all operating systems.

**Instructions:**
```bash
# 1. Download Docker Desktop from:
# https://www.docker.com/products/docker-desktop

# 2. Install following the installer instructions

# 3. Start Docker Desktop application

# 4. Verify installation
docker --version
docker-compose --version
```

**Expected output:**
```
Docker version 24.0.7, build afdd53b
Docker Compose version v2.23.0
```

**Success indicator:** Docker Desktop shows "running" status

---

### Step 2: Download the Neo4jWeaverDocker Repository

**Why:** This repository contains Docker configurations that automatically download and set up the Goblin Weaver dataset.

**Method A - Using Git:**
```bash
git clone https://github.com/Goblin-Ecosystem/Neo4jWeaverDocker.git
cd Neo4jWeaverDocker
```

**Method B - Manual Download:**
1. Visit: https://github.com/Goblin-Ecosystem/Neo4jWeaverDocker
2. Click "Code", then "Download ZIP"
3. Extract the ZIP file
4. Open terminal in extracted folder

**What's inside:**
- `docker-compose.yml` - Defines Neo4j container setup
- `Dockerfile.neo4j` - Specifies Goblin dataset download from Zenodo
- Automatic initialization scripts

---

### Step 3: Start Neo4j Database

**Why:** This downloads the Goblin Weaver dataset (Maven Central dependency graph) and loads it into Neo4j.

**Command:**
```bash
# Make sure you're in the Neo4jWeaverDocker directory
cd Neo4jWeaverDocker

# Start only Neo4j (not the Weaver API)
docker-compose up -d neo4j
```

**What happens:**

**First-time run (10-30 minutes):**
1. Downloads Neo4j Docker image (~500MB)
2. Downloads Goblin Weaver dataset from Zenodo (~3-5GB)
3. Imports Maven Central dependency data into Neo4j database
4. Starts Neo4j server

**Subsequent runs (~10 seconds):**
- Just starts Neo4j (data already loaded)

**Monitor progress:**
```bash
# Watch the logs
docker-compose logs -f neo4j

# Look for these messages:
# "Downloading dataset from Zenodo..."
# "Importing data..."
# "Started."  (Neo4j is ready)
```

**Ports opened:**
- `7474` - Neo4j Browser (web interface)
- `7687` - Bolt protocol (for queries)

**Note:** The docker-compose.yml also includes a Weaver API service, but we don't use it. Our script connects directly to Neo4j.

---

### Step 4: Verify Neo4j is Running

**Why:** Ensure database is ready before running extraction queries.

**Method 1 - Web Browser (Recommended):**
```bash
# Open Neo4j Browser
open http://localhost:7474
# Or manually visit: http://localhost:7474
```

**Login credentials:**
- **Username:** `neo4j`
- **Password:** `Password1`

**Test query in browser:**
```cypher
// Count total artifacts
MATCH (a:Artifact)
RETURN count(a) as totalArtifacts
```

**Expected result:** Several hundred thousand artifacts (e.g., 450,000+)

**Method 2 - Command Line:**
```bash
# Test connection with Python
python -c "from neo4j import GraphDatabase; \
driver = GraphDatabase.driver('bolt://localhost:7687', \
auth=('neo4j', 'Password1')); \
driver.verify_connectivity(); \
print('Connected successfully'); \
driver.close()"
```

**Success indicator:** No errors, connection confirmed

---

### Step 5: Install Python Dependencies

**Why:** The extraction script needs the Neo4j Python driver to communicate with the database.

**Install:**
```bash
# Install neo4j driver
pip install neo4j

# Or if using pip3
pip3 install neo4j
```

**Verify installation:**
```bash
python -c "import neo4j; print('neo4j driver version:', neo4j.__version__)"
```

**Expected output:**
```
neo4j driver version: 5.x.x
```

---

### Step 6: Place the Extraction Script

**Setup your project structure:**
```
your-project/
├── extractDependentsForALib.py    # Your extraction script
├── AutomatedJarDownload/
│   ├── DataFromNeo4j/             # CSV outputs (created automatically)
│   └── ErrorLog/                   # Log files (created automatically)
└── Neo4jWeaverDocker/             # Dataset repository (from Step 2)
```

**Note:** The script creates output directories automatically if they don't exist.

---

## Understanding the Components

### What is the Goblin Weaver Dataset?

The **Goblin Weaver dataset** is a complete snapshot of Maven Central's dependency graph:
- Contains all Maven artifacts (libraries)
- All releases (versions) of each artifact
- All dependency relationships between releases
- Hosted on Zenodo: https://zenodo.org/records/11104819
- Also used as the official dataset for MSR 2025 Mining Challenge

### The Data Model

Neo4j stores the Goblin Weaver dataset as a graph with three components:

**1. Artifact Nodes** (Libraries)
```cypher
(:Artifact {
  id: "org.jetbrains.kotlin:kotlin-stdlib",
  groupId: "org.jetbrains.kotlin",
  artifactId: "kotlin-stdlib"
})
```

**2. Release Nodes** (Versions)
```cypher
(:Release {
  id: "org.jetbrains.kotlin:kotlin-stdlib:2.3.0",
  groupId: "org.jetbrains.kotlin",
  artifactId: "kotlin-stdlib",
  version: "2.3.0",
  releaseDate: "2024-05-20"
})
```

**3. Dependency Relationships**
```cypher
(:Release)-[:dependency {
  targetVersion: "2.3.0",
  scope: "compile"
}]->(:Artifact)
```

### Visual Example
```
SpringBoot 3.2.0 ──dependency──> kotlin-stdlib
    (Release)    targetVersion:    (Artifact)
                     "2.3.0"
```

### The Cypher Query

The extraction script uses this query:
```cypher
MATCH (r:Release)-[d:dependency]->(a:Artifact)
WHERE a.id = $library_name 
  AND d.targetVersion = $version
RETURN r, d, a
```

**Breaking it down:**

| Part | Purpose | Example |
|------|---------|---------|
| `MATCH (r:Release)` | Find Release nodes | SpringBoot 3.2.0 |
| `-[d:dependency]->` | With dependency relationship | "depends on" |
| `(a:Artifact)` | Pointing to Artifact | kotlin-stdlib |
| `WHERE a.id = ...` | Filter to specific library | "org.jetbrains.kotlin:kotlin-stdlib" |
| `AND d.targetVersion = ...` | Filter to specific version | "2.3.0" |
| `RETURN r, d, a` | Return all matching | All dependents |

**What you get:** Every project (Release) that depends on the specified library version.

---

## Running the Extraction

### Basic Usage
```bash
# General format
python extractDependentsForALib.py "<groupId>:<artifactId>" "<version>"

# Example: Extract Kotlin stdlib 2.3.0 dependents
python extractDependentsForALib.py "org.jetbrains.kotlin:kotlin-stdlib" "2.3.0"

# Example: Extract JUnit 4.13.2 dependents
python extractDependentsForALib.py "junit:junit" "4.13.2"

# Example: Extract Guava dependents
python extractDependentsForALib.py "com.google.guava:guava" "31.1-jre"
```

### What Happens During Extraction
```
1. Script connects to Neo4j (bolt://localhost:7687)
2. Verifies connection is working
3. Checks database contains data
4. Executes Cypher query for your library+version
5. Fetches all matching dependents (shows progress every 1,000)
6. Saves results to CSV file
7. Logs extraction details
```

### Output Files

**CSV File:** `AutomatedJarDownload/DataFromNeo4j/{library}-{version}.csv`

Example: `org.jetbrains.kotlin_kotlin-stdlib-2.3.0.csv`
```csv
release_id,dependency,artifact_id
com.example:myapp:1.0.0,{targetVersion: "2.3.0" ...},org.jetbrains.kotlin:kotlin-stdlib
org.test:tool:2.1.0,{targetVersion: "2.3.0" ...},org.jetbrains.kotlin:kotlin-stdlib
```

**Log File:** `AutomatedJarDownload/ErrorLog/{library}-extraction.log`

Example: `org.jetbrains.kotlin_kotlin-stdlib-extraction.log`
```
[2025-01-16 14:30:22] Library: org.jetbrains.kotlin:kotlin-stdlib | Version: 2.3.0 | Dependents: 1547 | Time: 4.23s | Status: SUCCESS
```

### Execution Time

- **Small libraries** (< 100 dependents): 1-5 seconds
- **Medium libraries** (100-1,000 dependents): 5-15 seconds
- **Popular libraries** (1,000-10,000 dependents): 15-60 seconds
- **Very popular** (10,000+ dependents): 1-5 minutes

---

## Troubleshooting

### Error: "Connection refused" or "ServiceUnavailable"

**Problem:** Cannot connect to Neo4j database

**Diagnosis:**
```bash
# Check if Docker is running
docker ps

# Check if Neo4j container exists and is running
docker ps | grep neo4j
```

**Solutions:**

**1. Docker Desktop not running**
```bash
# Start Docker Desktop application
# Wait for it to show "running" status
```

**2. Neo4j container not started**
```bash
cd Neo4jWeaverDocker
docker-compose up -d neo4j

# Wait 30-60 seconds
docker-compose logs -f neo4j
# Look for "Started." message
```

**3. Neo4j still starting**
```bash
# Check startup progress
docker-compose logs neo4j | grep -i "started"

# If no "Started." message yet, wait longer
```

**4. Wrong directory**
```bash
# Make sure you're in Neo4jWeaverDocker directory
cd Neo4jWeaverDocker
pwd  # Should show path ending in Neo4jWeaverDocker
```

---

### Error: "No dependents found"

**Problem:** Query returns zero results

**Possible Causes:**

**1. Library name format incorrect**

Wrong formats:
- `kotlin-stdlib` (missing groupId)
- `org.jetbrains.kotlin.kotlin-stdlib` (dot instead of colon)
- `org.jetbrains.kotlin/kotlin-stdlib` (slash instead of colon)

Correct format:
- `org.jetbrains.kotlin:kotlin-stdlib`

**2. Version doesn't exist in dataset**

Check available versions in Neo4j Browser:
```cypher
MATCH (a:Artifact {id: "org.jetbrains.kotlin:kotlin-stdlib"})-[:CONTAINS]->(r:Release)
RETURN r.version
ORDER BY r.releaseDate DESC
LIMIT 20
```

**3. No projects actually use that version**

Some versions may exist but have no dependents (rare, but possible).

---

### Error: "Database appears to be empty"

**Problem:** Neo4j has no data loaded

**Diagnosis:**
```bash
# Check if dataset was downloaded
docker-compose logs neo4j | grep -i "download"
docker-compose logs neo4j | grep -i "import"
```

**Solutions:**

**First-time setup not complete:**
```bash
# Watch the full initialization
docker-compose logs -f neo4j

# Look for:
# - "Downloading from Zenodo..." (dataset download)
# - "Import complete" (data loaded)
# - "Started." (Neo4j ready)
```

**Dataset download failed:**
```bash
# Restart the process
docker-compose down -v
docker-compose up -d neo4j

# Monitor logs for errors
docker-compose logs -f neo4j
```

---

### Error: "Port already in use"

**Problem:** Another service is using port 7687 or 7474

**Solution:**

Edit `docker-compose.yml` to use different ports:
```yaml
services:
  neo4j:
    ports:
      - "17474:7474"  # Changed from 7474:7474
      - "17687:7687"  # Changed from 7687:7687
```

Then update your script connection:
```python
uri = "bolt://localhost:17687"  # Changed from 7687
```

And access browser at: `http://localhost:17474`

---

### Error: "Out of memory"

**Problem:** Neo4j or Docker runs out of memory

**Solution:**

**Increase Docker memory** (Docker Desktop, Settings, Resources):
- Set memory to 8GB or more

**Increase Neo4j heap size** in `docker-compose.yml`:
```yaml
environment:
  - NEO4J_dbms_memory_heap_max__size=8G  # Increased from 4G
  - NEO4J_dbms_memory_pagecache_size=4G  # Increased from 2G
```

Then restart:
```bash
docker-compose down
docker-compose up -d neo4j
```

---

## Advanced Usage

### Custom Cypher Queries

You can write custom queries in Neo4j Browser (http://localhost:7474):

**Find all versions of a library:**
```cypher
MATCH (a:Artifact {id: "junit:junit"})-[:CONTAINS]->(r:Release)
RETURN r.version, r.releaseDate
ORDER BY r.releaseDate DESC
```

**Find most popular libraries (most dependents):**
```cypher
MATCH (r:Release)-[:dependency]->(a:Artifact)
WITH a.id as library, count(DISTINCT r) as dependents
RETURN library, dependents
ORDER BY dependents DESC
LIMIT 10
```

**Find transitive dependencies (indirect):**
```cypher
// Find what SpringBoot depends on (up to 3 levels deep)
MATCH path = (r:Release {id: "org.springframework.boot:spring-boot-starter-web:3.2.0"})
             -[:dependency*1..3]->(a:Artifact)
RETURN DISTINCT a.id as dependency, length(path) as depth
ORDER BY depth
```

### Batch Extraction

Extract multiple libraries in one script:
```python
libraries = [
    ("org.jetbrains.kotlin:kotlin-stdlib", "2.3.0"),
    ("junit:junit", "4.13.2"),
    ("com.google.guava:guava", "31.1-jre")
]

for library, version in libraries:
    extract_dependents(library, version)
```

### Filtering Results

Modify the Cypher query to filter dependents:
```cypher
// Only compile-scope dependencies
MATCH (r:Release)-[d:dependency]->(a:Artifact)
WHERE a.id = $library_name 
  AND d.targetVersion = $version
  AND d.scope = "compile"  // Added filter
RETURN r, d, a
```

---

## Managing the Environment

### Starting and Stopping

**Start Neo4j:**
```bash
cd Neo4jWeaverDocker
docker-compose up -d neo4j
```

**Stop Neo4j (data persists):**
```bash
docker-compose down
```

**Restart Neo4j:**
```bash
docker-compose restart neo4j
```

**View logs:**
```bash
docker-compose logs -f neo4j
```

### Data Persistence

**Where data is stored:**
- Docker volume: `neo4jweaverdocker_neo4j_data`

**Check data size:**
```bash
docker system df -v | grep neo4j
```

**Backup data:**
```bash
# Export the volume
docker run --rm -v neo4jweaverdocker_neo4j_data:/data \
  -v $(pwd):/backup ubuntu tar czf /backup/neo4j-backup.tar.gz /data
```

**Complete cleanup (removes all data):**
```bash
docker-compose down -v  # This deletes the database!
```

---

## Performance Tips

### Speed Up Queries

**Create indexes (one-time):**
```cypher
// In Neo4j Browser
CREATE INDEX artifact_id IF NOT EXISTS FOR (a:Artifact) ON (a.id);
CREATE INDEX release_id IF NOT EXISTS FOR (r:Release) ON (r.id);
```

### Optimize Docker

**Allocate more resources** (Docker Desktop, Settings, Resources):
- **CPUs:** 4+ cores
- **Memory:** 8GB+
- **Disk:** SSD preferred

---

## Next Steps

Once setup is complete:

1.  **Test the extraction** with a small library
2.  **Explore the data** in Neo4j Browser
3.  **Write custom queries** for your analysis
4.  **Extract your target libraries** for research
5.  **Analyze the CSV results** with your tools

---

## Additional Resources

- **Goblin Weaver Dataset:** [Zenodo](https://zenodo.org/records/11104819)
- **Neo4jWeaverDocker:** [GitHub Repository](https://github.com/Goblin-Ecosystem/Neo4jWeaverDocker)
- **Neo4j Documentation:** [Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
- **MSR 2025 Challenge:** [Mining Challenge Page](https://2025.msrconf.org/track/msr-2025-mining-challenge)

---

## Support

**Common Issues:**
- Check [Troubleshooting](#troubleshooting) section above
- Review Docker logs: `docker-compose logs neo4j`
- Verify Neo4j Browser: http://localhost:7474

**Still stuck?**
- Check GitHub Issues in the repositories
- Verify all prerequisites are met
- Try the nuclear option: `docker-compose down -v && docker-compose up -d neo4j`

---

**Last updated:** January 2025  
**Dataset:** Goblin Weaver (used in MSR 2025 Mining Challenge)  
**Neo4j version:** 4.x/5.x