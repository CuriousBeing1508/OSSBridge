# OSSBridge - Quick Start Guide

## Prerequisites

1. **Docker Desktop** installed and running
   - Download: https://www.docker.com/products/docker-desktop
   - Supports: Windows 10/11, macOS 10.15+, Linux
   - Free for educational and research use

2. **Result tables**: the app reads the OSSBridge result tables (Parquet files,
   one per table and library version). Either
   - read them from the published Hugging Face dataset
     (https://huggingface.co/datasets/rachna1508/ossbridge-results), no download needed, or
   - use a local copy: the pipeline writes them to `data/results`, and
     `python -m ossbridge_pipeline.publish --download` (from `pipeline/`) downloads the published ones there.

---

## Setup (5 minutes)

### Step 1: Get OSSBridge

Clone the repository; the app is in its `app/` folder.

### Step 2: Choose where the result tables are read from

1. Copy `.env.example` to `.env` and open it in a text editor:

   **Mac/Linux:**
```bash
   cp .env.example .env
   nano .env
```

   **Windows:**
```
   copy .env.example .env
   notepad .env
```

2. Keep one of the two settings:

   **A local results folder** (default: the repo's `data/results`):
```bash
   RESULTS_DIR=../data/results
```

   **The published Hugging Face dataset:**
```bash
   RESULTS_PATH=hf://datasets/rachna1508/ossbridge-results/results
```

3. Save the file and close the editor

The backend loads the tables when it starts; restart it to see new results.

### Step 3: Start OSSBridge

**Mac/Linux:**
```bash
cd app
./start.sh
```

**Windows:**
```
cd app
start.bat
```

**Or manually:**
```bash
cd app
docker-compose up --build
```

### Step 4: Access the Application

Once you see "OSSBridge backend running on http://localhost:5050" in the terminal:

1. Open your web browser
2. Go to: **http://localhost:3000**
3. The OSSBridge interface should load

---

## Using OSSBridge

1. **Search for a library** (e.g., type "jackson")
2. **Select a library** from the dropdown (e.g., "jackson-databind")
3. **Select a version** (e.g., "2.17.2")
4. **Click "Analyze Usage"** to view analytics
5. **Explore the visualizations:**
   - Usage statistics
   - Dependent analysis
   - Maintainer summary
   - API surface usage
   - Test coverage

---

## Stopping the Application

**In the terminal where Docker is running:**
- Press `Ctrl+C`

**Then clean up:**
```bash
docker-compose down
```

---

## Troubleshooting

### "Docker is not running"
- **Solution:** Start the Docker Desktop application
- Wait for Docker to fully start (whale icon in system tray)

### "Could not load the result tables"
- **Problem:** The backend found no result tables where `.env` points
- **Solution:** 
  1. Check `RESULTS_DIR` (or `RESULTS_PATH`) in `.env`
  2. A local folder must contain `library_versions/`, `apis/`, `dependents/`, `api_usage/` and `api_coverage/`
  3. Use an absolute path if the relative one does not work
  4. On Windows, use forward slashes: `C:/Users/...` not `C:\Users\...`

### "Port 3000 already in use"
- **Problem:** Another application is using port 3000
- **Solution:** 
  - Stop other applications using port 3000
  - Or edit `docker-compose.yml` and change `"3000:80"` to `"8080:80"`

### "Port 5050 already in use"
- **Problem:** Another application is using port 5050
- **Solution:** 
  - Stop other applications using port 5050
  - Or edit `docker-compose.yml` and change the backend port

### Build fails or images won't start
- **Solution:**
```bash
  # Clean up and rebuild
  docker-compose down --rmi all
  docker-compose up --build
```

---

## System Requirements

- **Operating System:** Windows 10/11, macOS 10.15+, or Linux
- **RAM:** 4GB minimum, 8GB recommended
- **Disk Space:** 
  - ~2GB for Docker images
  - Result tables: a few MB per library version
  - ~1GB for temporary build files
- **Docker Desktop:** Latest version

---

## Additional Commands
```bash
# Start in detached mode (background)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down

# Rebuild from scratch
docker-compose up --build

# Remove everything (containers, images, volumes)
docker-compose down --rmi all --volumes
```

---



