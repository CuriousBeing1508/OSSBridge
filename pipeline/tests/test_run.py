import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import run  # noqa: E402

GA, V = "org.example:lib", "1.0"


@pytest.fixture
def steps(monkeypatch):
    """Replace every step with a stand-in that records its call."""
    calls = []

    def fake(name, result):
        def step(*args, **kwargs):
            calls.append(name)
            if isinstance(result, Exception):
                raise result
            return result(kwargs) if callable(result) else result
        return step

    outcome = {
        "candidates": {"releases": 10, "releases_non_test": 10, "projects": 4, "candidates": 4, "ranked_by_reach": 0},
        "collect": {"message": "Selected 2", "selected": 2},
        "public_api": {"apis": 5},
        "coverage": {"status": "ok", "detail": "", "repository": "o/lib", "tag": "v1.0", "build_tool": "maven",
                     "jdk": 17, "tests": {"tests": 3}, "seconds": 1},
        "api_coverage": {"apis": 4, "covered_pct": 75.0},
        "store_results": {"apis": 5},
    }

    def install(**overrides):
        outcome.update(overrides)
        monkeypatch.setattr(run.candidates, "run", fake("candidates", outcome["candidates"]))
        monkeypatch.setattr(run.collect, "run", fake("collect", outcome["collect"]))
        monkeypatch.setattr(run.public_api, "run", fake("public_api", outcome["public_api"]))
        monkeypatch.setattr(run.coverage, "run", fake("coverage", outcome["coverage"]))
        monkeypatch.setattr(run.api_coverage, "run", fake("api_coverage", outcome["api_coverage"]))
        monkeypatch.setattr(run.store_results, "run", fake("store_results", outcome["store_results"]))
        return calls

    return install


def statuses(record):
    return {name: s["status"] for name, s in record["steps"].items()}


def test_all_steps_in_order(steps, tmp_path):
    calls = steps()
    events = []
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results",
                              progress=lambda step, event, detail: events.append((step, event)))
    assert calls == ["candidates", "collect", "public_api", "coverage", "api_coverage", "store_results"]
    assert record["status"] == "ok"
    assert set(statuses(record).values()) == {"ok"}
    assert record["steps"]["coverage"]["summary"]["tag"] == "v1.0"
    assert events[0] == ("dependents", "start") and events[-1] == ("store", "ok")

    saved = json.loads((tmp_path / "org.example__lib@1.0" / "run.json").read_text())
    assert saved["status"] == "ok" and "finished_at" in saved


def test_no_dependents_skips_collection_but_runs_the_api_branch(steps, tmp_path):
    calls = steps(candidates={"releases": 0, "releases_non_test": 0, "projects": 0, "candidates": 0,
                              "ranked_by_reach": 0})
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results")
    assert statuses(record) == {"dependents": "failed", "collect": "skipped", "api": "ok", "coverage": "ok",
                                "api_coverage": "ok", "store": "ok"}
    assert "collect" not in calls
    assert "--fetch-missing" in record["steps"]["dependents"]["detail"]
    assert record["status"] == "partial"


def test_failed_coverage_skips_api_coverage(steps, tmp_path):
    steps(coverage={"status": "build_failed", "detail": "no tests ran", "tests": None})
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results")
    assert statuses(record)["coverage"] == "failed"
    assert record["steps"]["coverage"]["detail"] == "coverage build_failed: no tests ran"
    assert statuses(record)["api_coverage"] == "skipped"
    assert statuses(record)["store"] == "ok"


def test_skip_coverage_option(steps, tmp_path):
    calls = steps()
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results", skip_coverage=True)
    assert "coverage" not in calls
    assert record["steps"]["coverage"]["detail"] == "skipped with --skip-coverage"


def test_an_error_in_one_step_does_not_stop_the_other_branch(steps, tmp_path):
    steps(collect=RuntimeError("network down"))
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results")
    assert statuses(record)["collect"] == "failed"
    assert record["steps"]["collect"]["detail"] == "RuntimeError: network down"
    assert "Traceback" in record["steps"]["collect"]["traceback"]
    assert statuses(record)["api_coverage"] == "ok"


def test_failed_store_fails_the_run(steps, tmp_path):
    steps(store_results=FileNotFoundError("no library jar"))
    record = run.run_pipeline(GA, V, root=tmp_path, results_dir=tmp_path / "results")
    assert record["status"] == "failed"
