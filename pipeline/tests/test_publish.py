import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import publish, result_tables  # noqa: E402


def write_versions(results):
    result_tables.write_table(results, "library_versions", "org.example:lib", "1.0", [{
        "library_ga": "org.example:lib", "version": "1.0", "run_id": "pipeline-x", "dependents_using": 7,
        "dependents_selected": 5, "coverage_status": "ok", "tests": 1234, "api_coverage_pct": 81.5}])
    result_tables.write_table(results, "library_versions", "org.example:old", "2.0", [{
        "library_ga": "org.example:old", "version": "2.0", "run_id": "convert-y"}])


def test_card_lists_versions_tables_and_viewer_configs(tmp_path):
    write_versions(tmp_path)
    card = publish.render_card(tmp_path, "owner/data")
    assert card.startswith("---\nlicense: cc-by-4.0\n")
    assert "- config_name: api_usage\n  data_files: results/api_usage/*.parquet" in card
    assert "config_name: runs" not in card                     # runs are not one file per version
    assert "| `org.example:lib` | 1.0 | pipeline | 7 (5) | ok | 1,234 | 81.5% |" in card
    assert "| `org.example:old` | 2.0 | converted from the original dataset |" in card
    assert "2 library versions" in card
    assert "hf://datasets/owner/data/results/library_versions/*.parquet" in card
    for table in result_tables.TABLES:
        assert f"| `{table}` |" in card


def test_publish_uploads_results_index_and_card(tmp_path, monkeypatch):
    write_versions(tmp_path / "results")
    (tmp_path / "index").mkdir()
    calls = []

    class FakeApi:
        def upload_folder(self, **kw):
            calls.append(("folder", kw["path_in_repo"], kw["repo_type"]))

        def upload_file(self, **kw):
            calls.append(("file", kw["path_in_repo"], kw["path_or_fileobj"][:3]))

    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "HfApi", FakeApi)
    monkeypatch.setattr(publish, "download", lambda *a, **k: 0)
    uploaded = publish.publish("owner/data", tmp_path / "results", tmp_path / "index")
    assert uploaded == ["results", "dependents-index", "README.md"]
    assert calls == [("folder", "results", "dataset"), ("folder", "dependents-index", "dataset"),
                     ("file", "README.md", b"---")]


def test_download_only_missing_keeps_local_files(tmp_path, monkeypatch):
    def fake_snapshot(repo_id, repo_type, local_dir, allow_patterns):
        for rel, text in {"results/apis/a.parquet": "remote-a", "results/apis/b.parquet": "remote-b",
                          "dependents-index/edges.parquet": "edges", "README.md": "card"}.items():
            path = Path(local_dir) / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)

    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot)
    data = tmp_path / "data"
    (data / "results" / "apis").mkdir(parents=True)
    (data / "results" / "apis" / "a.parquet").write_text("local-a")

    assert publish.download("o/d", data, folders=("results",), only_missing=True) == 1
    assert (data / "results" / "apis" / "a.parquet").read_text() == "local-a"     # not overwritten
    assert (data / "results" / "apis" / "b.parquet").read_text() == "remote-b"
    assert not (data / "dependents-index").exists()

    assert publish.download("o/d", data) == 3                                     # everything
    assert (data / "results" / "apis" / "a.parquet").read_text() == "remote-a"
    assert (data / "dependents-index" / "edges.parquet").read_text() == "edges"
