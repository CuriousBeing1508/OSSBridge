const express = require("express");
const {
  searchLibraries,
  getVersions,
  getDependents
} = require("../controllers/dependencyController");

const router = express.Router();
const fs = require("fs");
const path = require("path");

// ====================================================================
// DATASET PATH CONFIGURATION
// ====================================================================
const DATASET_ROOT = process.env.DATASET_PATH || 
  path.resolve(__dirname, "../../../../data/dataset");

console.log(`[INFO] Dataset root (dependencyRoutes): ${DATASET_ROOT}`);

// Helper to build paths inside dataset
const getDatasetPath = (...parts) => path.join(DATASET_ROOT, ...parts);

// This url is just to test whether the backend is able to access the csv data correctly or not.
// http://localhost:5050/api/dependencies/test-dataset
router.get("/test-dataset", (req, res) => {
  try {
    const datasetPath = getDatasetPath('processed_csvs');
    const files = fs.readdirSync(datasetPath);
    const csvFiles = files.filter(f => f.endsWith(".csv"));
    res.json({ datasetPath, files: csvFiles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Search libraries by keyword
// The URL that gets created is : http://localhost:5050/api/dependencies/search?query=jackson
router.get("/search", (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query required" });

    const datasetPath = getDatasetPath('processed_csvs');
    const files = fs.readdirSync(datasetPath);

    // Extract libraries matching query
    const matches = new Set();
    files.forEach(file => {
      if (file.toLowerCase().includes(query.toLowerCase())) {
        // remove extension & version
        const libName = file.replace(/-\d+(\.\d+)*\.csv$/, "");
        matches.add(libName);
      }
    });

    res.json(Array.from(matches));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get versions of a library
// http://localhost:5050/api/dependencies/versions?library=jackson-databind
router.get("/versions", (req, res) => {
  try {
    const { library } = req.query;
    if (!library) return res.status(400).json({ error: "Library required" });

    const datasetPath = getDatasetPath('processed_csvs');
    const files = fs.readdirSync(datasetPath);
    
    console.log("Sample files:", files.slice(0, 5)); // See what files look like
    
    const versions = files
      .filter(f => f.includes(library))
      .map(f => {
        const match = f.match(/-(\d+(?:\.\d+)+)/);
        console.log(`File: ${f}, Match: ${match ? match[1] : 'NO MATCH'}`); // Debug each file
        return match ? match[1] : null;
      })
      .filter(Boolean);

    console.log("Final versions:", versions);
    res.json([...new Set(versions)]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dependents of a library version
// http://localhost:5050/api/dependencies/details?library=jackson-databind&version=2.17.0
router.get("/details", (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version)
      return res.status(400).json({ error: "Library and version required" });

    const datasetPath = getDatasetPath('processed_csvs');
    const files = fs.readdirSync(datasetPath);
    const target = files.find(f => f.includes(library) && f.includes(version));

    if (!target) return res.status(404).json({ error: "CSV not found" });

    const dependents = [];
    fs.createReadStream(path.join(datasetPath, target))
      .pipe(require("csv-parser")())
      .on("data", row => dependents.push(row))
      .on("end", () => {
        res.json({
          library,
          version,
          dependentsCount: dependents.length,
          sample: dependents.slice(0, 5),
        });
      });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;