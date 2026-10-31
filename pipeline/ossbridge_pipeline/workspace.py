"""Per-run working folder: data/runs/<group>__<artifact>@<version>/."""

from pathlib import Path

from .coords import jar_file_name, safe_name
from .paths import RUNS_DIR

DEFAULT_ROOT = RUNS_DIR


class Workspace:
    def __init__(self, library_ga, version, root=DEFAULT_ROOT):
        self.library_ga = library_ga
        self.version = version
        self.dir = Path(root) / safe_name(library_ga, version)

    # Status of a whole-pipeline run (run.py)
    @property
    def run_json(self):
        return self.dir / "run.json"

    @property
    def lock_file(self):
        return self.dir / "run.lock"

    # Step 1: every dependent project, ranked (candidates.py)
    @property
    def candidates_csv(self):
        return self.dir / "candidates.csv"

    # Dependents to download: written by the collection loop (collect.py) for the
    # dependents it tried, with whether each uses the library and was selected
    @property
    def dependents_csv(self):
        return self.dir / "dependents.csv"

    @property
    def collection_json(self):
        return self.dir / "collection.json"

    @property
    def batches_dir(self):
        return self.dir / "batches"

    # Step 2: downloaded dependent jars and the outcome for each dependent
    @property
    def dependent_jars_dir(self):
        return self.dir / "dependent-jars"

    @property
    def dependent_jars_status(self):
        return self.dir / "dependent-jars.csv"

    # The library's own jar (used by steps 3 and 4)
    @property
    def library_jar(self):
        group, artifact = self.library_ga.split(":", 1)
        return self.dir / jar_file_name(group, artifact, self.version)

    # Step 3: library usage in the dependent jars
    @property
    def usage_csv(self):
        return self.dir / "usage.csv"

    @property
    def usage_summary_csv(self):
        return self.dir / "usage-summary.csv"

    # Step 4: API of the library jar
    @property
    def apis_csv(self):
        return self.dir / "apis.csv"

    @property
    def api_overrides_csv(self):
        return self.dir / "api-overrides.csv"

    # Step 5: test coverage of the library's own test suite
    @property
    def coverage_dir(self):
        return self.dir / "coverage"

    @property
    def coverage_xml(self):
        return self.dir / "coverage.xml"

    @property
    def coverage_json(self):
        return self.dir / "coverage.json"

    # Step 6: coverage of each API
    @property
    def api_coverage_csv(self):
        return self.dir / "api-coverage.csv"
