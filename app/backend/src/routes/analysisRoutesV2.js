const express = require("express");
const results = require("../results");

const router = express.Router();

// Counts follow the old dataset's rows: one row per (caller class, usage), so a
// usage's count is its number of caller classes (api_usage.caller_classes).
// An "API" is a method name of a class (overloads together, see results.js).

const round2 = (x) => parseFloat(x.toFixed(2));
const pct = (part, total) => (total > 0 ? round2((part / total) * 100) : 0);

function handle(name, fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`Error in ${name}:`, err);
      res.status(500).json({ error: err.message });
    }
  };
}

/** Distinct usages per analyzed dependent (old: UniqueThirdPartyUsages). */
function apisUsedPerDependent({ ga, version }) {
  return results.query(`
    SELECT dependent, count(DISTINCT usage) AS apis_used FROM uses
    WHERE library_ga = $ga AND version = $version
    GROUP BY dependent ORDER BY apis_used DESC, dependent`, { ga, version });
}

/**
 * One row per API (method name of a class) with its use and test coverage:
 *   used           some overload is used by a dependent
 *   status         from the used overloads: covered (by its own code or an
 *                  override's), not_covered, or not_found (no code to measure,
 *                  e.g. abstract, or no coverage run)
 *   dependents     dependents that use it
 */
function apiGroups({ ga, version }) {
  return results.query(`
    WITH m AS (
      SELECT * FROM api_methods WHERE library_ga = $ga AND version = $version),
    used AS (
      SELECT DISTINCT api_id FROM uses
      WHERE library_ga = $ga AND version = $version AND api_id IS NOT NULL),
    users AS (
      SELECT m.signature, count(DISTINCT u.dependent) AS dependents
      FROM uses u JOIN m USING (library_ga, version, api_id) GROUP BY m.signature)
    SELECT m.signature, any_value(m.package) AS package, any_value(m.class_name) AS class,
           any_value(m.member) AS method, count(*) AS overloads,
           sum(m.instruction_missed) AS instruction_missed,
           sum(m.instruction_covered) AS instruction_covered,
           bool_or(u.api_id IS NOT NULL) AS used,
           coalesce(any_value(s.dependents), 0) AS dependents,
           CASE WHEN bool_or(u.api_id IS NOT NULL AND m.status IN ('covered', 'covered_by_override')) THEN 'covered'
                WHEN bool_or(u.api_id IS NOT NULL AND m.status = 'not_covered') THEN 'not_covered'
                ELSE 'not_found' END AS status
    FROM m LEFT JOIN used u USING (api_id) LEFT JOIN users s USING (signature)
    GROUP BY m.signature ORDER BY m.signature`, { ga, version });
}

/** Sends why there is no test coverage and returns true, or returns false when there is coverage. */
function noCoverage(lv, res) {
  const coverage = results.coverage(lv.summary);
  if (coverage.available) return false;
  res.status(404).json({ error: coverage.reason || "Test coverage is not available for this version.", coverage });
  return true;
}

/** Instruction coverage of the whole library; pct is null for results stored without it. */
function projectCoverage(summary) {
  const covered = summary.instructions_covered || 0;
  const total = covered + (summary.instructions_missed || 0);
  return { covered, total, pct: total > 0 ? pct(covered, total) : null };
}

/**
 * ROUTE: /api/analysisV2/usage
 * http://localhost:5050/api/analysisV2/usage?library=jackson-databind&version=2.17.2&top=10
 * Distinct APIs used per dependent: mean, median, max and the top dependents
 */
router.get("/usage", handle("usage", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  const top = parseInt(req.query.top, 10) || 10;

  const rows = await apisUsedPerDependent(lv);
  if (rows.length === 0) {
    return res.status(404).json({ error: "No analyzed dependents" });
  }
  const values = rows.map((r) => r.apis_used);
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  res.json({
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[Math.floor(mid)],
    max: sorted[sorted.length - 1],
    topDependents: rows.slice(0, top).map((r) => ({ dependent: r.dependent, apisUsed: r.apis_used })),
  });
}));

/**
 * ROUTE: /api/analysisV2/dependent-details
 * http://localhost:5050/api/analysisV2/dependent-details?library=jackson-databind&version=2.17.2&dependent=<groupId:artifactId:version>
 * What one dependent uses of the library
 */
router.get("/dependent-details", handle("dependent-details", async (req, res) => {
  const { dependent } = req.query;
  if (!dependent) {
    return res.status(400).json({ error: "library, version, and dependent parameters are required" });
  }
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;

  const params = { ga: lv.ga, version: lv.version, dependent };
  const rows = await results.query(`
    SELECT usage, category, package, class, member, method_full, occurrences, caller_classes FROM uses
    WHERE library_ga = $ga AND version = $version AND dependent = $dependent
    ORDER BY caller_classes DESC, usage, category`, params);
  if (rows.length === 0) {
    return res.status(404).json({ error: `No usage found for ${dependent}` });
  }

  const categoryDistribution = {};
  for (const r of rows) {
    categoryDistribution[r.category] = (categoryDistribution[r.category] || 0) + r.caller_classes;
  }
  const distinct = (key) => new Set(rows.map((r) => r[key]).filter(Boolean)).size;
  res.json({
    dependent,
    totalCalls: rows.reduce((sum, r) => sum + r.caller_classes, 0),
    uniquePackages: distinct("package"),
    uniqueClasses: distinct("class"),
    uniqueMethods: distinct("member"),
    uniqueMethodsFull: distinct("method_full"),
    categoryDistribution,
    details: rows.map((r) => ({
      caller: `${r.caller_classes} ${r.caller_classes === 1 ? "class" : "classes"}`,
      usage: r.usage,
      category: r.category,
      package: r.package,
      class: r.class,
      method: r.member || "",
      methodFull: r.method_full || r.usage,
      belongsToLibrary: true,
      occurrences: r.occurrences,
      callerClasses: r.caller_classes,
    })),
  });
}));

/**
 * ROUTE: /api/analysisV2/maintainer-summary
 * http://localhost:5050/api/analysisV2/maintainer-summary?library=jackson-databind&version=2.17.2
 * Overview across all analyzed dependents
 */
router.get("/maintainer-summary", handle("maintainer-summary", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  const params = { ga: lv.ga, version: lv.version };

  const [totals] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents, count(DISTINCT package) AS packages,
           count(DISTINCT class) AS classes, count(DISTINCT method_full) AS methods
    FROM uses WHERE library_ga = $ga AND version = $version`, params);
  const categories = await results.query(`
    SELECT category, sum(caller_classes) AS n FROM uses
    WHERE library_ga = $ga AND version = $version GROUP BY category ORDER BY n DESC`, params);
  const ranked = (column) => results.query(`
    SELECT ${column} AS name, count(DISTINCT dependent) AS projects
    FROM uses WHERE library_ga = $ga AND version = $version AND ${column} <> ''
    GROUP BY ${column} ORDER BY projects DESC, name LIMIT 10`, params);
  // The 10 methods used by the most projects, with how much of them the tests run.
  const coverage = results.coverage(lv.summary);
  const topMethods = (await results.query(`
    WITH used AS (
      SELECT u.method_full, u.dependent, m.status, m.instruction_missed
      FROM uses u JOIN api_methods m USING (library_ga, version, api_id)
      WHERE u.library_ga = $ga AND u.version = $version)
    SELECT method_full AS name, count(DISTINCT dependent) AS projects,
           CASE WHEN NOT bool_or(status IN ('covered', 'covered_by_override', 'not_covered')) THEN 'no_code'
                WHEN bool_and(status NOT IN ('covered', 'covered_by_override', 'not_covered')
                              OR (status IN ('covered', 'covered_by_override') AND instruction_missed = 0))
                  THEN 'fully_covered'
                WHEN bool_or(status IN ('covered', 'covered_by_override')) THEN 'partly_covered'
                ELSE 'not_covered' END AS coverage
    FROM used GROUP BY method_full ORDER BY projects DESC, name LIMIT 10`, params))
    .map((m) => (coverage.available ? m : { ...m, coverage: null }));

  res.json({
    library: req.query.library,
    version: lv.version,
    totalDependents: totals.dependents,
    uniquePackages: totals.packages,
    uniqueClasses: totals.classes,
    uniqueMethods: totals.methods,
    categoryDistribution: Object.fromEntries(categories.map((c) => [c.category, c.n])),
    topPackages: await ranked("package"),
    topClasses: await ranked("class"),
    topMethods,
    testCoverage: coverage,
  });
}));

/**
 * ROUTE: /api/analysisV2/usage-intensity
 * http://localhost:5050/api/analysisV2/usage-intensity?library=jackson-databind&version=2.17.2
 * How deeply dependents use the library (light / medium / heavy users)
 */
router.get("/usage-intensity", handle("usage-intensity", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;

  const data = (await apisUsedPerDependent(lv))
    .map((r) => ({ jarFile: r.dependent, usageCount: r.apis_used }));
  const between = (lo, hi) => data.filter((d) => d.usageCount >= lo && d.usageCount <= hi).length;
  const mean = data.length ? data.reduce((sum, d) => sum + d.usageCount, 0) / data.length : 0;

  res.json({
    library: req.query.library,
    version: lv.version,
    distribution: {
      "Light (1-10 APIs)": between(1, 10),
      "Medium (11-50 APIs)": between(11, 50),
      "Heavy (51-200 APIs)": between(51, 200),
      "Very Heavy (200+ APIs)": between(201, Infinity),
    },
    topHeavyUsers: data.slice(0, 20),
    stats: {
      mean: round2(mean),
      median: data[Math.floor(data.length / 2)]?.usageCount || 0,
      max: data[0]?.usageCount || 0,
      min: data[data.length - 1]?.usageCount || 0,
    },
  });
}));

/**
 * ROUTE: /api/analysisV2/package-heatmap
 * http://localhost:5050/api/analysisV2/package-heatmap?library=jackson-databind&version=2.17.2
 * Most used packages and classes
 */
router.get("/package-heatmap", handle("package-heatmap", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  const params = { ga: lv.ga, version: lv.version };

  const ranked = (column, limit) => results.query(`
    SELECT ${column} AS name, sum(caller_classes) AS "totalUsage",
           count(DISTINCT dependent) AS "dependentCount"
    FROM uses WHERE library_ga = $ga AND version = $version
    GROUP BY ${column} ORDER BY "totalUsage" DESC, name LIMIT ${limit}`, params);
  const [totals] = await results.query(`
    SELECT count(DISTINCT package) AS packages, count(DISTINCT class) AS classes
    FROM uses WHERE library_ga = $ga AND version = $version`, params);

  res.json({
    library: req.query.library,
    version: lv.version,
    topPackages: await ranked("package", 10),
    topClasses: await ranked("class", 15),
    totalPackages: totals.packages,
    totalClasses: totals.classes,
  });
}));

/**
 * ROUTE: /api/analysisV2/api-surface-usage
 * http://localhost:5050/api/analysisV2/api-surface-usage?library=jackson-databind&version=2.17.2
 * Share of the library's API (methods and constructors) used by any dependent
 */
router.get("/api-surface-usage", handle("api-surface-usage", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;

  const groups = await apiGroups(lv);
  if (groups.length === 0) {
    return res.status(404).json({ error: `No API extracted for ${req.query.library} ${lv.version}` });
  }
  const [{ dependents }] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents FROM uses
    WHERE library_ga = $ga AND version = $version`, { ga: lv.ga, version: lv.version });

  const used = groups.filter((g) => g.used).sort((a, b) => b.dependents - a.dependents);
  const unused = groups.filter((g) => !g.used);
  const totalOverloads = groups.reduce((sum, g) => sum + g.overloads, 0);
  const usagePercentage = pct(used.length, groups.length);
  const describe = (g) => ({
    signature: g.signature, package: g.package, class: g.class, method: g.method, overloadCount: g.overloads,
    projects: g.dependents,
  });
  const message = `${usagePercentage}% of your library's available APIs are being used by ${dependents} dependents`;

  // APIs that no analyzed project uses, with their test coverage and whether they are deprecated.
  // A class is listed only when the coverage report includes it, which leaves out bundled third-party code.
  const unusedRows = await results.query(`
    WITH used AS (
      SELECT DISTINCT api_id FROM uses
      WHERE library_ga = $ga AND version = $version AND api_id IS NOT NULL),
    g AS (
      SELECT m.signature,
             CASE WHEN m.package = '' THEN m.class_name ELSE m.package || '.' || m.class_name END AS class,
             bool_or(u.api_id IS NOT NULL) AS used,
             CASE WHEN bool_or(m.status IN ('covered', 'covered_by_override')) THEN 'covered'
                  WHEN bool_or(m.status = 'not_covered') THEN 'not_covered'
                  ELSE 'no_code' END AS coverage,
             bool_or(coalesce(a.deprecated, false) OR coalesce(a.class_deprecated, false)) AS deprecated,
             bool_or(m.instruction_covered + m.instruction_missed > 0) AS reported
      FROM api_methods m
      LEFT JOIN used u USING (api_id)
      LEFT JOIN apis a USING (library_ga, version, api_id)
      WHERE m.library_ga = $ga AND m.version = $version
      GROUP BY m.signature, class)
    SELECT class, used, coverage, deprecated, reported, count(*) AS apis FROM g
    GROUP BY ALL`, { ga: lv.ga, version: lv.version });
  const unusedCount = (filter) => unusedRows.filter((r) => !r.used && filter(r)).reduce((sum, r) => sum + r.apis, 0);
  const classes = new Map();
  for (const r of unusedRows) {
    const c = classes.get(r.class) || { name: r.class, used: false, reported: false, apis: 0, covered: 0, notCovered: 0, deprecated: 0 };
    c.used = c.used || r.used;
    c.reported = c.reported || r.reported;
    c.apis += r.apis;
    if (r.coverage === "covered") c.covered += r.apis;
    if (r.coverage === "not_covered") c.notCovered += r.apis;
    if (r.deprecated) c.deprecated += r.apis;
    classes.set(r.class, c);
  }
  const unusedClasses = [...classes.values()].filter((c) => !c.used && c.reported);
  const unusedSummary = {
    total: unusedCount(() => true),
    covered: unusedCount((r) => r.coverage === "covered"),
    notCovered: unusedCount((r) => r.coverage === "not_covered"),
    noCode: unusedCount((r) => r.coverage === "no_code"),
    deprecated: unusedCount((r) => r.deprecated),
    classes: unusedClasses.length,
    topClasses: unusedClasses
      .sort((a, b) => b.apis - a.apis || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map(({ name, apis, covered, notCovered, deprecated }) => ({ name, apis, covered, notCovered, deprecated })),
  };

  res.json({
    library: req.query.library,
    version: lv.version,
    totalAvailableApis: groups.length,
    totalAvailableOverloads: totalOverloads,
    totalUsedApis: used.length,
    totalUnusedApis: unused.length,
    totalDependentsAnalyzed: dependents,
    usagePercentage,
    topUnusedApis: unused.slice(0, 50).map(describe),
    topUsedApis: used.slice(0, 50).map(describe),
    // read by the maintainer summary page, which lists them as text
    unusedApis: unused.slice(0, 50).map((g) => g.signature),
    unusedSummary,
    message,
    summary: {
      message,
      note: `Methods with multiple overloads are counted as one API. Total overloads: ${totalOverloads}`,
    },
  });
}));

/**
 * ROUTE: /api/analysisV2/used-api-test-coverage
 * http://localhost:5050/api/analysisV2/used-api-test-coverage?library=jackson-databind&version=2.17.2
 * Test coverage of the APIs that dependents use, against the whole library's coverage
 */
router.get("/used-api-test-coverage", handle("used-api-test-coverage", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv || noCoverage(lv, res)) return;

  const project = projectCoverage(lv.summary);
  const used = (await apiGroups(lv)).filter((g) => g.used);
  const covered = used.filter((g) => g.status === "covered");
  const notCovered = used.filter((g) => g.status === "not_covered");
  const notFound = used.filter((g) => g.status === "not_found");
  const [{ dependents }] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents FROM uses
    WHERE library_ga = $ga AND version = $version`, { ga: lv.ga, version: lv.version });

  const totalUsedApis = used.length;
  // APIs with no code to run, such as annotations, are neither tested nor untested.
  const usedApisWithCode = covered.length + notCovered.length;
  const usageBasedCoverage = pct(covered.length, usedApisWithCode);
  const usageBasedCoverageGain = round2(100 - usageBasedCoverage);
  const uncoveredInstructions = notCovered.reduce((sum, g) => sum + g.instruction_missed, 0);
  const known = project.pct !== null;
  const potentialProjectCoverage = known ? pct(project.covered + uncoveredInstructions, project.total) : null;
  const projectCoverageGain = known ? round2(potentialProjectCoverage - project.pct) : null;

  const diff = known ? usageBasedCoverage - project.pct : null;
  const interpretation = !known
    ? "Overall project coverage is not recorded for this version."
    : Math.abs(diff) < 1
      ? "Used APIs have similar coverage to the overall project. They are well balanced."
      : diff < 0
        ? "Used APIs have lower coverage than the overall project. You could prioritize testing them."
        : "Used APIs have better coverage than the overall project. Great job!";

  res.json({
    library: req.query.library,
    version: lv.version,

    totalUsedApis,
    usedApisWithCode,
    coveredByTests: covered.length,
    notCoveredByTests: notCovered.length,
    notFoundInCoverage: notFound.length,

    usageBasedCoverage,
    overallProjectCoverage: project.pct,

    summary: {
      totalDependents: dependents,
      mainMessage: `Tests run ${covered.length.toLocaleString("en-US")} of the ${usedApisWithCode.toLocaleString("en-US")} used APIs that have code (${Math.round(usageBasedCoverage)}%).`,
      comparisonMessage: known
        ? `Overall project test coverage is ${project.pct}%`
        : "Overall project test coverage is not recorded for this version",
      interpretation,
      note: `Out of ${totalUsedApis} APIs used by ${dependents} dependents, ${covered.length} are covered fully or partially by tests`,
    },

    impact: {
      potentialUsageBasedCoverage: 100,
      usageBasedCoverageGain,
      potentialProjectCoverage,
      projectCoverageGain,
      uncoveredInstructionCount: uncoveredInstructions,
      recommendation: usageBasedCoverageGain <= 0
        ? "All used APIs already have test coverage!"
        : known
          ? `Adding tests for ${notCovered.length} uncovered APIs would increase usage-based coverage to 100% (+${usageBasedCoverageGain}%) and overall project coverage to ${potentialProjectCoverage}% (+${projectCoverageGain}%)`
          : `Adding tests for ${notCovered.length} uncovered APIs would increase usage-based coverage to 100% (+${usageBasedCoverageGain}%)`,
    },

    topUncoveredAPIs: notCovered
      .filter((g) => g.instruction_missed > 0)
      .sort((a, b) => b.dependents - a.dependents || b.instruction_missed - a.instruction_missed)
      .slice(0, 20)
      .map((g) => ({
        package: g.package,
        class: g.class,
        method: g.method,
        signature: g.signature,
        instructionsMissed: g.instruction_missed,
        dependentCount: g.dependents,
      })),

    notFoundAPIs: notFound.slice(0, 20).map((g) => ({
      package: g.package, class: g.class, method: g.method, signature: g.signature,
    })),
  });
}));

/**
 * ROUTE: /api/analysisV2/community-test-coverage
 * http://localhost:5050/api/analysisV2/community-test-coverage?library=jackson-databind&version=2.17.2
 * Community Test Coverage (CTC) is the share of dependents whose used API methods are all
 * fully covered by the library's tests. A method is fully covered when the tests run every
 * line of it. Dependents that use no method with code are left out.
 */
router.get("/community-test-coverage", handle("community-test-coverage", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv || noCoverage(lv, res)) return;
  const params = { ga: lv.ga, version: lv.version };

  // One row per dependent and used method that has code.
  const rows = await results.query(`
    SELECT u.dependent, m.signature, any_value(m.class_name) AS class, any_value(m.member) AS method,
           bool_and(m.status IN ('covered', 'covered_by_override') AND m.instruction_missed = 0)
             AS fully_covered,
           bool_or(m.status IN ('covered', 'covered_by_override')) AS any_covered
    FROM uses u
    JOIN api_methods m USING (library_ga, version, api_id)
    WHERE u.library_ga = $ga AND u.version = $version
      AND m.status IN ('covered', 'covered_by_override', 'not_covered')
    GROUP BY u.dependent, m.signature`, params);

  const fullyCovered = new Map();
  const perProject = new Map();
  const methods = new Map();
  for (const r of rows) {
    fullyCovered.set(r.dependent, (fullyCovered.get(r.dependent) ?? true) && r.fully_covered);
    const p = perProject.get(r.dependent) || { methods: 0, fully: 0, covered: 0 };
    p.methods += 1;
    p.fully += r.fully_covered ? 1 : 0;
    p.covered += r.any_covered ? 1 : 0;
    perProject.set(r.dependent, p);
    const m = methods.get(r.signature) || { signature: r.signature, dependents: 0, fully: true, anyCovered: false };
    m.dependents += 1;
    m.fully = m.fully && r.fully_covered;
    m.anyCovered = m.anyCovered || r.any_covered;
    methods.set(r.signature, m);
  }

  const NPtotal = fullyCovered.size;
  const NPFullyCovered = [...fullyCovered.values()].filter(Boolean).length;
  const all = [...methods.values()];
  // Projects whose used methods are all fully covered, partly covered, or not run at all.
  const projects = [...perProject.values()];
  const partiallyCovered = projects.filter((p) => p.fully < p.methods && p.covered > 0).length;
  const notCoveredProjects = projects.filter((p) => p.covered === 0).length;
  const averageProjectCoverage = projects.length
    ? round2(projects.reduce((sum, p) => sum + (100 * p.fully) / p.methods, 0) / projects.length) : 0;
  const notCovered = all.filter((m) => !m.anyCovered);
  res.json({
    library: req.query.library,
    version: lv.version,
    communityTestCoverage: pct(NPFullyCovered, NPtotal),
    NPFullyCovered,
    NPtotal,
    partiallyCoveredProjects: partiallyCovered,
    notCoveredProjects,
    averageProjectCoverage,
    // Used methods that have code, by how much of them the tests run.
    methodsWithCode: all.length,
    methodsFullyCovered: all.filter((m) => m.fully).length,
    methodsPartlyCovered: all.filter((m) => !m.fully && m.anyCovered).length,
    methodsNotCovered: notCovered.length,
    notCoveredMethods: notCovered
      .sort((a, b) => b.dependents - a.dependents || a.signature.localeCompare(b.signature))
      .slice(0, 10)
      .map((m) => ({ signature: m.signature, dependents: m.dependents })),
  });
}));

module.exports = router;
