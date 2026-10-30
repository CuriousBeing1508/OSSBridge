# Results

The analysis results of OSSBridge, stored as tables: one Parquet file per table per
library version, queried with DuckDB. The result tables replace the loose CSV folders of
the dataset for everything the app queries. Raw artifacts (jars, sources, JaCoCo HTML)
stay as files.

```
data/results/
  library_versions/  apis/  dependents/  api_usage/  api_coverage/  runs/
      <group>__<artifact>@<version>.parquet
  _reports/<run_id>.json      data-quality report of each conversion
```

## Tables

| Table | One row per | Key columns |
|---|---|---|
| `library_versions` | library version | `library_ga, version, packages, run_id` |
| `apis` | public method/constructor of the library jar | `api_id, package, class_name, member, descriptor, kind` |
| `dependents` | dependent release | `dependent_ga, dependent_version, release_ts, tier, reach, analyzed` |
| `api_usage` | (dependent release, target, category) | `category, target_class, target_member, api_id, occurrences, caller_classes` |
| `api_coverage` | method in the JaCoCo report | `api_id, line_covered, line_missed, instruction_*, branch_*` |
| `runs` | pipeline/conversion run | `run_id, kind, started_at, params` |

All tables start with `library_ga, version`. `api_id` is
`<package>.<Class>.<member><descriptor>`, with constructors named `<init>`. Full
definitions are in [schema.py](schema.py).

## Convert the existing dataset

```bash
../../.venv/bin/python convert_dataset.py --dataset ../../data/dataset --results ../../data/results
```

The dataset is only read. Fixes applied during conversion:
- **Usage only counts the library itself:** a use is kept only if its class is in a package
  of the library jar. This drops calls to other libraries (93% of the commons-codec 1.17.1
  rows were other Apache Commons libraries) and to shaded copies (e.g.
  `org.apache.juli.logging.com.fasterxml.jackson.databind`).
- **Constructors are `<init>` everywhere,** so they match their coverage
  (commons-codec 1.17.1: 568 → 700 of 728 APIs matched to coverage).

## Query

```python
from result_tables import connect
con = connect("../../data/results")
con.sql("""
    SELECT a.api_id, count(DISTINCT u.dependent_ga) AS dependents, c.line_covered, c.line_missed
    FROM apis a
    JOIN api_usage u USING (library_ga, version, api_id)
    LEFT JOIN api_coverage c USING (library_ga, version, api_id)
    WHERE a.library_ga = 'commons-codec:commons-codec' AND a.version = '1.17.1'
    GROUP BY ALL ORDER BY dependents DESC LIMIT 10
""").show()
```

## Known gap

About a third of method calls do not match an `apis` row: protected members are missing
from the API list (it was extracted with `javap -public`), and calls through a subclass
(e.g. `ObjectNode.has` declared in `JsonNode`) are recorded on the subclass. Resolving
them needs the library's class hierarchy.

## Tests

```bash
../../.venv/bin/python -m pytest tests
```
