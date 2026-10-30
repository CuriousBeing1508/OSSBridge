"""
Schema of the OSSBridge result tables.

The results folder holds Parquet files, one file per table per library
version, queried with DuckDB:

    <results>/<table>/<group>__<artifact>@<version>.parquet

Every table starts with (library_ga, version). An API is identified by
api_id = "<package>.<Class>.<member><descriptor>", with constructors named
<init> (the JVM / JaCoCo convention), e.g.
    org.apache.commons.codec.binary.Hex.<init>(Ljava/nio/charset/Charset;)V
"""

import pyarrow as pa

TABLES = {
    # One row per library version in the results
    "library_versions": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("packages", pa.list_(pa.string())),    # packages in the library jar
        ("run_id", pa.string()),
    ]),
    # Public API of the library jar
    "apis": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("api_id", pa.string()),
        ("package", pa.string()),
        ("class_name", pa.string()),
        ("member", pa.string()),                # method name or <init>
        ("descriptor", pa.string()),
        ("kind", pa.string()),                  # method | constructor
    ]),
    # Projects that depend on the library version (one row per dependent release)
    "dependents": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("dependent_ga", pa.string()),
        ("dependent_version", pa.string()),
        ("release_ts", pa.int64()),             # epoch millis
        ("tier", pa.string()),                  # A | B | null (not sampled)
        ("reach", pa.int64()),
        ("analyzed", pa.bool_()),               # usage analysis ran on its jar
        ("bytecode_instructions", pa.int64()),
    ]),
    # Uses of the library by a dependent release, aggregated per target and category
    "api_usage": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("dependent_ga", pa.string()),
        ("dependent_version", pa.string()),
        ("category", pa.string()),              # METHOD_CALL, FIELD_ACCESS, TYPE_REFERENCE, ...
        ("target_class", pa.string()),
        ("target_member", pa.string()),         # method/field name, <extends>/<implements>, or null
        ("target_descriptor", pa.string()),
        ("api_id", pa.string()),                # set for METHOD_CALL (joins with apis)
        ("occurrences", pa.int64()),
        ("caller_classes", pa.int64()),
    ]),
    # JaCoCo method coverage of the library's own test suite
    "api_coverage": pa.schema([
        ("library_ga", pa.string()),
        ("version", pa.string()),
        ("api_id", pa.string()),
        ("instruction_missed", pa.int64()),
        ("instruction_covered", pa.int64()),
        ("branch_missed", pa.int64()),
        ("branch_covered", pa.int64()),
        ("line_missed", pa.int64()),
        ("line_covered", pa.int64()),
        ("complexity_missed", pa.int64()),
        ("complexity_covered", pa.int64()),
    ]),
    # Provenance: one row per pipeline or conversion run
    "runs": pa.schema([
        ("run_id", pa.string()),
        ("kind", pa.string()),
        ("started_at", pa.string()),
        ("params", pa.string()),                # JSON
    ]),
}


def file_name(library_ga, version):
    return f"{library_ga.replace(':', '__')}@{version}.parquet"
