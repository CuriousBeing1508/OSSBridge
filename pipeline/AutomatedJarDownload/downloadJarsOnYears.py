import os
import requests
from bs4 import BeautifulSoup
import time
import random
# This script downlods all version jars for a library..
# ==== Configuration ====
GROUP_ID = "org.apache.dubbo"
ARTIFACT_ID = "dubbo"
BASE_REPO_URL = "https://repo1.maven.org/maven2"
DOWNLOAD_DIR = "jars"

def polite_delay():
    """Random delay between requests to avoid being blocked"""
    time.sleep(random.uniform(2, 4))   # Increased delay for safety

def get_all_versions(group_id, artifact_id):
    """Fetch all available versions by scraping Maven Central"""
    group_path = group_id.replace('.', '/')
    url = f"{BASE_REPO_URL}/{group_path}/{artifact_id}/"

    print(f"[INFO] Accessing {url}")
    response = requests.get(url)
    polite_delay()

    if response.status_code != 200:
        print(f"[ERROR] Failed to access {url}")
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    versions = []
    for link in soup.find_all('a'):
        href = link.get('href')
        if href and href.endswith('/'):
            version = href.strip('/')
            if version[0].isdigit():
                versions.append(version)
    return versions

def download_jar(group_id, artifact_id, version):
    """Download the main jar for the specified version"""
    group_path = group_id.replace('.', '/')
    jar_name = f"{artifact_id}-{version}.jar"
    jar_url = f"{BASE_REPO_URL}/{group_path}/{artifact_id}/{version}/{jar_name}"

    output_dir = os.path.join(DOWNLOAD_DIR, f"{artifact_id}")
    os.makedirs(output_dir, exist_ok=True)
    jar_path = os.path.join(output_dir, jar_name)

    if os.path.exists(jar_path):
        print(f"[SKIP] Already downloaded: {jar_name}")
        return

    print(f"[DOWNLOAD] {jar_url}")
    response = requests.get(jar_url, stream=True)
    polite_delay()

    if response.status_code == 200:
        with open(jar_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        print(f"[SAVED] {jar_name}")
    else:
        print(f"[FAILED] {jar_name} not found at {jar_url}")

def main():
    print(f"=== Fetching all versions for {GROUP_ID}:{ARTIFACT_ID} ===")
    versions = get_all_versions(GROUP_ID, ARTIFACT_ID)
    print(f"[INFO] Found {len(versions)} versions.")

    for version in versions:
        download_jar(GROUP_ID, ARTIFACT_ID, version)

    print(f"=== Download Completed for {ARTIFACT_ID} ===")

if __name__ == "__main__":
    main()
