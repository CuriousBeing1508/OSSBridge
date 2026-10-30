# OSSBridge Data Pipeline

The pipeline collects, for one version of a Java library on Maven Central:
- which projects depend on it,
- which of its APIs those projects use (bytecode analysis of their jars),
- its public API, and
- how well its own test suite covers each API.

The OSSBridge app shows these results. Viewing results only needs the app and a
dataset; you only need this pipeline to add new libraries.

> **Status:** the pipeline is run manually, step by step, for each library version.
> The app cannot start it. Steps 1, 2 and 7 have been rebuilt; steps 3–6 are still the
> original scripts, several of which have hardcoded paths. A single command and
> automatic runs (new releases, requests from the app) are planned.

## Overview

The input is one library version, given as `group:artifact:version`. The pipeline has
two independent branches whose results are combined at the end.

The **usage branch** finds out how dependent projects use the library:
1. **Dependents** selects the projects that depend on the library version, using the
   dependents index and impact-based sampling.
2. **Download jars** downloads the jar of each selected dependent from Maven Central.
3. **Usage analysis** runs the ASM bytecode analyzer on those jars to record which
   library classes, methods and fields each dependent uses.

The **API and coverage branch** describes the library itself:
4. **Public API** lists the public methods and constructors in the library jar.
5. **Test coverage** builds the library from its source release and runs its test suite
   with JaCoCo.
6. **Match APIs with coverage** parses the JaCoCo report and links coverage to each
   public API.

Finally, **7. Store results** combines the outputs of both branches into Parquet tables and
runs data-quality checks. The app is planned to read its results from these tables; it
currently still reads the dataset folder.

Because the branches do not depend on each other, they can run in parallel, and a
failure in one (for example, a library whose tests do not build) does not prevent
results from the other.

## Folder structure

| Folder | Contents |
|---|---|
| [DependentsIndex/](DependentsIndex/README.md) | **New.** Dependents index (Parquet) built from the Goblin Neo4j graph, and impact-based selection of dependents to analyze |
| [Results/](Results/README.md) | **New.** Result tables: schema, converter from the dataset folder, query helper |
| [goblin-neo4j/](goblin-neo4j/) + [docker-compose.yml](docker-compose.yml) | **New.** Neo4j with the Goblin Maven Central graph; only needed to add libraries to the dependents index |
| `JavaUsageExtractor/` | ASM bytecode analyzer (Maven project) that produces `Extract-library-usage-from-bytecode.jar` |
| `AutomatedJarDownload/` | Original scripts for steps 2–6 |
| `DependentCollector/` | Original Neo4j dependents export, replaced by DependentsIndex |

## Where data goes

All pipeline output is under the repository's `data/` folder, which is not committed:

| Path | Contents |
|---|---|
| `data/dataset/` | Dataset folder the app currently reads (`processed_csvs/`, `LibraryJars/`, `TestCoverage/`, `StaticAnaResults/`, ...) |
| `data/dependents-index/` | Dependents index (step 1) |
| `data/runs/<group>__<artifact>@<version>/` | Working folder of one pipeline run (converted steps write here) |
| `data/results/` | Result tables (step 7) |

`data/dataset` can be a symlink to a dataset stored elsewhere. The original scripts for
steps 3–6 write into it, so existing files for the same library version are overwritten.

## Setup

```bash
# Python tools (from the repository root)
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/pip install -r pipeline/AutomatedJarDownload/requirements.txt   # original scripts

# Bytecode analyzer (needs JDK 17+)
cd pipeline/JavaUsageExtractor/asm-based-analysis && ./mvnw package
```

Steps 4–5 also need a JDK (`javap`), Maven or Gradle, and `unzip`.

## Steps

Examples use commons-codec 1.17.1. Paths are relative to `pipeline/` unless noted.

### 1. Dependents (new)
Find the projects that depend on the library version and select which ones to analyze.
See [DependentsIndex/README.md](DependentsIndex/README.md).

```bash
cd DependentsIndex
../../.venv/bin/python select_dependents.py --index ../../data/dependents-index \
    --library commons-codec:commons-codec --version 1.17.1 --fetch-missing \
    --out ../../data/selections/commons-codec-1.17.1.csv
```

The output CSV has the same leading columns as `processed_csvs/` files, so steps 2–3
can read it directly.

`--fetch-missing` adds the library from Neo4j if it is not in the index yet (start Neo4j
first with `docker compose up -d goblin-neo4j`). The Goblin graph is a snapshot of
30 Aug 2024; later releases have no dependents in it.

*Replaces `DependentCollector/Script/extractDependentsForALib.py` + `getMavenMetadata.py`.*

### 2. Download dependent jars (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.download_jars \
    --dependents ../data/selections/commons-codec-1.17.1.csv \
    --out ../data/runs/commons-codec__commons-codec@1.17.1/dependent-jars
```
Downloads each `release_id` jar from Maven Central (4 in parallel, with retries) and
writes one status per dependent to `dependent-jars.csv`: `downloaded`, `present`,
`no_classes` (valid jar without classes, nothing to analyze), `not_found` (no jar on
Maven Central) or `failed`. Jars are checked before they are saved, so partial
downloads are never kept. Running it again only downloads what is missing.

From Python: `download_jars.run(Workspace(library, version))`.

*Replaces `AutomatedJarDownload/mavenDepJarDownload.py` (which had the output folder
hardcoded and saved any HTTP 200 response as a jar; 2 truncated jars were found in the
existing jackson-databind 2.12.7.2 downloads).*

### 3. Usage analysis (original script)
`AutomatedJarDownload/CallLibraryUsageExtractor.py` runs the bytecode analyzer on the
downloaded jars and writes one `*_third_party_calls.csv` per jar to
`StaticAnaResults/<artifact>-<version>/`. Then copy them to the folder the app reads:
```bash
AutomatedJarDownload/config/copy.sh commons-codec-1.17.1
```
**Limitations:** paths and the target are set at the bottom of the script. The output
contains calls to every third-party library, not only the target; step 7 (store results)
filters it to the library's own packages.

### 4. Public API (original script)
Download the library jar from Maven Central into `data/dataset/LibraryJars/`, then:
```bash
AutomatedJarDownload/ExtractDetailsFromJar.sh ../data/dataset/LibraryJars/commons-codec-1.17.1.jar
```
Writes `<artifact>-<version>_available_apis.csv` next to the jar.
**Limitations:** the jar download is manual; `javap -public` leaves out protected
members, which subclasses of the library use.

### 5. Test coverage (original scripts)
Downloads the library source for the release tag from GitHub, runs its tests with
JaCoCo, and copies the report to `data/dataset/TestCoverage/`:
```bash
cd AutomatedJarDownload
./ExtractCoverageCommons-codec.sh commons-codec 1.17.1 apache commons-codec
```
**Limitation:** there is one copy of the script per tag format
(`rel/<artifact>-<version>` for commons-codec, `<artifact>-<version>` for jackson:
`ExtractCoverageJack2.12.7.2FrmSource.sh`).

### 6. Match APIs with coverage (original scripts)
```bash
cd AutomatedJarDownload/scripts_MatchingTestCov
python parse_jacoco_xml.py <coverage.xml> <method_coverage.csv>
python match_apis_coverage.py <available_apis.csv> <method_coverage.csv> <all_apis_coverage.csv>
```
`run_match_apis_coverage_pipeline.py` runs both for the libraries in
`config/libraries.yaml`, but currently fails: it calls `parse_jacoco_xmlV2.py` and
`match_apis_coverageV2.py` (renamed to the names above) and looks for data in
`AutomatedJarDownload/Dataset/`.

### 7. Store results (new)
Convert the dataset folder into result tables and check data quality.
See [Results/README.md](Results/README.md).
```bash
cd Results
../../.venv/bin/python convert_dataset.py --dataset ../../data/dataset --results ../../data/results
```
The app does not read the result tables yet.

## Other scripts

| Script | Purpose |
|---|---|
| `AutomatedJarDownload/downloadJarsOnYears.py`, `downloadJarsAndUsageStatsForLib.py` | Download all released versions of one library (library hardcoded) |
| `DependentCollector/Script/extractDependents.py`, `SelectLibraries`, `popular_libraries.json` | Batch export of dependents for popular libraries from Neo4j |
| `DependentCollector/Script/getGithubURL.py` | Read the source repository (SCM) from a library's POM |
| `AutomatedJarDownload/test.py` | Near-copy of `mavenDepJarDownload.py` |
| `Neo4jSetup.md`, `DependentCollector/setup.md` | Original manual Neo4j setup; `docker compose up -d goblin-neo4j` replaces it |
