# DependentsIndex

Replaces the per-run Neo4j query (pipeline step 1) with a small Parquet index and
impact-based selection of which dependents to analyze.

| Script | What it does |
|---|---|
| `build_index.py` | Builds `edges.parquet`, `reach.parquet` and `manifest.json` from Goblin Neo4j (once) or from existing dependents CSVs |
| `select_dependents.py` | Picks the dependents to analyze for one library version and writes a CSV that `mavenDepJarDownload.py` can read |
| `validate_sampling.py` | Compares API rankings from samples with a full analysis, to choose sample sizes |

## Setup

```bash
python3 -m venv ../../.venv
../../.venv/bin/pip install -r requirements.txt
```

## Start the Goblin Neo4j database

Only needed to build the index or add libraries to it. Selecting dependents from an
existing index does not need Neo4j.

```bash
cd ..                       # pipeline/
docker compose up -d --build goblin-neo4j
docker compose logs -f goblin-neo4j   # wait for "[goblin] Dump loaded" and "Started."
```

On first start the container downloads the Goblin Maven Central dump (4.8 GB,
snapshot of 30 Aug 2024, md5-verified) and loads it into the `goblin-data`
volume, which takes roughly 10-30 minutes. Later starts take seconds. It needs about
20 GB of disk and 8 GB of RAM for Docker. Settings (all optional):
`NEO4J_PASSWORD` (default `Password1`), `NEO4J_HEAP`, `NEO4J_PAGECACHE`,
`NEO4J_BOLT_PORT`, `NEO4J_HTTP_PORT`, `GOBLIN_KEEP_DUMP=true`.

The scripts read `NEO4J_URI`, `NEO4J_USER` and `NEO4J_PASSWORD`
(defaults `bolt://localhost:7687`, `neo4j`, `Password1`).

## Build the index

Add libraries one at a time (all versions; reach of their dependents is
computed in Neo4j). The index directory can start empty:

```bash
python build_index.py add-library --library org.slf4j:slf4j-api --out ../../data/dependents-index
```

Or export the whole graph once:

```bash
python build_index.py from-neo4j --out ../../data/dependents-index
```

From previously exported CSVs (`Dataset/Neo4jDataset/`, 30 libraries / 190 versions, 824 MB → 25 MB):

```bash
python build_index.py from-csv --csv-dir ../../data/dataset/Neo4jDataset --out ../../data/dependents-index
```

CSV exports do not contain the dependency scope, and `reach` only counts dependents
inside the exported libraries, so tier A is mostly empty for a CSV-built index.

## Select dependents

```bash
python select_dependents.py --index ../../data/dependents-index \
    --library junit:junit --version 4.12 --top-k 200 --sample 200 \
    --out ../../data/junit-4.12/dependents.csv
```

For a library that is not in the index yet, add `--fetch-missing`: it runs
`add-library` against Neo4j and retries. If Neo4j has no dependents either, it
says why (unknown artifact, version released after the 30 Aug 2024 snapshot, or
no dependents).

`--index` can also be an HTTPS base URL; DuckDB then reads only the parts of
`edges.parquet` it needs (libraries added with `add-library` are only read from
local indexes).

Selection steps:
1. All releases that depend on the library version
2. Drop `test`-scoped dependencies
3. Keep the latest release of each dependent project
4. Tier A: top-K projects by `reach` (projects that depend on them), only where reach > 0
5. Tier B: seeded random sample of the rest, round-robin across groupIds

The `.summary.json` next to the CSV records counts after each step and the share of total reach covered.

## Sampling validation

Against the existing full runs (`--package` restricts to the target library's APIs):

| Library | Projects | Sample | Top-20 overlap | Kendall τ (top-50) | APIs used by ≥1% found |
|---|---|---|---|---|---|
| commons-codec 1.17.1 | 343 | 100 | 0.96 | 0.99 | 1.00 |
| jackson-databind 2.17.2 | 1,634 | 200 | 0.86 | 0.67 | 0.98 |
| jackson-databind 2.17.2 | 1,634 | 400 | 0.92 | 0.74 | 1.00 |

Mean over 20 seeds, tier B sampling only.

## Tests

```bash
../../.venv/bin/python -m pytest tests
```

Neo4j access is tested with a fake driver. To also run the integration test
against a real, empty Neo4j 4.4 (it deletes all data in that database):

```bash
docker run --rm -d --name neo4j-test -p 17687:7687 -e NEO4J_AUTH=neo4j/testpass neo4j:4.4.36-community
NEO4J_TEST_URI=bolt://localhost:17687 NEO4J_TEST_PASSWORD=testpass ../../.venv/bin/python -m pytest tests
```
