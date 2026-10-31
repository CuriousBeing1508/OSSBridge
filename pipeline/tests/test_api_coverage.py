import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ossbridge_pipeline import api_coverage  # noqa: E402
from ossbridge_pipeline.public_api import API_COLUMNS  # noqa: E402

P = "org.example.lib."

REPORT = """<?xml version="1.0"?>
<report name="lib">
  <package name="org/example/lib">
    <class name="org/example/lib/Codec">
      <method name="&lt;init&gt;" desc="()V"><counter type="INSTRUCTION" missed="0" covered="3"/><counter type="LINE" missed="0" covered="1"/></method>
      <method name="encode" desc="([B)[B"><counter type="INSTRUCTION" missed="5" covered="0"/><counter type="BRANCH" missed="2" covered="0"/></method>
    </class>
    <class name="org/example/lib/Node">
      <method name="get" desc="(Ljava/lang/String;)Lorg/example/lib/Node;"><counter type="INSTRUCTION" missed="2" covered="0"/></method>
    </class>
    <class name="org/example/lib/ObjectNode">
      <method name="get" desc="(Ljava/lang/String;)Lorg/example/lib/Node;"><counter type="INSTRUCTION" missed="0" covered="4"/></method>
    </class>
    <class name="org/example/lib/Outer$Nested">
      <method name="run" desc="()V"><counter type="INSTRUCTION" missed="0" covered="1"/></method>
    </class>
  </package>
</report>
"""

APIS = [
    # api_id suffix, kind, abstract, class_kind, member, static
    ("Codec.<init>()V", "constructor", "false", "class", "<init>", "false"),
    ("Codec.encode([B)[B", "method", "false", "class", "encode", "false"),
    ("Node.get(Ljava/lang/String;)Lorg/example/lib/Node;", "method", "false", "class", "get", "false"),
    ("Encoder.encode([B)[B", "method", "true", "interface", "encode", "false"),
    ("Handler.handle(Ljava/lang/Object;)V", "method", "true", "interface", "handle", "false"),
    ("Mode.values()[Lorg/example/lib/Mode;", "method", "false", "enum", "values", "true"),
    ("Outer$Nested.run()V", "method", "false", "class", "run", "false"),
    ("Gone.run()V", "method", "false", "class", "run", "false"),
    ("Codec.DEFAULT:Ljava/lang/String;", "field", "false", "class", "DEFAULT", "true"),
]
OVERRIDES = [
    ("Node.get(Ljava/lang/String;)Lorg/example/lib/Node;", "ObjectNode.get(Ljava/lang/String;)Lorg/example/lib/Node;"),
    ("Encoder.encode([B)[B", "Codec.encode([B)[B"),      # implementation exists but is not covered
]


def write_inputs(tmp_path, with_overrides=True):
    (tmp_path / "coverage.xml").write_text(REPORT)
    with open(tmp_path / "apis.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=API_COLUMNS)
        writer.writeheader()
        for api_id, kind, abstract, class_kind, member, static in APIS:
            writer.writerow({c: "" for c in API_COLUMNS} | {
                "api_id": P + api_id, "kind": kind, "abstract": abstract, "class_kind": class_kind,
                "member": member, "static": static, "visibility": "public", "deprecated": "false"})
    if with_overrides:
        with open(tmp_path / "api-overrides.csv", "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["api_id", "override_id"])
            writer.writerows((P + a, P + o) for a, o in OVERRIDES)


def run(tmp_path, with_overrides=True):
    write_inputs(tmp_path, with_overrides)
    summary = api_coverage.match(tmp_path / "apis.csv", tmp_path / "coverage.xml", tmp_path / "api-coverage.csv",
                                 tmp_path / "api-overrides.csv")
    with open(tmp_path / "api-coverage.csv", newline="") as f:
        rows = {r["api_id"][len(P):]: r for r in csv.DictReader(f)}
    return summary, rows


def test_statuses(tmp_path):
    summary, rows = run(tmp_path)
    status = {k: r["status"] for k, r in rows.items()}
    assert status == {
        "Codec.<init>()V": "covered",
        "Codec.encode([B)[B": "not_covered",
        "Node.get(Ljava/lang/String;)Lorg/example/lib/Node;": "covered_by_override",
        "Encoder.encode([B)[B": "no_code",                 # its implementation is not covered
        "Handler.handle(Ljava/lang/Object;)V": "no_code",
        "Mode.values()[Lorg/example/lib/Mode;": "generated",
        "Outer$Nested.run()V": "covered",                  # nested class names match JaCoCo's
        "Gone.run()V": "not_reported",
    }
    assert summary["apis"] == 8                           # fields are left out
    assert summary["covered_pct"] == round(100 * 3 / 4, 1)


def test_counters_and_override_counts(tmp_path):
    _, rows = run(tmp_path)
    encode = rows["Codec.encode([B)[B"]
    assert (encode["instruction_missed"], encode["branch_missed"], encode["line_covered"]) == ("5", "2", "0")
    node_get = rows["Node.get(Ljava/lang/String;)Lorg/example/lib/Node;"]
    assert (node_get["overrides"], node_get["overrides_covered"]) == ("1", "1")
    assert rows["Gone.run()V"]["instruction_missed"] == ""


def test_without_overrides_file(tmp_path):
    _, rows = run(tmp_path, with_overrides=False)
    assert rows["Node.get(Ljava/lang/String;)Lorg/example/lib/Node;"]["status"] == "not_covered"
