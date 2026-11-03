# OSSBridge Data Pipeline

The pipeline collects, for one version of a Java library on Maven Central:
- which projects depend on it,
- which of its APIs those projects use (bytecode analysis of their jars),
- its public API, and
- how well its own test suite covers each API.

The OSSBridge app shows these results. Viewing results only needs the app and a
dataset; you only need this pipeline to add new libraries.

> **Status:** the pipeline runs with one command for any library version (below). It is
> started by hand; the app cannot start it yet. Automatic runs (GitHub Actions, new
> releases, requests from the app) are planned.

## Overview

The input is one library version, given as `group:artifact:version`. The pipeline has
two independent branches whose results are combined at the end.

The **usage branch** finds out how dependent projects use the library:
1. **Dependents** lists every project that depends on the library version, using the
   dependents index, and ranks them by reach and in a random order.
2. **Download jars** downloads the jars of dependents from Maven Central.
3. **Usage analysis** runs the ASM bytecode analyzer on those jars to record which
   library classes, methods and fields each dependent uses.

Steps 2 and 3 run together in batches (the **collection loop**) until enough dependents
that actually use the library have been found, because many declared dependents never
call it directly.

The **API and coverage branch** describes the library itself:
4. **Public API** lists the classes, methods, constructors and fields of the library jar
   that dependents can use (public and protected), with deprecation.
5. **Test coverage** builds the library from its source release and runs its test suite
   with JaCoCo.
6. **Match APIs with coverage** gives each API its coverage, also counting the library
   methods that override it (what a call to the API actually runs).

Finally, **7. Store results** writes the outputs of both branches as Parquet result
tables. The app is planned to read its results from these tables; it currently still
reads the dataset folder.

Because the branches do not depend on each other, they can run in parallel, and a
failure in one (for example, a library whose tests do not build) does not prevent
results from the other.

## Folder structure

| Folder | Contents |
|---|---|
| [DependentsIndex/](DependentsIndex/README.md) | **New.** Dependents index (Parquet) built from the Goblin Neo4j graph, and impact-based selection of dependents to analyze |
| [Results/](Results/README.md) | **New.** Documentation of the result tables, and the converter from the original dataset folder |
| [goblin-neo4j/](goblin-neo4j/) + [docker-compose.yml](docker-compose.yml) | **New.** Neo4j with the Goblin Maven Central graph; only needed to add libraries to the dependents index |
| `JavaUsageExtractor/` | ASM bytecode analyzer (Maven project) that produces `ossbridge-usage-analyzer.jar` |
| `ossbridge_pipeline/` | **New.** Pipeline steps as Python functions (steps 1–6 and the collection loop so far), each runnable for a library version |
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
`data/tools/` holds the JaCoCo jars downloaded by step 5.

## Setup

```bash
# Python tools (from the repository root)
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/pip install -r pipeline/AutomatedJarDownload/requirements.txt   # original scripts

# Bytecode analyzer (needs JDK 17+)
cd pipeline/JavaUsageExtractor/asm-based-analysis && ./mvnw package
```

Step 5 also needs `git`, Maven, and the JDKs that libraries are built with (17 and 21
cover most; older libraries may need 8 or 11).

Steps 4–5 also need a JDK (`javap`), Maven or Gradle, and `unzip`.

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
  Found 76 of 100 dependents that use the library: all 95 candidates were tried; ...
  API coverage: 85.1% of 5665 APIs
```

- **Failures:** a failed step does not stop the run. The other branch still runs, steps that
  need its output are skipped (e.g. no API coverage without test coverage), and step 7
  stores what there is. The run's status is `ok`, `partial` (results stored, some steps
  failed or skipped) or `failed` (nothing stored); the exit code is 0 when the results
  were stored.
- **run.json** in the run folder has each step's status, duration, summary and, if it
  failed, the reason. It is updated while the run goes on.
- **Options:** `--target`, `--top-target`, `--max-tried` (collection loop),
  `--fetch-missing` (add the library from Neo4j if it is not in the dependents index),
  `--skip-coverage`, `--jdk` (build the library with this JDK only), `--timeout` (test
  suite), `--keep-jars`, `--index`, `--results`.

From Python: `run.run_pipeline(library_ga, version, progress=...)`.

## Steps

Each step can also be run on its own. Examples use commons-codec 1.17.1. Paths are
relative to `pipeline/` unless noted.

### 1. Dependents (new)
List every project that depends on the library version and rank them.
See [DependentsIndex/README.md](DependentsIndex/README.md).

```bash
../.venv/bin/python DependentsIndex/select_dependents.py --index ../data/dependents-index \
    --library commons-codec:commons-codec --version 1.17.1 --fetch-missing
```

Writes `candidates.csv` to the run folder: one row per dependent project (its latest
release; test-scoped dependencies are dropped) with `rank_reach` (by reach, highest
first; only dependents with reach > 0) and `rank_random` (seeded random order in which
every project has the same chance).

`--fetch-missing` adds the library from Neo4j if it is not in the index yet (start Neo4j
first with `docker compose up -d goblin-neo4j`). The Goblin graph is a snapshot of
20 Apr 2025; later releases have no dependents in it.

*Replaces `DependentCollector/Script/extractDependentsForALib.py` + `getMavenMetadata.py`.*

### Steps 2 and 3 together: the collection loop (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.collect \
    --library commons-codec:commons-codec --version 1.17.1 \
    --target 400 --top-target 300 --batch-size 50 --max-tried 3000
```
Walks `candidates.csv` in batches; for each batch it downloads the jars (step 2),
analyzes them (step 3) and keeps the dependents that use the library:
- **Top tier:** in order of reach until `--top-target` using dependents are selected.
- **Random tier:** in the random order, skipping dependents already tried, until the
  total reaches `--target`.
- Stops when the target is reached, the candidates run out, or `--max-tried`
  candidates have been tried; the reason is recorded for each tier. If fewer dependents
  use the library than the target, it keeps what it found and says so, e.g. *"Found 87 of
  400 dependents that use the library: all 758 candidates were tried ..."*
  (`target_reached` and `shortfall` in `collection.json`).

Outputs in the run folder: `dependents.csv` (every candidate tried, with tier, rank,
download status, whether it uses the library, whether it was selected and why not),
`dependent-jars.csv` (download status and SHA-256 of every jar), `usage.csv` (selected
dependents only), `usage-summary.csv` (every analyzed jar) and `collection.json`
(parameters, counts, share of dependents using the library, reach covered, stop reasons, SHA-256 of the library jar and the analyzer). From Python:
`collect.run(Workspace(library, version))`.

**Jars are deleted after analysis.** Jars of dependents that are not selected are deleted
after each batch, and the selected ones at the end; `--keep-jars` keeps the selected ones
(e.g. for debugging). The results do not need the jars: releases on Maven Central cannot
be changed, and every jar's SHA-256 is recorded, so the analysis can be checked later:

```bash
../.venv/bin/python -m ossbridge_pipeline.verify \
    --library commons-codec:commons-codec --version 1.17.1 --sample 10
```
This downloads a random sample of the selected dependents again, checks their SHA-256,
analyzes them again and compares the rows with `usage.csv`. It also reports when the
analyzer differs from the one recorded in `collection.json`.

For commons-codec 1.17.1 (target 400), all 758 candidates were tried in 16 batches
(100 seconds): 87 of the 731 projects with a jar (11.9%) call commons-codec directly, so
all 87 were selected and the shortfall reported. The run folder is under 2 MB after the
jars are deleted, and `verify` reproduced all 10 sampled dependents.

Steps 2 and 3 can also be run on their own, as described below.

### 2. Download dependent jars (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.download_jars \
    --dependents <csv with a release_id column> \
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

### 3. Usage analysis (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.usage_analysis \
    --library commons-codec:commons-codec --version 1.17.1
```
Downloads the library jar into the run folder (if missing) and runs the bytecode
analyzer on `dependent-jars/`. Writes `usage.csv` (one row per dependent jar, usage
category, target and declaring class, with the number of occurrences and calling
classes) and `usage-summary.csv` (one row per dependent jar).

How usage is decided:
- A class belongs to the library when its package is one of the packages in the library
  jar (exact match), so relocated (shaded) copies of the library are not counted.
- Classes inside a dependent jar that are in a library package (a bundled copy of the
  library) are skipped.
- Method and field references are resolved to the class that declares them, through
  library superclasses and interfaces, and through the dependent's own subclasses of
  library classes. `resolution` is `declared`, `inherited`, `subclass`, `external`
  (declared outside the library, e.g. `java.lang.Enum`) or `unknown`.
- Recorded categories: method calls, method references, field accesses, type references
  (new, casts, instanceof, arrays), class literals, extends/implements, annotations
  (class, method, field, parameter) and fields of library types. Every occurrence is
  counted.

Requires the analyzer jar (`./mvnw package` in `JavaUsageExtractor/asm-based-analysis`;
override the location with `OSSBRIDGE_USAGE_ANALYZER`). From Python:
`usage_analysis.run(Workspace(library, version))`.

*Replaces `AutomatedJarDownload/CallLibraryUsageExtractor.py` and `config/copy.sh`. The
original analyzer derived the library packages from the coordinate text (for
commons-codec this matched every `org.apache.commons` library), counted bundled copies
and recorded each usage only once per jar. On the existing commons-codec 1.17.1 jars,
the new analyzer finds every commons-codec usage the original found, except those in 2
jars that bundle commons-codec; for jackson-databind 2.17.2, 96.6% of resolved calls
match a public API, against 68% before.*

### 4. Public API (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.public_api \
    --library commons-codec:commons-codec --version 1.17.1
```
Downloads the library jar into the run folder (if missing) and writes `apis.csv`: one
row per class member a dependent can use, with `api_id`, kind (method, constructor,
field), visibility, static, `abstract` (abstract or native), class kind, `deprecated`,
`deprecated_for_removal`, `class_deprecated` and `exported`. It also writes
`api-overrides.csv`: for each API method, the library methods that override or
implement it, in any class (public or not), following the bridge methods the compiler
generates for generics. Step 6 uses it.

What counts as API:
- Public top-level classes, and public or protected nested classes of those; not
  package-private, private, anonymous or local classes.
- Their public members, and their protected members unless the class is final
  (protected members are used by subclasses).
- Not compiler-generated (synthetic and bridge) methods.
- `exported` is false for packages that the library's `module-info` does not export.

`api_id` uses the same format as the usage analysis (step 3): `<package>.<Class>.<member><descriptor>`
for methods and constructors (`<init>`), `<package>.<Class>.<field>:<descriptor>` for
fields. From Python: `public_api.run(Workspace(library, version))`.

*Replaces `AutomatedJarDownload/ExtractDetailsFromJar.sh` (`javap -public`). Against
the existing API lists: every public method of the old list that a dependent can use is
included; added are the protected members (1,225 methods and constructors for
jackson-databind 2.17.2); left out are members of private, package-private and
anonymous classes and compiler-generated bridge methods, which `javap -public` listed.
With this list, all 43,507 resolved method calls and 4,807 field accesses of the
jackson-databind 2.17.2 dependents match an API (96.6% of calls before).*

### 5. Test coverage (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.coverage \
    --library commons-codec:commons-codec --version 1.17.1
```
Runs the library's own test suite for the released version with JaCoCo and writes
`coverage.xml` (JaCoCo report) and `coverage.json` (status, repository, tag, module,
build tool, JDK, test counts, duration, log file). The project's build files are not
changed:
1. **Source:** the GitHub repository from the POM's `<scm>` on Maven Central, following
   `<parent>` POMs when it is inherited. The release tag is the POM's `<scm><tag>` if it
   names this version (some projects leave the previous release's tag in the POM), else
   the first existing tag of patterns such as `rel/<artifact>-<v>`, `<artifact>-<v>`,
   `v<v>`, `<v>`, `parent-<v>`, `version-<v>`, `v_<v>`, else a tag ending in exactly the
   version that is not a pre-release. Flavors such as guava's `33.2.1-jre` use the tag
   of `33.2.1`. `--repo` and `--tag` override them.
2. **Module:** a shallow clone of the tag; the Maven module whose `pom.xml` declares the
   artifactId (also in a subfolder), plus sibling modules that hold its tests
   (`<artifact>-test`, `<artifact>-tests`, e.g. `guava-tests`); or the Gradle project.
   The installed Maven is used rather than the project's `mvnw`. If building only the
   module and what it depends on fails, the whole project is built (without tests).
3. **JDK:** oldest first. The lowest installed JDK that can build the Java release the
   POM asks for is tried first (all JDKs from the oldest when the POM does not say), and
   the next newer one when no tests run; a JDK that is too old usually fails within
   seconds. Builds for Java 7 or older are compiled as Java 8. `--jdk N` uses only that
   JDK. Installed JDKs are found automatically, or set `OSSBRIDGE_JDKS="17=/path,21=/path"`.
   If no JDK runs the tests, the JDKs are tried again with the Maven profiles that switch
   on by JDK version turned off (e.g. jackson-databind 2.12's `java14+`, which compiles
   tests with Java 14 preview features that only JDK 14 accepts); `disabled_profiles` in
   `coverage.json` records it, since some tests are then left out.
4. **Coverage:** the JaCoCo agent is attached through `JAVA_TOOL_OPTIONS`, so every test
   JVM records coverage whatever the build configures, for the library's packages only.
   Checks unrelated to tests (license, style, enforcer, javadoc, ...) are skipped and
   test failures do not stop the run. The report is made with the JaCoCo command line.

`status` is `ok`, or why there is no coverage: `no_repository`, `no_tag`,
`clone_failed`, `no_module`, `build_tool_missing`, `no_jdk`, `build_failed`, `timeout`
(`--timeout`, default 60 minutes), `no_coverage` or `report_failed`. The source checkout
is deleted afterwards (`--keep-source` keeps it). A timeout stops the build and every
test JVM it started. From Python: `coverage.run(Workspace(library, version), progress=...)`.

When there is no coverage, `coverage.json` also has `attempts` (each JDK tried and the
first error in its build log) and `hint` (what to do: e.g. install the JDK the project
needs and pass `--jdk N`, or pass `--tag`, `--repo` or `--timeout`; otherwise report the
library at https://github.com/CuriousBeing1508/OSSBridge/issues). Both commands print
them at the end.

The command prints its progress (source, clone, JDK, build commands, test classes done,
report) with the elapsed time; the full build output is in
`coverage/build-jdk<N>.log`, e.g. `tail -f` it to follow the build.

**Security:** this runs the library's build and test code. Run it in a container for
libraries you do not trust (a pipeline container image is planned).

*Replaces `ExtractCoverageCommons-codec.sh` and `ExtractCoverageJack2.12.7.2FrmSource.sh`,
which edited `pom.xml` and had one copy per tag format. Against the existing reports:*

| Library | Tag found | Tests | Instruction coverage (old report) | Methods with identical counts |
|---|---|---|---|---|
| commons-codec 1.17.1 | `rel/commons-codec-1.17.1` | 1,716 | 97.5% (97.5%) | 996 of 996 |
| jackson-databind 2.17.2 | `jackson-databind-2.17.2` | 4,131 | 76.73% (76.73%) | 7,923 of 7,937 |
| jackson-databind 2.12.7.2 | `jackson-databind-2.12.7.2` | 2,601 | 75.73% (75.74%) | 7,295 of 7,302 |

*All methods have the same covered/uncovered status; the few count differences are in
compiler-generated code (anonymous class constructors). Each run took under 30 seconds
with dependencies already in the local Maven repository.*

On other libraries (JDK 17, macOS):

| Library | Tag found | Build | Tests | Result |
|---|---|---|---|---|
| commons-lang3 3.14.0 | `rel/commons-lang-3.14.0` | Maven | 9,371 | ok |
| gson 2.11.0 | `gson-parent-2.11.0` | Maven, module `gson` | 1,371 | ok |
| slf4j-api 2.0.13 | `v_2.0.13` | Maven, module `slf4j-api` | 60 | ok |
| joda-time 2.12.7 | `v2.12.7` | Maven | 4,232 | ok |
| junit 4.13.2 | `r4.13.2` | Maven | 1,108 | ok |
| log4j-api 2.23.1 | `rel/2.23.1` | Maven, tests in `log4j-api-test` | 816 | ok |
| mybatis 3.5.16 | `mybatis-3.5.16` | Maven | 1,769 | ok |
| okhttp 4.12.0 | `parent-4.12.0` | Gradle, module `okhttp` | 2,868 | ok |
| guava 33.2.1-jre | `v33.2.1` | Maven, tests in `guava-tests` | 857,830 | ok (7 min) |
| h2 2.2.224 | `version-2.2.224` | Maven, module `h2` | | `timeout`: its test harness runs for hours |
| lombok 1.18.34 | `v1.18.34` | Ant | | `no_build`: Ant is not supported |

Known gaps: build tools other than Maven and Gradle; test suites that take longer than
the timeout; and repositories with several builds of the same artifact (guava's
`-android` flavor is built from `android/` and is not found).

### 6. Match APIs with coverage (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.api_coverage \
    --library commons-codec:commons-codec --version 1.17.1
```
Joins `apis.csv` and `api-overrides.csv` (step 4) with `coverage.xml` (step 5) and writes
`api-coverage.csv`: one row per API method or constructor with a status, the number of
overriding methods and how many of them are covered, and the JaCoCo counters of the
API's own body. Statuses:

| Status | Meaning |
|---|---|
| `covered` | the tests ran at least one of its instructions |
| `covered_by_override` | its own body was not run (or it has none), but the tests ran a library method that overrides or implements it; a call to the API runs that method (e.g. `JsonNode.get(String)` runs `ObjectNode.get(String)`) |
| `not_covered` | it has code, but neither it nor any override was run |
| `no_code` | abstract or native, and no override was run either |
| `generated` | enum `values()`/`valueOf()`: generated by the compiler and left out of JaCoCo reports |
| `not_reported` | not in the report for another reason (e.g. a class not compiled in the coverage build) |

From Python: `api_coverage.run(Workspace(library, version))`.

| Library | APIs (methods, constructors) | covered | covered by override | not covered | no code | generated | API coverage |
|---|---|---|---|---|---|---|---|
| commons-codec 1.17.1 | 692 | 626 | 15 | 43 | 0 | 8 | 93.7% |
| jackson-databind 2.17.2 | 7,396 | 5,076 | 626 | 1,533 | 123 | 38 | 78.8% |
| jackson-databind 2.12.7.2 | 7,005 | 4,757 | 596 | 1,502 | 118 | 32 | 78.1% |

*API coverage = (covered + covered by override) / (covered + covered by override + not
covered). Replaces `scripts_MatchingTestCov/` (`parse_jacoco_xml.py`,
`match_apis_coverage.py`, `run_match_apis_coverage_pipeline.py`), which matched on
signatures that differed for constructors, did not follow overrides, and left 160
(commons-codec) and 1,696 (jackson-databind 2.17.2) APIs without coverage data; every
API now has coverage data or a stated reason.*

### 7. Store results (new)
```bash
../.venv/bin/python -m ossbridge_pipeline.store_results \
    --library commons-codec:commons-codec --version 1.17.1
```
Writes the run folder's outputs to `data/results/` (`--results` to change it), replacing
any earlier tables of the same library version:

| Table | From |
|---|---|
| `library_versions` | one summary row: dependents found, tried, using and selected; coverage status; tests run; API coverage |
| `apis` | `apis.csv` (step 4) |
| `dependents` | `dependents.csv` (collection loop), with release dates and bytecode sizes |
| `api_usage` | `usage.csv` (step 3), with the `api_id` of the declaring class |
| `api_coverage` | `api-coverage.csv` (step 6) |
| `runs` | `collection.json` and `coverage.json` of the run |

Tables whose step produced nothing (e.g. coverage failed) are not written; the summary
row says why. See [Results/README.md](Results/README.md) for the columns and an example
query. From Python: `store_results.run(Workspace(library, version))`.

The original dataset folder can be converted to the same tables with
`Results/convert_dataset.py`. The app does not read the result tables yet.

## Run on GitHub Actions

Two workflows in `.github/workflows/`:

| Workflow | When | What it does |
|---|---|---|
| **Pipeline image** (`pipeline-image.yml`) | Push to `main` that changes `pipeline/` | Builds the image from `pipeline/Dockerfile`, runs the tests in it, publishes it as `ghcr.io/<owner>/ossbridge-pipeline:latest` |
| **Analyze library** (`analyze-library.yml`) | Actions > Analyze library > Run workflow | Analyzes one library version with that image and publishes the results to the Hugging Face dataset |

**Analyze library** inputs: `release` (`groupId:artifactId:version`), `target`, `top_target`,
`jdk`, `skip_coverage`, `publish` (default on) and `request_id` (optional, shown in the
run name). It downloads the dependents index and the published results from the
dataset, runs each pipeline step as its own workflow step (`run --step <name>`, all
recorded in one `run.json`), publishes with the repository secret `HF_TOKEN`, writes a
table of the steps to the run summary (`run --report`), and attaches `run.json`, the
summaries and the build logs as an artifact. A failed step is shown as failed without
stopping the others, as in the single command. Two runs of the same version wait for
each other. Steps can also be run one at a time locally:

```bash
../.venv/bin/python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.14 --step dependents
../.venv/bin/python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.14 --step collect   # api, coverage, ...
../.venv/bin/python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.14 --report
```

## Publish to Hugging Face

```bash
../.venv/bin/python -m ossbridge_pipeline.publish --dry-run   # print the dataset card only
../.venv/bin/python -m ossbridge_pipeline.publish             # upload
```

Uploads the result tables (`results/`) and the dependents index (`dependents-index/`) to
the dataset [rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results)
(`--repo` or `OSSBRIDGE_HF_DATASET` to change it), and writes its dataset card from the
current results: the library versions included, the tables and columns, how the data is
produced, its limitations, and how to query it. Each table is a dataset viewer config.
Only changed files are transferred. Files written with an older schema are first
rewritten to the current one (new columns empty), since all files of a table must have
the same columns. Options: `--no-index`, `--card-only`, `--message`.

The token comes from `hf auth login` (locally) or `HF_TOKEN` (GitHub Actions).

## Other scripts

| Script | Purpose |
|---|---|
| `AutomatedJarDownload/downloadJarsOnYears.py`, `downloadJarsAndUsageStatsForLib.py` | Download all released versions of one library (library hardcoded) |
| `DependentCollector/Script/extractDependents.py`, `SelectLibraries`, `popular_libraries.json` | Batch export of dependents for popular libraries from Neo4j |
| `DependentCollector/Script/getGithubURL.py` | Read the source repository (SCM) from a library's POM |
| `AutomatedJarDownload/test.py` | Near-copy of `mavenDepJarDownload.py` |
| `Neo4jSetup.md`, `DependentCollector/setup.md` | Original manual Neo4j setup; `docker compose up -d goblin-neo4j` replaces it |
