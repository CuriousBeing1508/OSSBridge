# OSSBridge Data Pipeline

The pipeline collects, for one version of a Java library on Maven Central:
- which projects depend on it,
- which of its APIs those projects use (bytecode analysis of their jars),
- its public API, and
- how well its own test suite covers each API.

The OSSBridge app shows these results. Viewing them needs only the app, which reads the published dataset. You need this pipeline only to analyze a new library or new versions of a library.

There are three ways to run it:
- the **Analyze** button in the app (frontend), which starts the GitHub Actions workflow
- the **Analyze library** workflow on GitHub Actions (see [Run on GitHub Actions](#run-on-github-actions))
- one command on your computer, directly or in the pipeline Docker image (below)

## Overview

The input is one library version, given as `group:artifact:version`. The pipeline has two independent branches whose results are combined at the end.

The **usage branch** finds out how dependent projects use the library.
- **Step 1. Select dependents** finds all projects that directly depend on the library version. We first select all dependent projects listed in the dependents index, which is built from the Goblin dump of Maven Central (see the [DependentsIndex README](DependentsIndex/README.md)). We then apply filtering. Projects that use the library only in their tests are left out, because test code is not in their published jar. Each project is counted once, using its latest release. Projects that do not name an exact version of the library are also left out, because we cannot tell which version they use.
- **Step 2. Download jars** downloads the jars of dependents from Maven Central.
- **Step 3. API Usage analysis** runs the ASM bytecode analyzer on those jars to record which library classes, methods and fields each dependent uses. If a dependent bundles a copy of the library inside its own jar, that copy is skipped, so only the dependent's own code is counted.

Steps 2 and 3 run together in batches (the **collection loop**), because many declared dependents never call the library directly. By default the loop tries every dependent of the version, so the results give a complete picture, and keeps the ones that actually use the library. For a faster run, `--target N` analyzes a sample instead. It stops once N dependents that use the library are found. They are taken first in order of reach, which is how many other projects depend on a dependent, similar to the "Used By" count on mvnrepository.com. The rest are taken in a random order, so that projects that nobody depends on are also included. The time each run takes is stored with its results and shown in the app.

The **API and coverage branch** describes the library itself:
- **Step 4. Public API** lists the classes, methods, constructors and fields of the library jar that dependents can use (public and protected), with deprecation.
- **Step 5. Test coverage** builds the library from its source release and runs its test suite with JaCoCo.
- **Step 6. Match APIs with coverage** gives each API its coverage, also counting the library methods that override it (what a call to the API actually runs).

Finally, **Step 7. Store results** writes the outputs of both branches as Parquet result tables. The app reads these tables.

We exclude versions of a library for which we do not find any direct dependent calling an API method. The two branches stay independent. For example, when a library's tests do not build, the usage results are still stored and shown.

## Folder structure

| Folder | Contents |
|---|---|
| `ossbridge_pipeline/` | The pipeline steps, the single command (`run.py`), result tables and publishing |
| [DependentsIndex/](DependentsIndex/README.md) | Builds the dependents index from the Goblin Neo4j graph, and ranks the dependents to analyze |
| [Results/](Results/README.md) | Documentation of the result tables, with an example query |
| `JavaUsageExtractor/` | ASM bytecode analyzer (Maven project) that produces `ossbridge-usage-analyzer.jar` |
| `goblin-neo4j/` and `docker-compose.yml` | Neo4j with the Goblin Maven Central graph. Only needed to build or update the dependents index |
| `Dockerfile` | The pipeline image with the analyzer, JDKs 8, 11, 17 and 21, Maven and Gradle |
| `tests/` | Tests of the pipeline steps |

## Where data goes

All data is under the repository's `data/` folder, which is not committed. Set
`OSSBRIDGE_DATA` to use another folder.

| Path | Contents |
|---|---|
| `data/dependents-index/` | Dependents index (step 1) |
| `data/runs/<group>__<artifact>@<version>/` | Working folder of one run. It can be deleted after the results are stored |
| `data/results/` | Result tables (step 7), read by the app |
| `data/tools/` | JaCoCo jars, downloaded by step 5 |

To get the published index and results instead of building them:

```bash
../.venv/bin/python -m ossbridge_pipeline.publish --download
```

Add `--app-only` to skip the index files that only the pipeline needs (about 470 MB).

## Setup

```bash
# Python tools (from the repository root)
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt

# Bytecode analyzer (needs JDK 17 or newer)
cd pipeline/JavaUsageExtractor/asm-based-analysis && ./mvnw package
```

Step 5 also needs `git`, Maven or Gradle, and the JDKs that libraries are built with. JDKs 17 and 21 cover most libraries. Older ones may need 8 or 11.

The pipeline image has all of these. To use it instead of installing them, run this from the repository root so the results are written to `data/`:

```bash
docker pull ghcr.io/curiousbeing1508/ossbridge-pipeline:latest
docker run --rm -v "$PWD/data:/data" ghcr.io/curiousbeing1508/ossbridge-pipeline:latest \
    org.mybatis:mybatis:3.5.16
```

## Run the whole pipeline

```bash
cd pipeline
../.venv/bin/python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.16
```

Runs steps 1 to 7 for the library version and prints progress as it goes:

```
[00:00] 1 Dependents: done
[00:08] 2-3 Download and analyze dependents: done
[00:09] 4 Library API: done
[00:57] 5 Test coverage: done
[00:57] 6 API coverage: done
[00:57] 7 Store results: done
Run ok: .../data/runs/org.mybatis__mybatis@3.5.16/run.json
```

- **Failures.** A failed step does not stop the run. The other branch still runs, steps that need the failed output are skipped, and step 7 stores what there is.
- **Step status.** `ok`, `failed`, `skipped` or `unavailable`. Coverage is `unavailable` when the library does not allow it, for example when it has no release tag on GitHub or is not built with Maven or Gradle. This is not a failure. The app then shows the usage results with the reason.
- **Run status.** `ok`, `partial` (results stored, some steps failed or skipped) or `failed` (nothing stored). The exit code is 0 when results were stored.
- **run.json** in the run folder has each step's status, duration, summary and failure reason.

Options:

| Option | Effect |
|---|---|
| `--target N`, `--top-target N`, `--max-tried N` | Analyze a sample of dependents instead of all of them |
| `--fetch-missing` | Add the library from Neo4j if it is not in the dependents index |
| `--skip-coverage` | Skip steps 5 and 6 |
| `--jdk N` | Build the library with this JDK only |
| `--timeout` | Time limit for the test suite (default 60 minutes) |
| `--keep-jars` | Keep the jars of selected dependents |
| `--step <name>`, `--report` | Run one step, or print a table of the steps of a run |

## Steps

Each step can also be run on its own. Examples use commons-codec 1.17.1 and are run from `pipeline/`.

### 1. Select dependents

```bash
../.venv/bin/python DependentsIndex/select_dependents.py --index ../data/dependents-index \
    --library commons-codec:commons-codec --version 1.17.1 --fetch-missing
```

Writes `candidates.csv`, one row per dependent project with its rank by reach and a random rank. `--fetch-missing` needs Neo4j running (`docker compose up -d goblin-neo4j`). The Goblin graph is a snapshot of 20 April 2025, so later releases have no dependents. See [DependentsIndex/README.md](DependentsIndex/README.md).

### 2 and 3. Collection loop

```bash
../.venv/bin/python -m ossbridge_pipeline.collect \
    --library commons-codec:commons-codec --version 1.17.1 --batch-size 50
```

Downloads and analyzes the dependents in batches and keeps the ones that use the library. Writes `dependents.csv`, `usage.csv` and `collection.json` to the run folder.

Jars are deleted after analysis. Their SHA-256 is recorded, so `ossbridge_pipeline.verify` can download a sample again and check the results.

### 4. Public API

```bash
../.venv/bin/python -m ossbridge_pipeline.public_api \
    --library commons-codec:commons-codec --version 1.17.1
```

Writes `apis.csv`, the public and protected members of the library's public classes, and `api-overrides.csv`, the library methods that override each API method. Step 6 uses both.

### 5. Test coverage

```bash
../.venv/bin/python -m ossbridge_pipeline.coverage \
    --library commons-codec:commons-codec --version 1.17.1
```

Finds the library's GitHub repository and release tag from its POM, then runs its test suite with JaCoCo using Maven or Gradle. Installed JDKs are tried from oldest to newest. Writes `coverage.xml` and `coverage.json`. When there is no coverage, `coverage.json` says why and the build log is in `coverage/build-jdk<N>.log`. Use `--repo`, `--tag` or `--jdk N` when the defaults do not work.

**Security.** This step runs the library's build and test code. Use the pipeline image for libraries you do not trust.

### 6. Match APIs with coverage

```bash
../.venv/bin/python -m ossbridge_pipeline.api_coverage \
    --library commons-codec:commons-codec --version 1.17.1
```

Joins the outputs of steps 4 and 5 and writes `api-coverage.csv` with a coverage status for each API method and constructor. An API also counts as covered when the tests ran a library method that overrides it, since a call to the API runs that method.

### 7. Store results

```bash
../.venv/bin/python -m ossbridge_pipeline.store_results \
    --library commons-codec:commons-codec --version 1.17.1
```

Writes the run's outputs as Parquet tables to `data/results/` (`--results` to change it), replacing earlier tables of the same version. The tables are `library_versions`, `apis`, `dependents`, `api_usage`, `api_coverage` and `runs`. See [Results/README.md](Results/README.md) for the columns and an example query.

The app checks for new results every 5 minutes. When it reads a local copy (`RESULTS_DIR` in `app/.env`), new results show up by themselves. When it reads the published dataset, publish first.

## Run on GitHub Actions

| Workflow | When | What it does |
|---|---|---|
| **Pipeline image** (`pipeline-image.yml`) | Push to `main` that changes `pipeline/` | Builds the image, runs the tests in it and publishes it as `ghcr.io/<owner>/ossbridge-pipeline:latest` |
| **Analyze library** (`analyze-library.yml`) | Actions > Analyze library > Run workflow, or the Analyze button | Analyzes one library version with that image and publishes the results to Hugging Face |

**Analyze library** takes `release` (`groupId:artifactId:version`), `target` (`all` or a number), `top_target`, `jdk`, `skip_coverage` and `publish`. Each pipeline step is its own workflow step. The run summary shows a table of the steps, and `run.json` and the build logs are attached as an artifact. Publishing uses the repository secret `HF_TOKEN`.

## Publish to Hugging Face

```bash
../.venv/bin/python -m ossbridge_pipeline.publish --dry-run   # print the dataset card only
../.venv/bin/python -m ossbridge_pipeline.publish             # upload
```

Uploads the result tables and the dependents index to the dataset [rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results) and writes its dataset card. Only changed files are uploaded. Use `--repo` or `OSSBRIDGE_HF_DATASET` for another dataset, and `--no-index` to skip the index. The token comes from `hf auth login` locally or `HF_TOKEN` on GitHub Actions.

## Update the dependents index from a new Goblin dump

The default snapshot is from 20 April 2025. To use a newer dump:

1. **Load the dump into Neo4j.** Set `GOBLIN_DUMP_URL` and `GOBLIN_DUMP_MD5` (see [goblin-neo4j/goblin-init.sh](goblin-neo4j/goblin-init.sh)). Loading takes 10 to 30 minutes.
   ```bash
   GOBLIN_DUMP_URL=<url> GOBLIN_DUMP_MD5=<md5> docker compose up -d --build goblin-neo4j
   docker compose logs -f goblin-neo4j   # wait for "[goblin] Dump loaded" and "Started."
   ```
2. **Set the snapshot date** in `SNAPSHOT_DATE` in [DependentsIndex/goblin.py](DependentsIndex/goblin.py) and in the dataset card in [ossbridge_pipeline/publish.py](ossbridge_pipeline/publish.py).
3. **Build the index into a new folder**, then replace `data/dependents-index` with it.
   ```bash
   cd DependentsIndex
   ../../.venv/bin/python build_index.py from-neo4j --out ../../data/dependents-index-new
   ```
4. **Publish** with `python -m ossbridge_pipeline.publish`.

Versions analyzed before the update keep their old results. Analyze them again to use the new snapshot.
