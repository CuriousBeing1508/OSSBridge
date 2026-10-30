# OSSBridge

OSSBridge helps Java library maintainers see how their public APIs are used by dependent projects and how well those APIs are tested.

## Repository layout

```
OSSBridge/
├── app/        Web application (React frontend + Node backend, Docker Compose)
├── pipeline/   Offline data collection pipeline
│   ├── DependentCollector/     Find dependents of a library version (Neo4j / Goblin dataset)
│   ├── AutomatedJarDownload/   Download jars, extract APIs, test coverage, matching
│   ├── JavaUsageExtractor/     ASM bytecode analyzer (Maven project)
│   └── DependentsIndex/        Dependents index (Parquet) and impact-based dependent selection
└── data/       Data produced by the pipeline (git-ignored)
    ├── dataset/            The dataset the app reads (processed_csvs, LibraryJars, TestCoverage, ...)
    └── dependents-index/   Parquet index of who depends on which library version
```

The **dataset** is a folder of files produced by the pipeline, not a database. The backend
reads it directly. Put it at `data/dataset` (copy, or a symlink to where it is stored), or
point `DATASET_PATH` in `app/.env` somewhere else.

## Running the app

1. Copy `app/.env.example` to `app/.env` (the default `DATASET_PATH=../data/dataset` works if the dataset is in `data/dataset`).
2. Start it:
   ```bash
   cd app
   docker compose up --build
   ```
3. Open http://localhost:3000. The backend API is on http://localhost:5050.

## Running the pipeline

See [pipeline/Readme.md](pipeline/Readme.md). The pipeline is being refactored so that a single command can process any Maven library.

## Building the usage extractor

```bash
cd pipeline/JavaUsageExtractor/asm-based-analysis
./mvnw package
```
