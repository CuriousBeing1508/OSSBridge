import re
import requests
import xml.etree.ElementTree as ET

def gav_to_pom_url(group_id, artifact_id, version):
    base_url = "https://repo1.maven.org/maven2"
    group_path = group_id.replace('.', '/')
    return f"{base_url}/{group_path}/{artifact_id}/{version}/{artifact_id}-{version}.pom"

def get_namespace(element):
    """
    Extract the namespace string from an ElementTree element if it exists.
    For example, if element.tag is '{http://maven.apache.org/POM/4.0.0}project',
    this returns 'http://maven.apache.org/POM/4.0.0'.
    """
    m = re.match(r"\{(.*)\}", element.tag)
    return m.group(1) if m else ""

def get_scm_info_from_pom(pom_url):
    try:
        resp = requests.get(pom_url, timeout=10)
        resp.raise_for_status()
    except requests.RequestException:
        return None

    root = ET.fromstring(resp.text)

    # If there's a default namespace, it appears as {namespace} in root.tag
    ns = get_namespace(root)
    nsmap = {"pom": ns} if ns else {}

    # Try to find <scm> in a namespace-aware way:
    scm = root.find("pom:scm", nsmap)
    if scm is None:
        return None

    connection = scm.find("pom:connection", nsmap)
    dev_connection = scm.find("pom:developerConnection", nsmap)
    url = scm.find("pom:url", nsmap)
    tag = scm.find("pom:tag", nsmap)

    return {
        "connection": connection.text.strip() if connection is not None else None,
        "developerConnection": dev_connection.text.strip() if dev_connection is not None else None,
        "url": url.text.strip() if url is not None else None,
        "tag": tag.text.strip() if tag is not None else None
    }

if __name__ == "__main__":
    gav_list = [
        "com.squareup.okhttp3:okhttp:4.10.0",
        "org.apache.commons:commons-lang3:3.17.0",
        "org.springframework:spring-core:5.3.20"
    ]

    for gav in gav_list:
        g, a, v = gav.split(":")
        pom_url = gav_to_pom_url(g, a, v)
        print("Fetching:", pom_url)
        scm_info = get_scm_info_from_pom(pom_url)
        print(f"{gav} => {scm_info or 'No SCM info found'}\n")
