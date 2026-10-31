const express = require("express");
const results = require("../results");

const router = express.Router();

// Where the result tables are read from, and when they were loaded
// http://localhost:5050/api/dependencies/test-dataset
router.get("/test-dataset", async (req, res) => {
  try {
    const versions = await results.query(
      "SELECT library_ga, version FROM library_versions ORDER BY library_ga, version");
    res.json({ resultsPath: results.RESULTS_PATH, loadedAt: results.loadedAt(), versions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search libraries by keyword: groupId:artifactId of the libraries with results
// http://localhost:5050/api/dependencies/search?query=jackson
router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query required" });

    const rows = await results.query(`
      SELECT DISTINCT library_ga FROM library_versions
      WHERE contains(lower(library_ga), lower($query)) ORDER BY library_ga`, { query });
    res.json(rows.map((r) => r.library_ga));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Versions of a library that have results, oldest first
// http://localhost:5050/api/dependencies/versions?library=jackson-databind
router.get("/versions", async (req, res) => {
  try {
    const { library } = req.query;
    if (!library) return res.status(400).json({ error: "Library required" });

    const ga = await results.resolveLibrary(library);
    const rows = ga ? await results.query(
      "SELECT version FROM library_versions WHERE library_ga = $ga", { ga }) : [];
    res.json(rows.map((r) => r.version).sort(results.compareVersions));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dependents of a library version: how many the dependents index lists, and a sample
// of the analyzed ones
// http://localhost:5050/api/dependencies/details?library=jackson-databind&version=2.17.2
router.get("/details", async (req, res) => {
  try {
    const lv = await results.libraryVersion(req, res);
    if (!lv) return;

    const sample = await results.query(`
      SELECT dependent_ga || ':' || dependent_version AS release_id, dependent_ga, dependent_version,
             tier, rank, reach
      FROM dependents WHERE library_ga = $ga AND version = $version AND selected
      ORDER BY rank LIMIT 5`, { ga: lv.ga, version: lv.version });
    res.json({
      library: req.query.library,
      version: lv.version,
      dependentsCount: lv.summary.dependent_projects,
      sample,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
