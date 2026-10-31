# Neo4j with the Goblin Maven Central dependency graph.
# The dump is downloaded and loaded on first start (see goblin-init.sh), not at
# build time, so the image stays small and the data lives in a volume.
# The base image has wget; nothing is installed with apt (its Debian 11 security
# mirror no longer serves the packages the image's index points to).
FROM neo4j:4.4.36-community

COPY goblin-init.sh /goblin-init.sh
RUN chmod +x /goblin-init.sh

ENTRYPOINT ["tini", "-g", "--", "/goblin-init.sh"]
CMD ["neo4j"]
