const express = require("express");
const results = require("../results");

const router = express.Router();

// A method is identified by its signature <package>.<Class>.<method> (all its
// overloads, see results.js). Usage counts are caller classes, as in the
// analysis routes.

const round2 = (x) => parseFloat(x.toFixed(2));

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

const PRIMITIVES = {
  B: "byte", C: "char", D: "double", F: "float", I: "int", J: "long", S: "short", Z: "boolean", V: "void",
};

/** Java types of a JVM descriptor: "(Ljava/lang/String;[I)V" -> { parameters: [...], returnType } */
function decodeDescriptor(descriptor) {
  const types = [];
  let i = 0;
  const next = () => {
    let dims = 0;
    while (descriptor[i] === "[") { dims++; i++; }
    let type;
    if (descriptor[i] === "L") {
      const end = descriptor.indexOf(";", i);
      type = descriptor.slice(i + 1, end).replace(/\//g, ".");
      i = end + 1;
    } else {
      type = PRIMITIVES[descriptor[i]] || descriptor[i];
      i++;
    }
    return type + "[]".repeat(dims);
  };
  if (!descriptor || descriptor[0] !== "(") return { parameters: [], returnType: "" };
  i = 1;
  while (i < descriptor.length && descriptor[i] !== ")") types.push(next());
  i++;
  return { parameters: types, returnType: next() };
}

function parameterDescriptors(descriptor) {
  const match = /^\((.*)\)/.exec(descriptor || "");
  return match ? match[1] : "";
}

/**
 * ROUTE: /api/searchMethod/search
 * http://localhost:5050/api/searchMethod/search?library=jackson-databind&version=2.17.2&query=readValue
 * Methods of the library whose name contains the query
 */
router.get("/search", handle("search", async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ error: "library, version, and query parameters are required" });
  }
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;

  const rows = await results.query(`
    SELECT signature, member, package, class_name, api_id, descriptor FROM api_methods
    WHERE library_ga = $ga AND version = $version AND contains(lower(member), lower($query))
    ORDER BY lower(member) = lower($query) DESC, member, signature, api_id`,
    { ga: lv.ga, version: lv.version, query });

  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.signature)) {
      groups.set(r.signature, {
        methodName: r.member,
        signature: r.signature,
        package: r.package,
        class: r.class_name,
        fullClassName: r.package ? `${r.package}.${r.class_name}` : r.class_name,
        overloadCount: 0,
        overloads: [],
      });
    }
    const group = groups.get(r.signature);
    group.overloadCount++;
    group.overloads.push({ fullSignature: r.api_id, methodDescriptor: r.descriptor });
  }

  res.json({
    library: req.query.library,
    version: lv.version,
    query,
    totalMatches: groups.size,
    totalOverloads: rows.length,
    results: [...groups.values()],
  });
}));

/**
 * ROUTE: /api/searchMethod/analytics
 * http://localhost:5050/api/searchMethod/analytics?library=jackson-databind&version=2.17.2&signature=com.fasterxml.jackson.databind.ObjectMapper.readValue
 * Test coverage and use of one method
 */
router.get("/analytics", handle("analytics", async (req, res) => {
  const { signature } = req.query;
  if (!signature) {
    return res.status(400).json({ error: "library, version, and signature parameters are required" });
  }
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  const params = { ga: lv.ga, version: lv.version, signature };

  const overloadRows = await results.query(`
    SELECT package, class_name, member, api_id, descriptor, status, instruction_missed, instruction_covered
    FROM api_methods WHERE library_ga = $ga AND version = $version AND signature = $signature
    ORDER BY api_id`, params);
  if (overloadRows.length === 0) {
    return res.status(404).json({ error: `Method with signature '${signature}' not found` });
  }
  const first = overloadRows[0];
  const overloads = overloadRows.map((r) => {
    const { parameters, returnType } = decodeDescriptor(r.descriptor);
    return {
      fullSignature: r.api_id,
      methodDescriptor: r.descriptor,
      returnType,
      parameters: parameters.join(", "),
      coverageStatus: r.status,
    };
  });

  // Test coverage: instructions of all overloads; an abstract method counts as
  // covered when a tested override covers it
  const instructionCovered = overloadRows.reduce((sum, r) => sum + r.instruction_covered, 0);
  const instructionMissed = overloadRows.reduce((sum, r) => sum + r.instruction_missed, 0);
  const total = instructionCovered + instructionMissed;
  const coveragePercentage = total > 0 ? round2((instructionCovered / total) * 100) : 0;
  const hasCoverage = instructionCovered > 0 ||
    overloadRows.some((r) => r.status === "covered_by_override");

  // Use across the analyzed dependents
  const uses = await results.query(`
    SELECT u.dependent, u.category, u.descriptor, u.caller_classes
    FROM uses u JOIN api_methods m USING (library_ga, version, api_id)
    WHERE u.library_ga = $ga AND u.version = $version AND m.signature = $signature`, params);
  const [{ dependents: totalDependents }] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents FROM uses
    WHERE library_ga = $ga AND version = $version`, { ga: lv.ga, version: lv.version });

  const byDependent = new Map();
  const categoryDistribution = {};
  const patterns = new Map();
  let totalUsageCount = 0;
  for (const u of uses) {
    totalUsageCount += u.caller_classes;
    categoryDistribution[u.category] = (categoryDistribution[u.category] || 0) + u.caller_classes;
    if (!byDependent.has(u.dependent)) {
      byDependent.set(u.dependent, { name: u.dependent, usageCount: 0, categories: {}, patterns: new Set() });
    }
    const d = byDependent.get(u.dependent);
    d.usageCount += u.caller_classes;
    d.categories[u.category] = (d.categories[u.category] || 0) + u.caller_classes;
    const pattern = parameterDescriptors(u.descriptor);
    if (pattern) {
      d.patterns.add(pattern);
      if (!patterns.has(pattern)) patterns.set(pattern, { pattern, count: 0, dependents: new Set() });
      patterns.get(pattern).count += u.caller_classes;
      patterns.get(pattern).dependents.add(u.dependent);
    }
  }

  const dependentsUsingMethod = byDependent.size;
  const adoptionRate = totalDependents > 0 ? round2((dependentsUsingMethod / totalDependents) * 100) : 0;
  const topParameterPatterns = [...patterns.values()]
    .map((p) => ({
      pattern: p.pattern,
      usageCount: p.count,
      dependentCount: p.dependents.size,
      percentage: totalUsageCount > 0 ? ((p.count / totalUsageCount) * 100).toFixed(2) : 0,
    }))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 15);

  const insights = [];
  if (hasCoverage) {
    if (coveragePercentage >= 80) {
      insights.push({ type: "positive", message: `Excellent test coverage (${coveragePercentage}%) - this widely-used API is well-tested` });
    } else if (coveragePercentage >= 50) {
      insights.push({ type: "warning", message: `Moderate test coverage (${coveragePercentage}%) - consider adding more tests for this popular API` });
    } else {
      insights.push({ type: "critical", message: `Low test coverage (${coveragePercentage}%) - this API is widely used but undertested` });
    }
  } else {
    insights.push({ type: "critical", message: "No test coverage detected - consider adding tests for this API used by multiple dependents" });
  }
  if (adoptionRate >= 50) {
    insights.push({ type: "info", message: `High adoption rate (${adoptionRate}%) - this is a core API for your users` });
  } else if (adoptionRate >= 25) {
    insights.push({ type: "info", message: `Moderate adoption (${adoptionRate}%) - important for many users` });
  }
  if (topParameterPatterns.length > 5) {
    insights.push({ type: "info", message: `${topParameterPatterns.length} different usage patterns detected - API is used flexibly` });
  } else if (topParameterPatterns.length === 1) {
    insights.push({ type: "info", message: "Single dominant usage pattern - API is used consistently" });
  }
  if (overloads.length > 1) {
    insights.push({ type: "info", message: `${overloads.length} overloads available - ensure all variants are tested` });
  }

  res.json({
    library: req.query.library,
    version: lv.version,

    methodInfo: {
      package: first.package,
      class: first.class_name,
      method: first.member,
      simpleSignature: signature,
      fullClassName: first.package ? `${first.package}.${first.class_name}` : first.class_name,
      overloadCount: overloads.length,
      overloads,
    },

    testCoverage: {
      hasCoverage,
      instructionCovered,
      instructionMissed,
      coveragePercentage,
      status: hasCoverage
        ? (coveragePercentage >= 80 ? "excellent" : coveragePercentage >= 50 ? "good" : "needs improvement")
        : "no coverage",
    },

    usageStatistics: {
      totalDependents,
      dependentsUsingMethod,
      adoptionRate,
      totalUsageCount,
      averageUsagePerDependent: dependentsUsingMethod > 0 ? round2(totalUsageCount / dependentsUsingMethod) : 0,
      uniqueParameterPatterns: topParameterPatterns.length,
    },

    categoryDistribution,

    parameterPatterns: {
      total: topParameterPatterns.length,
      top15: topParameterPatterns,
    },

    topDependents: [...byDependent.values()]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 20)
      .map((d) => ({ name: d.name, usageCount: d.usageCount, categories: d.categories, uniquePatterns: d.patterns.size })),

    insights,

    summary: {
      mainMessage: `This method is used ${totalUsageCount} times across ${dependentsUsingMethod} dependents (${adoptionRate}% adoption)`,
      coverageSummary: hasCoverage ? `${coveragePercentage}% test coverage` : "No test coverage",
      recommendation: !hasCoverage && dependentsUsingMethod > 5
        ? "Critical: Add test coverage for this widely-used API"
        : coveragePercentage < 50 && dependentsUsingMethod > 3
          ? "Warning: Improve test coverage for this popular API"
          : "Coverage status acceptable",
    },
  });
}));

/**
 * ROUTE: /api/searchMethod/compare
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=com.fasterxml.jackson.databind.ObjectMapper.writeValue,com.fasterxml.jackson.databind.ObjectMapper.writeValueAsString
 * Use of several methods side by side
 */
router.get("/compare", handle("compare", async (req, res) => {
  const signatures = (req.query.signatures || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (signatures.length < 2) {
    return res.status(400).json({ error: "At least 2 signatures required for comparison" });
  }
  const lv = await results.libraryVersion(req, res);
  if (!lv) return;
  const params = { ga: lv.ga, version: lv.version };

  const rows = await results.query(`
    SELECT m.signature, sum(u.caller_classes) AS usage_count, count(DISTINCT u.dependent) AS dependent_count
    FROM uses u JOIN api_methods m USING (library_ga, version, api_id)
    WHERE u.library_ga = $ga AND u.version = $version
      AND list_contains(string_split($signatures, ','), m.signature)
    GROUP BY m.signature`, { ...params, signatures: signatures.join(",") });
  const [{ dependents }] = await results.query(`
    SELECT count(DISTINCT dependent) AS dependents FROM uses
    WHERE library_ga = $ga AND version = $version`, params);

  const found = new Map(rows.map((r) => [r.signature, r]));
  const comparisons = signatures
    .map((signature) => {
      const r = found.get(signature) || { usage_count: 0, dependent_count: 0 };
      return {
        signature,
        usageCount: r.usage_count,
        dependentCount: r.dependent_count,
        adoptionRate: dependents > 0 ? ((r.dependent_count / dependents) * 100).toFixed(2) : "0.00",
      };
    })
    .sort((a, b) => b.usageCount - a.usageCount);

  res.json({
    library: req.query.library,
    version: lv.version,
    totalMethods: comparisons.length,
    comparisons,
    winner: comparisons[0],
    summary: {
      message: `Most popular: ${comparisons[0].signature} with ${comparisons[0].usageCount} uses across ${comparisons[0].dependentCount} dependents`,
    },
  });
}));

module.exports = router;
