"""Maven coordinates, URLs and file names shared by the pipeline steps."""

MAVEN_CENTRAL = "https://repo1.maven.org/maven2"


def parse_release(release_id):
    """'group:artifact:version' -> (group, artifact, version)."""
    parts = release_id.strip().split(":")
    if len(parts) != 3 or not all(parts):
        raise ValueError(f"Not a group:artifact:version coordinate: {release_id!r}")
    return tuple(parts)


def jar_url(group, artifact, version, base_url=MAVEN_CENTRAL):
    return f"{base_url.rstrip('/')}/{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.jar"


def jar_file_name(group, artifact, version):
    """Local jar name; the usage analyzer's output files are named after it."""
    return f"{group.replace('.', '_')}-{artifact}-{version}.jar"


def safe_name(library_ga, version):
    """Folder/file name for a library version, e.g. commons-codec__commons-codec@1.17.1."""
    return f"{library_ga.replace(':', '__')}@{version}"
