# OSSBridge

OSSBridge helps Java library maintainers see how their public APIs are used by dependent projects and how well those APIs are tested.

## Repository layout

```
OSSBridge/
├── app/        Web application (React frontend + Node backend, Docker Compose)
├── pipeline/   Data collection pipeline (one command per library version)
│   ├── ossbridge_pipeline/     The pipeline steps, result tables and publishing
│   ├── DependentsIndex/        Dependents index (Parquet) and impact-based dependent selection
│   ├── JavaUsageExtractor/     ASM bytecode analyzer (Maven project)
│   ├── goblin-neo4j/           Neo4j with the Goblin Maven Central graph (to rebuild the index)
│   └── AutomatedJarDownload/, DependentCollector/   Original scripts the pipeline replaced
└── data/       Data produced by the pipeline (git-ignored)
    ├── results/            Result tables (Parquet) the app reads
    └── dependents-index/   Parquet index of who depends on which library version
```

The results and the dependents index are published in the Hugging Face dataset
[rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results).
The app is online at https://rachna1508-ossbridge.hf.space.

## Running the app locally

You need [Docker Desktop](https://www.docker.com/products/docker-desktop) (running) and the
data the app reads:

- **Result tables**: the analyzed library versions (`data/results`).
- **Dependents index** (optional): every library and version on Maven Central with its number
  of dependent projects (`data/dependents-index`). With it the app lists all libraries and
  versions and marks which ones are analyzed; without it, only analyzed versions are listed.

### 1. Choose where the data is read from

Copy the settings file:

```bash
cd app
cp .env.example .env
```

Then either

- **read the published dataset** (nothing to download; needs an internet connection): in
  `app/.env`, uncomment the two `hf://` lines:
  ```bash
  RESULTS_PATH=hf://datasets/rachna1508/ossbridge-results/results
  INDEX_PATH=hf://datasets/rachna1508/ossbridge-results/dependents-index
  ```
- **or use a local copy** in `data/` (the default settings, `RESULTS_DIR=../data/results` and
  `INDEX_DIR=../data/dependents-index`). Run the pipeline to fill it, or download the published
  data (about 900 MB, mostly the index), from the repository root:
  ```bash
  python3 -m venv .venv
  .venv/bin/pip install -r pipeline/requirements.txt
  cd pipeline
  ../.venv/bin/python -m ossbridge_pipeline.publish --download
  ```

### 2. Build and start the app

From `app/`:

```bash
docker compose up -d --build
```

The first build takes a few minutes. Use `--build` again whenever the code changes, so the
containers run the new code.

### 3. Wait until the data is loaded

```bash
docker compose logs -f backend
```

It is ready when the log shows:

```
[INFO] Result tables loaded from ...
[INFO] Dependents index summaries loaded from ...
OSSBridge backend running on http://localhost:5050
```

(The second line is missing when there is no dependents index.) Press Ctrl+C to stop following
the log; the app keeps running.

### 4. Open the app

Go to http://localhost:3000 (the backend API is on http://localhost:5050). For example:

- search `mybatis`: `org.mybatis:mybatis` is marked "Analyzed: 3 versions"; open it and switch
  to **All versions** to see the analyzed versions and the ones not analyzed yet, with their
  number of dependent projects;
- open an analyzed version for its maintainer summary and its tabs;
- versions released after the dependents snapshot (20 April 2025) are listed from Maven
  Central and marked "Released after the snapshot", with their release date from deps.dev;
  e.g. `org.mybatis:mybatis` 3.6.0.

If the browser shows an older version of the page, reload it with Cmd+Shift+R (Ctrl+Shift+R
on Windows and Linux).

### Analyzing new versions from the app (optional)

Versions that are not analyzed yet get an **Analyze** button when the backend has a GitHub
token. The backend then starts the **Analyze library** workflow (GitHub Actions) for that
version, the card shows its progress, and the version turns green once the results are
published. The token stays on the server; visitors never see it.

1. Create a **fine-grained** personal access token (not a classic one: a fine-grained token
   can be limited to this one repository and to the Actions permission, so if it leaked it
   could only start or cancel workflow runs here; the smallest classic token that can start
   workflows also has the `repo` scope, which reads and writes the code of every repository
   of the account).

   Open https://github.com/settings/personal-access-tokens/new and fill in:

   | Field | Value |
   |---|---|
   | Token name | e.g. `ossbridge-analyze` |
   | Resource owner | the account that owns the repository |
   | Expiration | your choice (e.g. 90 days; create a new token when it expires) |
   | Repository access | **Only select repositories**, then this repository |
   | Repository permissions | **Actions: Read and write** (GitHub adds **Metadata: Read-only** by itself); everything else **No access** |

   Click **Generate token** and copy it at once: GitHub shows it only once. Keep it out of
   files in the repository.
2. Start the app with it (from `app/`):
   ```bash
   export GITHUB_TOKEN=<the token>
   docker compose up -d --build
   ```
   On the Hugging Face Space: **Settings**, **Variables and secrets**, **New secret**, name
   `GITHUB_TOKEN`, value the token. Use a secret, not a variable: variables are public. The
   Space restarts and the Analyze buttons appear.

Limits, so the button can be public: only releases on Maven Central with dependents in the
index, not ones already analyzed or running, at most 3 analyses at once and 5 started per
hour (`ANALYZE_MAX_RUNNING`, `ANALYZE_MAX_PER_HOUR`). A fork sets `GITHUB_REPO` (owner/name)
to start the workflow in its own repository, which needs the `HF_TOKEN` secret to publish.

### 5. Stop the app

```bash
docker compose down
```

### Troubleshooting

- **The backend stops with "Could not load the result tables"**: the results folder or URL in
  `app/.env` is wrong, or (for `hf://`) there is no internet connection.
- **Only analyzed versions are listed**: the dependents index was not found; check that
  `data/dependents-index` has `versions.parquet` and `libraries.parquet`, or use `INDEX_PATH`.
- **A port is in use**: another program uses port 3000 or 5050; stop it, or change the ports in
  `app/docker-compose.yml`.
- **No Analyze buttons**: the backend has no `GITHUB_TOKEN` (check
  http://localhost:5050/api/analyze/config, which says `"enabled": true` when it has one), or
  the version has no dependents in the index.
- **"Could not start the analysis: GitHub API 401"**: the token is wrong or has expired;
  create a new one. **"GitHub API 403" or "404"**: the token cannot reach this repository or
  lacks **Actions: Read and write**; edit the token's repository access and permissions.

More detail, including Windows commands, is in [app/QWICKSTART.md](app/QWICKSTART.md).

## Running the pipeline

See [pipeline/Readme.md](pipeline/Readme.md). One command analyzes a library version, e.g.
`python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.16`; the GitHub Actions workflow
**Analyze library** runs it for any version and publishes the results.

## Building the usage extractor

```bash
cd pipeline/JavaUsageExtractor/asm-based-analysis
./mvnw package
```
