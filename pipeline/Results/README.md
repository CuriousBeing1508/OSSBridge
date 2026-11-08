# Results

The analysis results of OSSBridge, stored as tables: one Parquet file per table per
library version, queried with DuckDB. The pipeline writes them in step 7
(`python -m ossbridge_pipeline.store_results`). Raw artifacts such as jars and sources are
not stored.

```
data/results/
  library_versions/  apis/  dependents/  api_usage/  api_coverage/
      <group>__<artifact>@<version>.parquet
  runs/<run_id>.parquet
```

## Tables

| Table | One row per | Main columns |
|---|---|---|
| `library_versions` | library version | `packages`, `dependent_projects`, `dependents_tried`, `dependents_using`, `dependents_selected`, `target_reached`, `coverage_status`, `tests`, `api_coverage_pct`, `run_id` |
| `apis` | class member a dependent can use | `api_id`, `kind` (method, constructor, field), `visibility`, `static`, `abstract`, `class_kind`, `deprecated`, `deprecated_for_removal`, `class_deprecated`, `exported` |
| `dependents` | dependent release that was tried | `dependent_ga`, `dependent_version`, `release_ts`, `tier`, `rank`, `reach`, `download_status`, `uses_library`, `selected`, `bytecode_instructions` |
| `api_usage` | (dependent release, target, category) | `category`, `target_class`, `target_member`, `declaring_class`, `resolution`, `api_id`, `occurrences`, `caller_classes` |
| `api_coverage` | API method or constructor | `status` (covered, covered_by_override, not_covered, no_code, generated, not_reported), `overrides`, `overrides_covered`, `instruction_*`, `branch_*`, `line_*`, `complexity_*` |
| `runs` | pipeline run | `run_id`, `kind`, `started_at`, `params` (JSON: the run's collection and coverage summaries) |

All tables start with `library_ga, version`. `api_id` is
`<package>.<Class>.<member><descriptor>` for methods and constructors (`<init>`) and
`<package>.<Class>.<field>:<descriptor>` for fields; in `api_usage` it is the API of the
declaring class, so usage joins with `apis` and `api_coverage`. Writing a library
version replaces all of its earlier tables. Columns a run does not provide are null.
Full definitions:
[ossbridge_pipeline/result_tables.py](../ossbridge_pipeline/result_tables.py).

## Query

```python
import sys; sys.path.insert(0, "..")      # the pipeline folder
from ossbridge_pipeline.result_tables import connect
con = connect("../../data/results")
con.sql("""
    SELECT u.api_id, count(DISTINCT u.dependent_ga) AS dependents, c.status, a.deprecated
    FROM api_usage u
    JOIN apis a USING (library_ga, version, api_id)
    LEFT JOIN api_coverage c USING (library_ga, version, api_id)
    WHERE u.library_ga = 'commons-codec:commons-codec' AND u.version = '1.17.1'
    GROUP BY ALL ORDER BY dependents DESC LIMIT 10
""").show()
```

## Tests

```bash
../../.venv/bin/python -m pytest ../tests/test_store_results.py
```
