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
    echo "Please copy .env.example to .env and set where the result tables are"
    echo ""
    exit 1
fi

# Start containers
echo " Starting OSSBridge..."
echo "   OSSBridge: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop"
echo "======================================================================"
echo ""

docker compose up

echo ""
echo "======================================================================"
echo "  To stop completely, run: docker compose down"
echo "======================================================================"