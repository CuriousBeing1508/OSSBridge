#!/bin/bash
# First start: download the Goblin dump (resumable, checksum verified) and load
# it into the neo4j database. Later starts skip straight to Neo4j.
set -euo pipefail

DUMP_URL="${GOBLIN_DUMP_URL:-https://zenodo.org/records/13683940/files/goblin_maven_30_08_24.dump}"
DUMP_MD5="${GOBLIN_DUMP_MD5:-703624adc0d9b21a2edac5648969bcc7}"
DUMP=/dumps/goblin.dump
MARKER=/data/.goblin-loaded

if [ ! -f "$MARKER" ]; then
    mkdir -p /dumps
    if [ ! -f "$DUMP.verified" ]; then
        echo "[goblin] Downloading Maven Central dump (4.8 GB) from $DUMP_URL"
        wget --continue --tries=5 --waitretry=10 --progress=dot:giga -O "$DUMP" "$DUMP_URL"
        echo "[goblin] Verifying checksum"
        echo "$DUMP_MD5  $DUMP" | md5sum -c -
        touch "$DUMP.verified"
    fi

    echo "[goblin] Loading dump into Neo4j (this can take 10-30 minutes)"
    neo4j-admin load --from="$DUMP" --database=neo4j --force
    chown -R neo4j:neo4j /data
    touch "$MARKER"

    if [ "${GOBLIN_KEEP_DUMP:-false}" != "true" ]; then
        rm -f "$DUMP" "$DUMP.verified"
    fi
    echo "[goblin] Dump loaded"
fi

exec /startup/docker-entrypoint.sh "$@"
