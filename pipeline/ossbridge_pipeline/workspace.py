"""Per-run working folder: data/runs/<group>__<artifact>@<version>/."""

from pathlib import Path

from .coords import safe_name

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "data" / "runs"


class Workspace:
    def __init__(self, library_ga, version, root=DEFAULT_ROOT):
        self.library_ga = library_ga
        self.version = version
        self.dir = Path(root) / safe_name(library_ga, version)

    # Step 1: dependents selected for analysis
    @property
    def dependents_csv(self):
        return self.dir / "dependents.csv"

    # Step 2: downloaded dependent jars and the outcome for each dependent
    @property
    def dependent_jars_dir(self):
        return self.dir / "dependent-jars"

    @property
    def dependent_jars_status(self):
        return self.dir / "dependent-jars.csv"
