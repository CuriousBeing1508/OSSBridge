#!/bin/bash

echo "======================================================================"
echo "  OSSBridge - Starting Application"
echo "======================================================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo " Error: Docker is not running!"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo ""
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "  Warning: .env file not found!"
    echo ""
    echo "Please make sure .env file exists and contains DATASET_PATH"
    echo ""
    exit 1
fi

# Check if DATASET_PATH is set
source .env
if [ -z "$DATASET_PATH" ] || [ "$DATASET_PATH" = "/CHANGE/THIS/TO/YOUR/DATASET/PATH" ]; then
    echo "  Warning: DATASET_PATH not configured!"
    echo ""
    echo "Please edit .env file and set DATASET_PATH to your dataset location"
    echo ""
    echo "Example:"
    echo "  nano .env"
    echo "  # Change DATASET_PATH=/Users/yourname/Downloads/Dataset"
    echo ""
    exit 1
fi

# Start containers
echo " Starting OSSBridge..."
echo "   Backend: http://localhost:5050"
echo "   Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"
echo "======================================================================"
echo ""

docker-compose up

echo ""
echo "======================================================================"
echo "  To stop completely, run: docker-compose down"
echo "======================================================================"