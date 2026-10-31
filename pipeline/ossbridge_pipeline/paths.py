"""Data folders of the pipeline.

All of them are under one folder: OSSBRIDGE_DATA if set (e.g. a volume mounted in the
pipeline container), otherwise the repository's data/ folder.
"""

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("OSSBRIDGE_DATA") or Path(__file__).resolve().parents[2] / "data")

RUNS_DIR = DATA_DIR / "runs"                     # one working folder per library version
RESULTS_DIR = DATA_DIR / "results"               # result tables (step 7)
INDEX_DIR = DATA_DIR / "dependents-index"        # dependents index (step 1)
TOOLS_DIR = Path(os.environ.get("OSSBRIDGE_TOOLS") or DATA_DIR / "tools")   # JaCoCo jars (step 5)
