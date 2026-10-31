import csv
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import public_api, usage_analysis  # noqa: E402
from ossbridge_pipeline.workspace import Workspace  # noqa: E402
from test_usage_analysis import FIXTURES, compile_jar  # noqa: E402


@pytest.mark.skipif(shutil.which("javac") is None or not usage_analysis.DEFAULT_ANALYZER.exists(),
                    reason="needs a JDK and the built analyzer (./mvnw package)")
def test_run_writes_apis_for_workspace(tmp_path):
    ws = Workspace("org.example:lib", "1.0", root=tmp_path / "runs")
    ws.dir.mkdir(parents=True)
    compile_jar(FIXTURES / "library", ws.library_jar)

    summary = public_api.run(ws)

    with open(ws.apis_csv, newline="") as f:
        rows = {r["api_id"]: r for r in csv.DictReader(f)}
    assert list(next(iter(rows.values()))) == public_api.API_COLUMNS
    assert summary["apis"] == len(rows)
    assert rows["org.example.lib.Codec.<init>(I)V"]["visibility"] == "protected"
    assert rows["org.example.lib.Codec.legacyEncode([B)[B"]["deprecated"] == "true"
    assert summary["deprecated"] >= 2
    # Codec(int) and the implicit constructor of the protected nested class Outer.ProtectedNested
    assert summary["protected_constructor"] == 2
