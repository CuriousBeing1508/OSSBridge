import json
import sys
import zipfile
from pathlib import Path

import duckdb
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import convert_dataset  # noqa: E402
from result_tables import connect  # noqa: E402

GA = "org.example:lib"
V = "1.0"
KEY = "lib-1.0"
PKG = "org.example.lib"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


@pytest.fixture
def dataset(tmp_path):
    root = tmp_path / "dataset"
    write(root / "processed_csvs" / f"{GA}-{V}.csv",
          "release_id,dependency,artifact_id,depGroupId,depArtifactId,Depversion\n"
          f"com.acme:app:2.0,\"({{'id': 'com.acme:app:2.0', 'version': '2.0', 'timestamp': 1700000000000}}, "
          f"'dependency', {{'found': True, 'id': '{GA}'}})\",{GA},com.acme,app,2.0\n"
          f"org.other:tool:1.1,\"({{'timestamp': 1600000000000}})\",{GA},org.other,tool,1.1\n")

    jar = root / "LibraryJars" / f"{KEY}.jar"
    jar.parent.mkdir(parents=True)
    with zipfile.ZipFile(jar, "w") as z:
        z.writestr("org/example/lib/Codec.class", b"")
        z.writestr("org/example/lib/internal/Util.class", b"")
        z.writestr("META-INF/versions/9/org/example/lib/mr/X.class", b"")

    write(root / "LibraryJars" / f"{KEY}_available_apis.csv",
          "Package,Class,Method,MethodDescriptor,FullSignature,SimpleSignature\n"
          f'{PKG},Codec,encode,"([B)[B",x,x\n'
          f'{PKG},Codec,{PKG}.Codec,"()V",x,x\n'
          f'{PKG},Codec,{PKG}.Codec,"()V",x,x\n')

    write(root / "TestCoverage" / f"{KEY}_method_coverage.csv",
          "Package,Class,Method,MethodDescriptor,FullSignature,SimpleSignature,INSTRUCTION_MISSED,"
          "INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED,"
          "COMPLEXITY_MISSED,COMPLEXITY_COVERED\n"
          f"{PKG},Codec,<init>,()V,x,x,0,3,0,0,0,1,0,1\n"
          f"{PKG},Codec,encode,([B)[B,x,x,2,8,1,1,1,4,1,1\n")

    analysis = root / "StaticAnaResults" / KEY
    write(analysis / "analysis_summary.csv",
          "JarFile,BasePackage,TotalInstructions,UniqueThirdPartyUsages\n"
          "com_acme-app-2.0.jar,-,1234,5\n")
    write(analysis / "Dependents" / f"com_acme-app-2.0{convert_dataset.USAGE_SUFFIX}",
          "JarFile,CallerClass,Usage,Category\n"
          f"a.jar,com.acme.A,{PKG}.Codec.encode : ([B)[B,METHOD_CALL\n"
          f"a.jar,com.acme.B,{PKG}.Codec.encode : ([B)[B,METHOD_CALL\n"
          f"a.jar,com.acme.B,{PKG}.Codec.encode : ([B)[B,METHOD_CALL\n"
          f"a.jar,com.acme.A,{PKG}.Codec.<init> : ()V,METHOD_CALL\n"
          f"a.jar,com.acme.A,{PKG}.internal.Util.MAX : I,FIELD_ACCESS\n"
          f"a.jar,com.acme.A,{PKG}.Codec<extends>,CLASS_USAGE\n"
          f"a.jar,com.acme.A,{PKG}.Codec codec,FINAL_FIELD\n"
          f"a.jar,com.acme.A,{PKG}.Codec,TYPE_REFERENCE\n"
          "a.jar,com.acme.A,org.example.other.Thing.run : ()V,METHOD_CALL\n"
          f"a.jar,com.acme.A,com.acme.shaded.{PKG}.Codec.encode : ([B)[B,METHOD_CALL\n")
    write(analysis / "Dependents" / f"unknown-jar-1.0{convert_dataset.USAGE_SUFFIX}",
          "JarFile,CallerClass,Usage,Category\n"
          f"b.jar,x.Y,{PKG}.Codec.encode : ([B)[B,METHOD_CALL\n")
    return root


@pytest.fixture
def converted(dataset, tmp_path):
    results_dir = tmp_path / "results"
    [(ga, v, key)] = list(convert_dataset.discover(dataset))
    con = duckdb.connect()
    report = convert_dataset.convert_one(con, dataset, results_dir, ga, v, key, "run-1")
    con.close()
    return connect(results_dir), report


def rows(con, sql):
    return con.execute(sql).fetchall()


def test_discover_reads_library_and_version(dataset):
    assert list(convert_dataset.discover(dataset)) == [(GA, V, KEY)]


def test_apis_name_constructors_init_and_dedupe(converted):
    con, report = converted
    assert sorted(rows(con, "SELECT api_id, kind FROM apis")) == [
        (f"{PKG}.Codec.<init>()V", "constructor"),
        (f"{PKG}.Codec.encode([B)[B", "method"),
    ]
    assert report["constructors_with_coverage"] == 1
    assert report["apis_with_coverage"] == 2


def test_packages_come_from_jar_without_multi_release_copies(converted):
    con, report = converted
    assert rows(con, "SELECT packages FROM library_versions") == [([PKG, f"{PKG}.internal"],)]
    assert report["packages_from"] == "jar"


def test_dependents_have_timestamp_and_analysis_flags(converted):
    con, _ = converted
    assert sorted(rows(con, """
        SELECT dependent_ga, dependent_version, release_ts, analyzed, bytecode_instructions FROM dependents
    """)) == [
        ("com.acme:app", "2.0", 1700000000000, True, 1234),
        ("org.other:tool", "1.1", 1600000000000, False, None),
    ]


def test_usage_keeps_only_library_packages_and_aggregates(converted):
    con, report = converted
    usage = {(r[0], r[1], r[2]): r[3:] for r in rows(con, """
        SELECT category, target_class, target_member, target_descriptor, api_id, occurrences, caller_classes
        FROM api_usage
    """)}
    assert usage[("METHOD_CALL", f"{PKG}.Codec", "encode")] == ("([B)[B", f"{PKG}.Codec.encode([B)[B", 3, 2)
    assert usage[("METHOD_CALL", f"{PKG}.Codec", "<init>")][1] == f"{PKG}.Codec.<init>()V"
    assert usage[("FIELD_ACCESS", f"{PKG}.internal.Util", "MAX")] == ("I", None, 1, 1)
    assert ("CLASS_USAGE", f"{PKG}.Codec", "<extends>") in usage
    assert ("FINAL_FIELD", f"{PKG}.Codec", None) in usage
    assert ("TYPE_REFERENCE", f"{PKG}.Codec", None) in usage
    # Other libraries, shaded copies and jars not in the dependents list are dropped
    assert not any("other" in k[1] or "shaded" in k[1] for k in usage)
    assert rows(con, "SELECT DISTINCT dependent_ga FROM api_usage") == [("com.acme:app",)]
    assert report["usage_rows"] == 11
    assert report["usage_rows_in_library"] == 9
    assert report["usage_jars_unmatched"] == 1
    assert report["method_calls_matching_apis"] == 2


def test_main_writes_run_and_report(dataset, tmp_path, monkeypatch):
    results_dir = tmp_path / "res"
    monkeypatch.setattr(sys, "argv", ["convert_dataset.py", "--dataset", str(dataset),
                                      "--results", str(results_dir)])
    convert_dataset.main()
    con = connect(results_dir)
    assert rows(con, "SELECT kind FROM runs") == [("convert_dataset",)]
    [report_file] = (results_dir / "_reports").glob("*.json")
    assert json.loads(report_file.read_text())[0]["library"] == GA
    assert not list(results_dir.rglob("*.tmp"))


def test_connect_on_empty_results_has_all_views(tmp_path):
    con = connect(tmp_path / "empty")
    assert rows(con, "SELECT count(*) FROM api_usage") == [(0,)]
    assert rows(con, "SELECT count(*) FROM dependents") == [(0,)]
