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
  const topMethods = await results.query(`
    SELECT method_full AS "methodFull", count(DISTINCT dependent) AS "dependentCount",
           sum(caller_classes) AS "totalUsageCount"
    FROM uses WHERE library_ga = $ga AND version = $version AND method_full IS NOT NULL
    GROUP BY method_full ORDER BY "dependentCount" DESC, "totalUsageCount" DESC, method_full
    LIMIT 15`, params);

  res.json({
    library: req.query.library,
    version: lv.version,
    totalDependents: totals.dependents,
    uniquePackages: totals.packages,
    uniqueClasses: totals.classes,
    uniqueMethods: totals.methods,
    categoryDistribution: Object.fromEntries(categories.map((c) => [c.category, c.n])),
    topMethods,
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
  });
  const message = `${usagePercentage}% of your library's available APIs are being used by ${dependents} dependents`;

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
  if (!lv) return;
  if (lv.summary.coverage_status !== "ok") {
    return res.status(404).json({
      error: `No test coverage for ${req.query.library} ${lv.version}: ${lv.summary.coverage_status}`,
    });
  }

  const project = projectCoverage(lv.summary);
  const used = (await apiGroups(lv)).filter((g) => g.used);
  const covered = used.filter((g) => g.status === "covered");
  const notCovered = used.filter((g) => g.status === "not_covered");
  const notFound = used.filter((g) => g.status === "not_found");
  const [{ dependents }] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents FROM uses
    WHERE library_ga = $ga AND version = $version`, { ga: lv.ga, version: lv.version });

  const totalUsedApis = used.length;
  const usageBasedCoverage = pct(covered.length, totalUsedApis);
  const usageBasedCoverageGain = round2(100 - usageBasedCoverage);
  const uncoveredInstructions = notCovered.reduce((sum, g) => sum + g.instruction_missed, 0);
  const known = project.pct !== null;
  const potentialProjectCoverage = known ? pct(project.covered + uncoveredInstructions, project.total) : null;
  const projectCoverageGain = known ? round2(potentialProjectCoverage - project.pct) : null;

  const diff = known ? usageBasedCoverage - project.pct : null;
  const interpretation = !known
    ? "Overall project coverage is not recorded for this version."
    : Math.abs(diff) < 1
      ? "Used APIs have similar coverage to overall project - well balanced!"
      : diff < 0
        ? "Used APIs have lower coverage than overall project - could prioritize testing these!"
        : "Used APIs have better coverage than overall project - great job!";

  res.json({
    library: req.query.library,
    version: lv.version,

    totalUsedApis,
    coveredByTests: covered.length,
    notCoveredByTests: notCovered.length,
    notFoundInCoverage: notFound.length,

    usageBasedCoverage,
    overallProjectCoverage: project.pct,

    summary: {
      totalDependents: dependents,
      mainMessage: `${usageBasedCoverage}% of APIs used by dependents have test coverage`,
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
      .sort((a, b) => b.instruction_missed - a.instruction_missed || b.dependents - a.dependents)
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
 * Community Test Coverage (CTC): share of dependents whose used APIs are all
 * covered by the library's tests
 */
router.get("/community-test-coverage", handle("community-test-coverage", async (req, res) => {
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  if (lv.summary.coverage_status !== "ok") {
    return res.status(404).json({
      error: `No test coverage for ${req.query.library} ${lv.version}: ${lv.summary.coverage_status}`,
    });
  }
  const params = { ga: lv.ga, version: lv.version };

  // Status of each API a dependent uses, from the overloads it uses
  const rows = await results.query(`
    WITH missed AS (
      SELECT signature, sum(instruction_missed) AS instruction_missed FROM api_methods
      WHERE library_ga = $ga AND version = $version GROUP BY signature)
    SELECT u.dependent, m.signature, any_value(m.package) AS package, any_value(m.class_name) AS class,
           any_value(m.member) AS method, any_value(x.instruction_missed) AS instruction_missed,
           CASE WHEN bool_or(m.status IN ('covered', 'covered_by_override')) THEN 'covered'
                WHEN bool_or(m.status = 'not_covered') THEN 'not_covered'
                ELSE 'not_found' END AS status
    FROM uses u
    JOIN api_methods m USING (library_ga, version, api_id)
    JOIN missed x USING (signature)
    WHERE u.library_ga = $ga AND u.version = $version
    GROUP BY u.dependent, m.signature`, params);
  const all = await results.query(`
    SELECT DISTINCT dependent FROM uses WHERE library_ga = $ga AND version = $version
    ORDER BY dependent`, params);

  const byDependent = new Map(all.map((d) => [d.dependent, []]));
  for (const r of rows) byDependent.get(r.dependent).push(r);

  const projects = [...byDependent.entries()].map(([name, apis]) => {
    const coveredApis = apis.filter((a) => a.status === "covered").length;
    const uncovered = apis.filter((a) => a.status === "not_covered");
    const notFoundApis = apis.filter((a) => a.status === "not_found").length;
    return {
      name,
      totalApisUsed: apis.length,
      coveredApis,
      uncoveredApis: uncovered.length,
      notFoundApis,
      coveragePercentage: pct(coveredApis, apis.length),
      isFullyCovered: uncovered.length === 0 && notFoundApis === 0 && apis.length > 0,
      topUncoveredApis: uncovered
        .sort((a, b) => b.instruction_missed - a.instruction_missed)
        .slice(0, 5)
        .map((a) => ({
          signature: a.signature, package: a.package, class: a.class, method: a.method,
          instructionsMissed: a.instruction_missed,
        })),
    };
  });

  const NPtotal = projects.length;
  const fully = projects.filter((p) => p.isFullyCovered);
  const partially = projects.filter((p) => !p.isFullyCovered && p.coveredApis > 0);
  const none = projects.filter((p) => p.coveredApis === 0 && p.totalApisUsed > 0);
  const NPFullyCovered = fully.length;
  const ctc = pct(NPFullyCovered, NPtotal);
  const average = NPtotal ? round2(projects.reduce((sum, p) => sum + p.coveragePercentage, 0) / NPtotal) : 0;
  const share = (n) => (NPtotal > 0 ? ((n / NPtotal) * 100).toFixed(2) : 0);
  const inRange = (lo, hi) => projects.filter((p) => p.coveragePercentage >= lo && p.coveragePercentage < hi).length;

  const interpretation =
    ctc >= 80 ? "Excellent! Most dependent projects use only well-tested APIs."
      : ctc >= 60 ? "Good coverage, but some dependents rely on untested APIs."
        : ctc >= 40 ? "Moderate coverage. Many dependents use APIs without complete test coverage."
          : ctc >= 20 ? "Low coverage. Most dependents use some untested APIs."
            : "Critical! Very few dependents use well tested API methods of your library.";

  res.json({
    library: req.query.library,
    version: lv.version,

    communityTestCoverage: ctc,
    NPFullyCovered,
    NPtotal,

    summary: {
      interpretation,
      mainMessage: `${ctc}% of dependent projects use only APIs that are fully covered by tests`,
      fullyCoveredCount: NPFullyCovered,
      partiallyCoveredCount: partially.length,
      notCoveredCount: none.length,
      averageProjectCoverage: average,
    },

    breakdown: {
      fullyCovered: {
        count: NPFullyCovered,
        percentage: ctc,
        description: "Dependents where ALL used API methods have test coverage",
      },
      partiallyCovered: {
        count: partially.length,
        percentage: share(partially.length),
        description: "Dependents where SOME API methods lacking test coverage",
      },
      notCovered: {
        count: none.length,
        percentage: share(none.length),
        description: "Dependents where NONE of the used API methods have test coverage",
      },
    },

    topPerformers: [...fully]
      .sort((a, b) => b.totalApisUsed - a.totalApisUsed)
      .slice(0, 10)
      .map((p) => ({ name: p.name, totalApisUsed: p.totalApisUsed, coveragePercentage: p.coveragePercentage })),

    projectsNeedingAttention: projects
      .filter((p) => p.uncoveredApis > 0)
      .sort((a, b) => b.uncoveredApis - a.uncoveredApis)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        totalApisUsed: p.totalApisUsed,
        coveredApis: p.coveredApis,
        uncoveredApis: p.uncoveredApis,
        coveragePercentage: p.coveragePercentage,
        topUncoveredApis: p.topUncoveredApis,
      })),

    distribution: {
      "100% coverage": fully.length,
      "80-99% coverage": inRange(80, 100),
      "60-79% coverage": inRange(60, 80),
      "40-59% coverage": inRange(40, 60),
      "20-39% coverage": inRange(20, 40),
      "0-19% coverage": inRange(0, 20),
    },

    allProjects: [...projects]
      .sort((a, b) => b.coveragePercentage - a.coveragePercentage)
      .map((p) => ({
        name: p.name,
        totalApisUsed: p.totalApisUsed,
        coveredApis: p.coveredApis,
        uncoveredApis: p.uncoveredApis,
        coveragePercentage: p.coveragePercentage,
        isFullyCovered: p.isFullyCovered,
      })),
  });
}));

module.exports = router;
