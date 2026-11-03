#!/bin/bash
# First start: download the Goblin dump (resumable, checksum verified) and load
# it into the neo4j database. Later starts skip straight to Neo4j. The marker
# holds the dump's checksum, so a different dump is downloaded and loaded again.
set -euo pipefail

DUMP_URL="${GOBLIN_DUMP_URL:-https://zenodo.org/records/15481588/files/goblin_maven_20_04_2025.dump}"
DUMP_MD5="${GOBLIN_DUMP_MD5:-ca3c5188626d0f089b7cb1fde11ad084}"
DUMP=/dumps/goblin.dump
MARKER=/data/.goblin-loaded

if [ "$(cat "$MARKER" 2>/dev/null)" != "$DUMP_MD5" ]; then
    mkdir -p /dumps
    if [ "$(cat "$DUMP.verified" 2>/dev/null)" != "$DUMP_MD5" ]; then
        # A partial download of another dump cannot be resumed
        if [ -f "$DUMP.url" ] && [ "$(cat "$DUMP.url")" != "$DUMP_URL" ]; then
            rm -f "$DUMP"
        fi
        echo "$DUMP_URL" > "$DUMP.url"
        echo "[goblin] Downloading Maven Central dump (about 6 GB) from $DUMP_URL"
        wget --continue --tries=5 --waitretry=10 --progress=dot:giga -O "$DUMP" "$DUMP_URL"
        echo "[goblin] Verifying checksum"
        echo "$DUMP_MD5  $DUMP" | md5sum -c -
        echo "$DUMP_MD5" > "$DUMP.verified"
    fi

    echo "[goblin] Loading dump into Neo4j (this can take 10-30 minutes)"
    neo4j-admin load --from="$DUMP" --database=neo4j --force
    chown -R neo4j:neo4j /data
    echo "$DUMP_MD5" > "$MARKER"

    if [ "${GOBLIN_KEEP_DUMP:-false}" != "true" ]; then
        rm -f "$DUMP" "$DUMP.verified" "$DUMP.url"
    fi
    echo "[goblin] Dump loaded"
fi

exec /startup/docker-entrypoint.sh "$@"
