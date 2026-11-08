# OSSBridge

OSSBridge helps Java library maintainers see how their public APIs are used by dependent projects and how well those APIs are tested.

- **Try it online:** https://rachna1508-ossbridge.hf.space
- **Data:** the results and the dependents index are published in the Hugging Face dataset
  [rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results).

## Repository layout

```
OSSBridge/
├── app/        Web application (React frontend + Node backend, Docker Compose)
├── pipeline/   Data collection pipeline (one command per library version)
│   ├── ossbridge_pipeline/     The pipeline steps, result tables and publishing
│   ├── DependentsIndex/        Dependents index (Parquet) and impact-based dependent selection
│   ├── JavaUsageExtractor/     ASM bytecode analyzer (Maven project)
│   ├── Results/                Documentation of the result tables
│   └── goblin-neo4j/           Neo4j with the Goblin Maven Central graph (to rebuild the index)
└── data/       Data produced by the pipeline (git-ignored)
    ├── results/            Result tables (Parquet) the app reads
    └── dependents-index/   Parquet index of who depends on which library version
```

## Run the app on your computer

You need [Docker Desktop](https://www.docker.com/products/docker-desktop), running.

Create your settings file from the example, then update `app/.env` with valid input. 

```bash
cd app
cp .env.example .env
```

Start the app:

```bash
docker compose up -d --build
```

Open http://localhost:3000. The first start takes a few minutes, and loading the data
takes up to a minute more. Run `docker compose logs -f backend` and wait for
`OSSBridge backend running on http://localhost:5050`.

The app reads the published dataset from Hugging Face by default, so you need no download.

### Use a local copy of the data

To run the app without reading Hugging Face each time it starts, download the data once
into `data/`. From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
cd pipeline
../.venv/bin/python -m ossbridge_pipeline.publish --download --app-only
```

This writes about 30 MB to `data/results/` and `data/dependents-index/`. If you download
the files by hand from the dataset page instead, keep the same folder layout, for example
`data/results/apis/<file>.parquet`.

Then in `app/.env`, comment out `RESULTS_PATH` and `INDEX_PATH`, and uncomment
`RESULTS_DIR` and `INDEX_DIR`. Start the app again with `docker compose up -d` in `app/`.

New results reach the local copy in two ways:
- **The Analyze button.** The app downloads the new results into `data/results/` by itself.
- **Running the pipeline yourself.** It writes into `data/results/`. Run
  `docker compose restart backend` in `app/` to load them.

To stop the app, run `docker compose down` in `app/`. After changing the code, start it
again with `--build`.

### The Analyze button

Versions that are not analyzed yet get an **Analyze** button when the backend has a GitHub
token. Pressing it starts a real run of the **Analyze library** workflow on GitHub Actions,
which publishes its results to the dataset.

1. Create a fine-grained token at https://github.com/settings/personal-access-tokens/new.
   Give it access to this repository only, with the permission **Actions** set to
   **Read and write**. Copy it at once, because GitHub shows it only once.
2. Put it in `app/.env` as `GITHUB_TOKEN=<the token>`. Git ignores this file.
3. Run `docker compose up -d` in `app/`.

On the Hugging Face Space, add the token as a secret named `GITHUB_TOKEN` under
**Settings**, **Variables and secrets**. Do not use a variable, because variables are public.

At most 3 analyses run at once, and at most 5 can start per hour.

### Troubleshooting

| Problem | What to check |
|---|---|
| The backend stops with "Could not load the result tables" | The data paths in `app/.env`, or your internet connection |
| Only analyzed versions are listed | The dependents index setting (`INDEX_PATH` or `INDEX_DIR`) in `app/.env` |
| A port is in use | Another program uses port 3000 or 5050. Stop it, or change the ports in `app/docker-compose.yml` |
| No Analyze buttons | http://localhost:5050/api/analyze/config should say `"enabled": true`. If not, the token is missing |
| "GitHub API 401" | The token is wrong or has expired. Create a new one |
| "GitHub API 403" or "404" | The token cannot reach this repository, or lacks **Actions: Read and write** |
| The page looks out of date | Reload it with Cmd+Shift+R (Ctrl+Shift+R on Windows and Linux) |

## Run the pipeline

Analyze one library version with:

```bash
python -m ossbridge_pipeline.run org.mybatis:mybatis:3.5.16
```

The **Analyze library** workflow on GitHub Actions runs the same command for any version.
See [pipeline/Readme.md](pipeline/Readme.md) for setup, options and the result tables.

To build the bytecode analyzer:

```bash
cd pipeline/JavaUsageExtractor/asm-based-analysis
./mvnw package
```
