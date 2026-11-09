const express = require("express");
const results = require("../results");
const { GA, mavenReleases } = require("../mavenCentral");

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

// Every library: the ones in the dependents index and the ones with results
const ALL_LIBRARIES = `
  SELECT coalesce(i.library_ga, a.library_ga) AS library,
         coalesce(a.analyzed, 0) AS "analyzedVersions",
         coalesce(i.versions, 0) AS "indexVersions",
         i.dependents, i.library_ga IS NOT NULL AS "inIndex"
  FROM index_libraries i
  FULL JOIN (SELECT library_ga, count(*) AS analyzed FROM library_versions GROUP BY 1) a
    USING (library_ga)`;

// Search libraries by keyword in groupId:artifactId, analyzed ones first, then by
// number of dependent projects; at most 50
// http://localhost:5050/api/dependencies/search?query=jackson
router.get("/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query required" });

    const rows = await results.query(`
      SELECT * FROM (${ALL_LIBRARIES})
      WHERE contains(lower(library), lower($query))
      ORDER BY "analyzedVersions" > 0 DESC,
               lower(split_part(library, ':', 2)) = lower($query) DESC,
               dependents DESC NULLS LAST, library
      LIMIT 50`, { query });

    // A groupId:artifactId that is not in the index (e.g. first released after the
    // snapshot) is listed when Maven Central has it
    const ga = query.trim();
    if (GA.test(ga) && !rows.some((r) => r.library === ga)) {
      const releases = await mavenReleases(ga);
      if (releases && releases.length) {
        rows.unshift({ library: ga, analyzedVersions: 0, indexVersions: 0, dependents: null,
                       inIndex: false, mavenVersions: releases.length });
      }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The versions of a library in the dependents index, plus the analyzed ones, newest
// first, each with its number of dependent projects and marked analyzed or not.
// Versions dependents declared that are not releases on Maven Central
// (maven-metadata.xml) are left out. notListed counts the Maven Central releases
// that are not in the index, mostly releases after the snapshot.
// http://localhost:5050/api/dependencies/library?library=org.slf4j:slf4j-api
router.get("/library", async (req, res) => {
  try {
    const { library } = req.query;
    if (!library) return res.status(400).json({ error: "Library required" });

    let [match] = await results.query(`
      SELECT library FROM (${ALL_LIBRARIES})
      WHERE library = $library OR split_part(library, ':', 2) = $library
      ORDER BY library = $library DESC, "analyzedVersions" DESC, dependents DESC NULLS LAST
      LIMIT 1`, { library });
    const { available, snapshot } = results.index();
    if (!match && GA.test(library) && (await mavenReleases(library))?.length) {
      match = { library };
    }
    if (!match) {
      return res.status(404).json({
        error: available
          ? `${library} is not in our data and has not been analyzed`
          : `${library} has not been analyzed`,
        snapshot,
      });
    }

    const rows = await results.query(`
      SELECT coalesce(i.library_version, a.version) AS version,
             coalesce(i.dependents, a.dependent_projects) AS dependents,
             a.version IS NOT NULL AS analyzed, i.library_version IS NOT NULL AS "inIndex",
             a.dependents_selected AS "analyzedProjects", a.dependents_tried AS "triedProjects",
             a.analysis_seconds AS "analysisSeconds"
      FROM (SELECT * FROM index_versions WHERE library_ga = $ga) i
      FULL JOIN (SELECT version, dependent_projects, dependents_selected, dependents_tried, analysis_seconds
                 FROM library_versions
                 WHERE library_ga = $ga) a
        ON a.version = i.library_version`, { ga: match.library });

    const releases = await mavenReleases(match.library);
    let versions = rows;
    let notListed = 0;
    if (releases && releases.length) {
      const known = new Set(rows.map((r) => r.version));
      const released = new Set(releases);
      versions = rows.filter((r) => r.analyzed || released.has(r.version));
      notListed = releases.filter((v) => !known.has(v)).length;
    }
    versions.sort((x, y) => results.compareVersions(y.version, x.version));
    res.json({
      library: match.library,
      indexAvailable: available,
      snapshot,
      mavenCentral: Boolean(releases && releases.length),
      notListed,
      versions,
    });
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
