#!/usr/bin/env python3
import os
import csv
import time
import argparse
import requests
import logging
import sys
import traceback

def download_jar(group_id: str, artifact_id: str, version: str, download_dir: str) -> str:
    """
    Download a single jar from Maven Central and save it as group_artifact_version.jar
    Returns status: 'downloaded', 'skipped', 'failed', 'invalid-content'
    """
    base_url = "https://repo1.maven.org/maven2"
    group_path = group_id.replace(".", "/")
    safe_group = group_id.replace(".", "_")
    jar_filename = f"{safe_group}-{artifact_id}-{version}.jar"
    jar_url = f"{base_url}/{group_path}/{artifact_id}/{version}/{artifact_id}-{version}.jar"
    dest_path = os.path.join(download_dir, jar_filename)

    if os.path.isfile(dest_path):
        logging.info(f" Skipped (already exists): {jar_filename}")
        return "skipped"

    try:
        resp = requests.get(jar_url, stream=True)
    except Exception as e:
        logging.error(f" Request error for {jar_url}: {e}")
        return "failed"

    if resp.status_code != 200:
        logging.warning(f" Failed ({resp.status_code}): {jar_url}")
        return "failed"

    # Validate response content type before saving
    content_type = resp.headers.get("Content-Type", "")
    if "java-archive" not in content_type and not jar_url.endswith(".jar"):
        logging.warning(f" Invalid content (type: {content_type}): {jar_url}")
        return "invalid-content"

    os.makedirs(download_dir, exist_ok=True)
    try:
        with open(dest_path, "wb") as fout:
            for chunk in resp.iter_content(16384):  # 16 KB chunks
                fout.write(chunk)
        logging.info(f" Downloaded {jar_filename}")
        return "downloaded"
    except Exception as e:
        logging.error(f" Write failed for {jar_filename}: {e}")
        return "failed"


def main():
    # Setup paths
    download_base_dir = os.path.abspath(os.getcwd())
    default_csv = os.path.join(os.getcwd(), "processed_csvs", "com.fasterxml.jackson.core:jackson-databind-2.17.2.csv")
    download_dir = os.path.join(download_base_dir, "DepJarDataset", "jackson-databind-2.17.2")

    # CLI Args
    p = argparse.ArgumentParser(description="Bulk-download JARs from Maven Central using release_id column.")
    p.add_argument("--csv-file", default=default_csv, help=f"Path to your CSV file (default: {default_csv})")
    p.add_argument("--delay", type=float, default=3.0, help="Delay (in seconds) between downloads to avoid throttling")
    args = p.parse_args()

    # Logging setup
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-1s %(message)s")

    # Verify CSV exists
    if not os.path.isfile(args.csv_file):
        logging.error(f"CSV file not found: {args.csv_file}")
        sys.exit(1)

    logging.info(f"→ Reading dependencies from: {args.csv_file}")
    logging.info(f"→ Saving JARs into: {download_dir}")

    # Stats
    downloaded = 0
    skipped = 0
    failed = 0
    invalid = 0
    bad_rows = 0
    total_rows = 0

    # Process CSV
    with open(args.csv_file, newline="", encoding="utf-8") as cf:
        reader = csv.DictReader(cf)
        for row in reader:
            total_rows += 1
            release_id = row.get("release_id", "").strip()

            try:
                group_id, artifact_id, version = release_id.split(":")
            except ValueError:
                logging.error(f" Bad release_id format: '{release_id}', skipping.")
                bad_rows += 1
                continue

            try:
                status = download_jar(group_id, artifact_id, version, download_dir)
                if status == "downloaded":
                    downloaded += 1
                elif status == "skipped":
                    skipped += 1
                elif status == "invalid-content":
                    invalid += 1
                else:
                    failed += 1
            except Exception as e:
                logging.error(f" Unexpected error for {release_id}: {e}")
                traceback.print_exc()
                failed += 1

            time.sleep(args.delay)

    # Summary
    logging.info("======== SUMMARY ========")
    logging.info(f"Total rows processed     : {total_rows}")
    logging.info(f"Successfully downloaded: {downloaded}")
    logging.info(f"Skipped (already exist): {skipped}")
    logging.info(f"Invalid content skipped: {invalid}")
    logging.info(f" Failed to download     : {failed}")
    logging.info(f" Malformed release_ids  : {bad_rows}")
    logging.info("==========================")


if __name__ == "__main__":
    main()
