import os
import requests
from bs4 import BeautifulSoup
import time
import random
import json
import csv
import re

# ==== Configuration ====
GROUP_ID = "com.fasterxml.jackson.core"
ARTIFACT_ID = "jackson-databind"
BASE_REPO_URL = "https://repo1.maven.org/maven2"
DOWNLOAD_DIR_BASE = "Dataset/JarsOnYears"
USAGE_DIR = "usages"
CSV_OUTPUT = "maven_downloads_usages.csv"

def polite_delay():
    """Random delay between requests to avoid being blocked"""
    time.sleep(random.uniform(2, 4))

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
            if version and version[0].isdigit():
                versions.append(version)
    return versions

def download_jar(group_id, artifact_id, version):
    """Download the main jar for the specified version"""
    group_path = group_id.replace('.', '/')
    jar_name = f"{artifact_id}-{version}.jar"
    jar_url = f"{BASE_REPO_URL}/{group_path}/{artifact_id}/{version}/{jar_name}"

    # Create directory with artifact:version format
    output_dir = os.path.join(DOWNLOAD_DIR_BASE, f"{artifact_id}:{version}")
    os.makedirs(output_dir, exist_ok=True)
    jar_path = os.path.join(output_dir, jar_name)

    # Check if JAR already exists
    if os.path.exists(jar_path):
        file_size = os.path.getsize(jar_path)
        if file_size > 0:
            print(f"[SKIP] Already exists: {jar_name} ({file_size} bytes)")
            return True, jar_path

    print(f"[DOWNLOAD] {jar_url}")
    try:
        response = requests.get(jar_url, stream=True, timeout=30)
        polite_delay()

        if response.status_code == 200:
            with open(jar_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            file_size = os.path.getsize(jar_path)
            print(f"[SAVED] {jar_name} ({file_size} bytes)")
            return True, jar_path
        else:
            print(f"[FAILED] {jar_name} not found (status {response.status_code})")
            return False, None
    except Exception as e:
        print(f"[ERROR] Failed to download {jar_name}: {e}")
        return False, None

def extract_usages(group_id, artifact_id, version):
    """Extract usage information from MVN Repository"""
    group_path = group_id.replace('.', '/')
    usage_url = f"https://mvnrepository.com/artifact/{group_path}/{artifact_id}/{version}"
    
    print(f"[USAGE] Fetching usages for {artifact_id}:{version}")
    print(f"[USAGE] URL: {usage_url}")
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
        }
        response = requests.get(usage_url, headers=headers, timeout=30)
        polite_delay()
        
        if response.status_code != 200:
            print(f"[WARNING] Could not fetch usages (status {response.status_code})")
            return None
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        usage_data = {
            "artifact": f"{group_id}:{artifact_id}",
            "version": version,
            "url": usage_url,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "usage_count": 0
        }
        
        # Look for links with href ending in "/usages"
        # Pattern: <a href="jackson-databind/2.19.2/usages">1,988</a>
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            if '/usages' in href and version in href:
                count_text = link.get_text(strip=True)
                match = re.search(r'^([\d,]+)$', count_text)
                if match:
                    count_str = match.group(1).replace(',', '')
                    try:
                        usage_data["usage_count"] = int(count_str)
                        print(f"[FOUND] Usage count: {usage_data['usage_count']}")
                        break
                    except ValueError:
                        pass
        
        # Fallback: Look for "Used By" in table header
        if usage_data["usage_count"] == 0:
            for th in soup.find_all('th'):
                if 'used by' in th.get_text(strip=True).lower():
                    td = th.find_next_sibling('td')
                    if td:
                        link = td.find('a')
                        if link:
                            count_text = link.get_text(strip=True)
                            match = re.search(r'([\d,]+)', count_text)
                            if match:
                                count_str = match.group(1).replace(',', '')
                                usage_data["usage_count"] = int(count_str)
                                print(f"[FOUND] Usage count: {usage_data['usage_count']}")
                                break
        
        # Save usage data to file
        output_dir = os.path.join(USAGE_DIR, artifact_id)
        os.makedirs(output_dir, exist_ok=True)
        usage_file = os.path.join(output_dir, f"{artifact_id}-{version}-usages.json")
        
        with open(usage_file, "w") as f:
            json.dump(usage_data, f, indent=2)
        
        print(f"[SAVED] Usage data for {version} (count: {usage_data['usage_count']})")
        return usage_data
        
    except Exception as e:
        print(f"[ERROR] Failed to extract usages: {e}")
        return None

def main():
    print(f"=== Fetching all versions for {GROUP_ID}:{ARTIFACT_ID} ===")
    versions = get_all_versions(GROUP_ID, ARTIFACT_ID)
    print(f"[INFO] Found {len(versions)} versions.")

    # Prepare CSV file
    csv_file = CSV_OUTPUT
    csv_exists = os.path.exists(csv_file)
    
    with open(csv_file, 'a', newline='', encoding='utf-8') as f:
        fieldnames = ['group_id', 'artifact_id', 'version', 'jar_downloaded', 
                      'jar_path', 'usage_count', 'timestamp']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        
        # Write header only if file is new
        if not csv_exists:
            writer.writeheader()
        
        successful_downloads = []
        
        for version in versions:
            print(f"\n{'='*60}")
            print(f"Processing version: {version}")
            print(f"{'='*60}")
            
            jar_downloaded, jar_path = download_jar(GROUP_ID, ARTIFACT_ID, version)
            
            # Extract usages for this version
            usage_data = None
            usage_count = 0
            
            if jar_downloaded:
                successful_downloads.append(version)
                usage_data = extract_usages(GROUP_ID, ARTIFACT_ID, version)
                if usage_data:
                    usage_count = usage_data.get('usage_count', 0)
            
            # Write to CSV
            writer.writerow({
                'group_id': GROUP_ID,
                'artifact_id': ARTIFACT_ID,
                'version': version,
                'jar_downloaded': 'YES' if jar_downloaded else 'NO',
                'jar_path': jar_path if jar_path else 'N/A',
                'usage_count': usage_count,
                'timestamp': time.strftime("%Y-%m-%d %H:%M:%S")
            })
            
            print(f"[CSV] Recorded {version} (Downloaded: {'YES' if jar_downloaded else 'NO'}, Usages: {usage_count})")
    
    print(f"\n{'='*60}")
    print(f"=== Summary ===")
    print(f"Total versions found: {len(versions)}")
    print(f"Jars downloaded/found: {len(successful_downloads)}")
    print(f"Download completed for {ARTIFACT_ID}")
    print(f"CSV file saved: {csv_file}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()