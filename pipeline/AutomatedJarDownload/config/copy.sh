#!/bin/bash
# Copies a library's usage-analysis CSVs into the Dependents/ folder the backend reads.
# Usage: ./copy.sh <library>-<version>      e.g. ./copy.sh commons-codec-1.17.1
# DATASET_PATH defaults to the repo's data/dataset folder.

if [ -z "$1" ]; then
    echo "Usage: $0 <library>-<version>"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATASET_PATH="${DATASET_PATH:-$SCRIPT_DIR/../../../data/dataset}"

# Define source and destination folders
SOURCE_FOLDER="$DATASET_PATH/StaticAnaResults/$1"
DEST_FOLDER="$SOURCE_FOLDER/Dependents"

# Create destination folder if it doesn't exist
mkdir -p "$DEST_FOLDER"

# Copy all CSV files
count=0
for file in "$SOURCE_FOLDER"/*.csv; do
    # Check if any CSV files exist
    if [ -e "$file" ]; then
        cp "$file" "$DEST_FOLDER/"
        echo "Copied: $(basename "$file")"
        ((count++))
    fi
done

if [ $count -eq 0 ]; then
    echo "No CSV files found in $SOURCE_FOLDER"
else
    echo ""
    echo "Total files copied: $count"
fi
