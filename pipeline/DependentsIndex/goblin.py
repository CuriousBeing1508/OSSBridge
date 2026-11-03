"""
Access to the Goblin Weaver Neo4j database (Maven Central dependency graph).

Schema used (Goblin Weaver):
    (:Artifact {id: "group:artifact"})
    (:Release  {id: "group:artifact:version", version, timestamp})
    (:Release)-[:dependency {targetVersion, scope}]->(:Artifact)

Connection settings come from NEO4J_URI, NEO4J_USER and NEO4J_PASSWORD
(defaults: bolt://localhost:7687, neo4j, Password1).
"""

import os

from neo4j import GraphDatabase
from neo4j.exceptions import ClientError

SNAPSHOT_DATE = "2025-04-20"

EDGE_RETURN = """
RETURN a.id AS library_ga, d.targetVersion AS library_version, d.scope AS scope,
       r.id AS dependent_release, r.timestamp AS release_ts
"""
EDGES_ALL = "MATCH (r:Release)-[d:dependency]->(a:Artifact)" + EDGE_RETURN
EDGES_ONE = "MATCH (r:Release)-[d:dependency]->(a:Artifact {id: $library})" + EDGE_RETURN

REACH = """
UNWIND $gas AS ga
MATCH (:Artifact {id: ga})<-[:dependency]-(r:Release)
WITH ga, split(r.id, ':') AS p
RETURN ga, count(DISTINCT p[0] + ':' + p[1]) AS reach
"""

STATUS = """
OPTIONAL MATCH (a:Artifact {id: $library})
OPTIONAL MATCH (r:Release {id: $release})
RETURN a IS NOT NULL AS artifact_found, r IS NOT NULL AS release_found, r.timestamp AS release_ts
"""

INDEXES = [
    "CREATE INDEX artifact_id IF NOT EXISTS FOR (a:Artifact) ON (a.id)",
    "CREATE INDEX release_id IF NOT EXISTS FOR (r:Release) ON (r.id)",
]


def connect(uri=None, user=None, password=None):
    driver = GraphDatabase.driver(
        uri or os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
        auth=(user or os.environ.get("NEO4J_USER", "neo4j"),
              password or os.environ.get("NEO4J_PASSWORD", "Password1")),
    )
    driver.verify_connectivity()
    return driver


def ensure_indexes(driver):
    """Create the id indexes the lookups rely on (no-op if they already exist)."""
    with driver.session() as session:
        for statement in INDEXES:
            try:
                session.run(statement).consume()
            except ClientError as e:
                # An equivalent index or uniqueness constraint already exists
                print(f"  Index note: {e.message}")


def iter_edges(driver, library=None):
    """Yield (library_ga, library_version, scope, dependent_release, release_ts)."""
    with driver.session() as session:
        if library:
            result = session.run(EDGES_ONE, library=library)
        else:
            result = session.run(EDGES_ALL)
        for record in result:
            version = record["library_version"]
            ts = record["release_ts"]
            yield (record["library_ga"],
                   None if version is None else str(version),
                   record["scope"],
                   record["dependent_release"],
                   None if ts is None else int(ts))


def iter_reach(driver, gas, chunk_size=500):
    """Yield (ga, reach): number of distinct artifacts depending on any version of ga."""
    gas = list(gas)
    with driver.session() as session:
        for start in range(0, len(gas), chunk_size):
            for record in session.run(REACH, gas=gas[start:start + chunk_size]):
                yield record["ga"], record["reach"]
            print(f"\r  Reach computed for {min(start + chunk_size, len(gas)):,}/{len(gas):,} dependents",
                  end="", flush=True)
    if gas:
        print()


def library_status(driver, library, version):
    """Explain whether a library version exists in the snapshot."""
    with driver.session() as session:
        record = session.run(STATUS, library=library, release=f"{library}:{version}").single()
    return {
        "artifact_found": record["artifact_found"],
        "release_found": record["release_found"],
        "release_ts": record["release_ts"],
    }


def describe_missing(status, library, version):
    if not status["artifact_found"]:
        return f"{library} is not in the Goblin snapshot ({SNAPSHOT_DATE}); check the groupId:artifactId"
    if not status["release_found"]:
        return (f"{library}:{version} is not in the Goblin snapshot ({SNAPSHOT_DATE}); "
                f"it may have been released after the snapshot")
    return f"{library}:{version} exists but no release in the snapshot depends on it"
