# Neo4j with the Goblin Maven Central dependency graph.
# The dump is downloaded and loaded on first start (see goblin-init.sh), not at
# build time, so the image stays small and the data lives in a volume.
FROM neo4j:4.4.36-community

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY goblin-init.sh /goblin-init.sh
RUN chmod +x /goblin-init.sh

ENTRYPOINT ["/sbin/tini", "-g", "--", "/goblin-init.sh"]
CMD ["neo4j"]
