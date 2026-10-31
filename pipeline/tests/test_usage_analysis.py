import csv
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import usage_analysis  # noqa: E402
from ossbridge_pipeline.workspace import Workspace  # noqa: E402

FIXTURES = (Path(__file__).resolve().parents[1] / "JavaUsageExtractor" / "asm-based-analysis"
            / "src" / "test" / "resources" / "fixtures")

needs_java = pytest.mark.skipif(
    shutil.which("javac") is None or not usage_analysis.DEFAULT_ANALYZER.exists(),
    reason="needs a JDK and the built analyzer (./mvnw package)")


def compile_jar(source_root, out_jar, classpath=None):
    classes = out_jar.with_suffix("")
    classes.mkdir(parents=True)
    cmd = ["javac", "--release", "17", "-d", str(classes)]
    if classpath:
        cmd += ["-cp", str(classpath)]
    subprocess.run(cmd + [str(p) for p in source_root.rglob("*.java")], check=True)
    with zipfile.ZipFile(out_jar, "w") as jar:
        for p in sorted(classes.rglob("*.class")):
            jar.write(p, p.relative_to(classes).as_posix())
    return classes


@needs_java
def test_run_writes_usage_for_workspace(tmp_path):
    ws = Workspace("org.example:lib", "1.0", root=tmp_path / "runs")
    ws.dependent_jars_dir.mkdir(parents=True)
    lib_classes = compile_jar(FIXTURES / "library", ws.library_jar)
    compile_jar(FIXTURES / "dependent", ws.dependent_jars_dir / "com_acme-app-1.0.jar", lib_classes)

    calls = []
    summary = usage_analysis.run(ws, progress=lambda done, total, name: calls.append((done, total, name)))

    assert summary["jars"] == 1 and summary["analyzed"] == 1 and summary["errors"] == 0
    assert calls == [(1, 1, "com_acme-app-1.0.jar")]
    with open(ws.usage_csv, newline="") as f:
        rows = list(csv.DictReader(f))
    assert summary["usage_rows"] == len(rows)
    hello = [r for r in rows if r["target_member"] == "hello" and r["target_class"] == "org.example.lib.Codec"]
    assert hello[0]["declaring_class"] == "org.example.lib.Base"
    assert hello[0]["resolution"] == "inherited"


def test_missing_analyzer_is_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("OSSBRIDGE_USAGE_ANALYZER", str(tmp_path / "missing.jar"))
    with pytest.raises(FileNotFoundError, match="mvnw package"):
        usage_analysis.analyzer_jar()
