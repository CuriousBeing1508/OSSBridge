# OSSBridge - Quick Start Guide

## Prerequisites

1. **Docker Desktop** installed and running
   - Download: https://www.docker.com/products/docker-desktop
   - Supports: Windows 10/11, macOS 10.15+, Linux
   - Free for educational and research use

2. **Dataset** downloaded from Zenodo
   - Download the Dataset.zip from Zenodo
   - Extract it to a location on your computer

---

## Setup (5 minutes)

### Step 1: Extract OSSBridge Package

Extract the `OSSBridge-Docker.zip` file to a folder on your computer.

### Step 2: Configure Dataset Path

1. Open the `.env` file in a text editor:

   **Mac/Linux:**
```bash
   nano .env
```

   **Windows:**
```
   notepad .env
```

2. Update the `DATASET_PATH` line with the location where you extracted the dataset:

   **Mac Example:**
```bash
   DATASET_PATH=/Users/yourname/Downloads/Dataset
```

   **Windows Example:**
```
   DATASET_PATH=C:/Users/yourname/Downloads/Dataset
```

   **Linux Example:**
```bash
   DATASET_PATH=/home/yourname/Downloads/Dataset
```

   **Or use the default** (dataset placed in the repo's `data/dataset` folder):
```bash
   DATASET_PATH=../data/dataset
```

3. Save the file and close the editor

### Step 3: Start OSSBridge

**Mac/Linux:**
```bash
cd OSSBridge-Docker
./start.sh
```

**Windows:**
```
cd OSSBridge-Docker
start.bat
```

**Or manually:**
```bash
cd OSSBridge-Docker
docker-compose up --build
```

### Step 4: Access the Application

Once you see "Server running on port 5050" in the terminal:

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

### "Cannot find dataset" or "ENOENT: no such file or directory"
- **Problem:** Dataset path in `.env` is incorrect
- **Solution:** 
  1. Check the path in `.env` file
  2. Make sure you extracted the Dataset.zip
  3. Use absolute path (full path from root)
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
  - Dataset size (varies)
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



