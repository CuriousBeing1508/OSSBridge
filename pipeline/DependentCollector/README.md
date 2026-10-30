# DependentCollector

# Dependency Extractor for Maven Libraries

Extract all projects that depend on a specific Maven library version.

## Quick Start

1. Install Docker Desktop
2. Clone and start the dataset:
```bash
   git clone https://github.com/Goblin-Ecosystem/Neo4jWeaverDocker.git
   cd Neo4jWeaverDocker
   docker-compose up -d neo4j
```
3. Install Python dependencies:
```bash
   pip install neo4j
```
4. Run extraction:
```bash
   python extractDependentsForALib.py "org.jetbrains.kotlin:kotlin-stdlib" "2.3.0"
```

## What This Does

Uses the MSR 2025 Mining Challenge dataset (Maven Central dependency graph) 
to find all projects that depend on a specific library version. Results are 
saved to CSV files.

## Full Documentation

See [SETUP.md](SETUP.md) for complete setup instructions and troubleshooting.