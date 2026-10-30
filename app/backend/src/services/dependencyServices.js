const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// ====================================================================
// DATASET PATH CONFIGURATION
// ====================================================================
const DATASET_ROOT = process.env.DATASET_PATH || 
  path.resolve(__dirname, "../../../../data/dataset");

console.log(`[INFO] Dataset root (dependencyServices): ${DATASET_ROOT}`);

// Helper to build paths inside dataset
const getDatasetPath = (...parts) => path.join(DATASET_ROOT, ...parts);

// Processed CSV path
const PROCESSED_CSV_PATH = getDatasetPath('processed_csvs');

// ====================================================================
// CONTROLLER FUNCTIONS
// ====================================================================

// search libraries by keyword
exports.searchLibraries = async (query) => {
  const files = fs.readdirSync(PROCESSED_CSV_PATH);
  const matches = new Set();

  files.forEach(file => {
    if (file.toLowerCase().includes(query.toLowerCase())) {
      const libName = file.split("-")[0];
      matches.add(libName);
    }
  });

  return Array.from(matches);
};

// get available versions for a specific library
exports.getVersions = async (library) => {
  const files = fs.readdirSync(PROCESSED_CSV_PATH);
  const versions = [];

  files.forEach(file => {
    if (file.startsWith(library)) {
      const versionMatch = file.match(/-(\d+\.\d+(\.\d+)?)/);
      if (versionMatch) versions.push(versionMatch[1]);
    }
  });

  return versions;
};

// read specific CSV and count dependents
exports.getDependents = async (library, version) => {
  return new Promise((resolve, reject) => {
    const targetFile = fs
      .readdirSync(PROCESSED_CSV_PATH)
      .find(f => f.includes(library) && f.includes(version));

    if (!targetFile) return reject(new Error("CSV not found"));

    const dependents = [];
    const filePath = path.join(PROCESSED_CSV_PATH, targetFile);

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", row => dependents.push(row))
      .on("end", () => {
        resolve({
          library,
          version,
          dependentsCount: dependents.length,
          sampleDependents: dependents.slice(0, 5)
        });
      })
      .on("error", reject);
  });
};