const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const router = express.Router();


// ====================================================================
// DATASET PATH CONFIGURATION
// In Docker: /data/dataset (mounted from user's dataset folder)
// In local dev: fallback path
// ====================================================================
const DATASET_ROOT = process.env.DATASET_PATH ||
  path.resolve(__dirname, "../../../../data/dataset");

console.log(`[INFO] Dataset root: ${DATASET_ROOT}`);

// Helper to build paths inside dataset
const getDatasetPath = (...parts) => path.join(DATASET_ROOT, ...parts);



/**
 * ====================================================================
 * EXISTING ROUTE (unchanged): /api/analysis/usage
 * ====================================================================
 */
router.get("/usage", async (req, res) => {
  try {
    const { library, version, top = 10 } = req.query;

    if (!library || !version) {
      return res
        .status(400)
        .json({ error: "Both library and version parameters are required" });
    }

    // Build path dynamically using library + version
    // const analysisDir = path.resolve(
    //   `../../AutomatedJarDownload/Dataset/StaticAnaResults/${library}-${version}`
    // );

    const analysisDir = getDatasetPath('StaticAnaResults', `${library}-${version}`);

    const analysisFile = path.join(analysisDir, "analysis_summary.csv");

    if (!fs.existsSync(analysisFile)) {
      return res.status(404).json({
        error: `Analysis file not found for ${library}-${version}`,
        path: analysisFile,
      });
    }

    const records = [];

    fs.createReadStream(analysisFile)
      .pipe(csv())
      .on("data", (row) => {
        const jar = row.JarFile || "Unknown";
        const usage = parseInt(row.UniqueThirdPartyUsages) || 0;
        records.push({
          dependent: jar,
          apisUsed: usage,
        });
      })
      .on("end", () => {
        if (records.length === 0) {
          return res
            .status(404)
            .json({ error: "No records found in analysis CSV" });
        }

        console.log(`Reading analysis file: ${analysisFile}`);

        const values = records.map((r) => r.apisUsed);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const median =
          sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];
        const max = Math.max(...values);

        const topDependents = records
          .sort((a, b) => b.apisUsed - a.apisUsed)
          .slice(0, top);

        res.json({ mean, median, max, topDependents });
      });
  } catch (err) {
    console.error("Error reading analysis:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * Tries to match a used API signature against available API signatures with format normalization.
 * 
 * Why this is needed:
 * - Available APIs use SimpleSignature format from extraction (e.g., "com.foo.Bar.Bar" for constructors)
 * - Dependent usage comes from parseUsage() which may use different formats (e.g., "com.foo.Bar" for class refs)
 * - Constructors especially have inconsistent formats across different sources
 * 
 * Handles these cases:
 * 1. Class references that should match constructors:
 *    Input: "com.fasterxml.jackson.databind.ObjectMapper"
 *    Tries: "com.fasterxml.jackson.databind.ObjectMapper.com.fasterxml.jackson.databind.ObjectMapper" (full double path)
 *           "com.fasterxml.jackson.databind.ObjectMapper.ObjectMapper" (simple double path)
 * 
 * 2. Already doubled formats being simplified:
 *    Input: "com.foo.Bar.com.foo.Bar"
 *    Tries: "com.foo.Bar" (simplified)
 * 
 * @param {string} usedApi - The API signature from dependent usage (via parseUsage)
 * @param {Map} availableMap - Map of available API signatures (SimpleSignature -> API details)
 * @returns {string|null} - The matched key from availableMap, or null if no match found
 */

function tryMatchSignature(usedApi, availableMap) {
  // Direct match
  if (availableMap.has(usedApi)) {
    return usedApi;
  }

  const parts = usedApi.split('.');
  if (parts.length < 2) return null;

  const alternatives = [];
  const lastPart = parts[parts.length - 1];

  // For class references (like ObjectMapper), try constructor format
  // Input: com.fasterxml.jackson.databind.ObjectMapper
  // Try: com.fasterxml.jackson.databind.ObjectMapper.com.fasterxml.jackson.databind.ObjectMapper
  if (lastPart[0] === lastPart[0].toUpperCase()) {
    alternatives.push(usedApi + '.' + usedApi);
  }

  // Also try the simpler ClassName.ClassName format
  alternatives.push(usedApi + '.' + lastPart);

  // If it already has the double format, try the simple format
  if (usedApi.includes(usedApi.substring(0, usedApi.lastIndexOf('.')))) {
    const simplified = usedApi.substring(0, usedApi.lastIndexOf('.'));
    alternatives.push(simplified);
  }

  // Try all alternatives
  for (const alt of alternatives) {
    if (availableMap.has(alt)) {
      return alt;
    }
  }

  return null;
}

/**
 * ====================================================================
 * NEW ROUTE 1: /api/analysisV2/dependent-details
 * GET http://localhost:5050/api/analysisV2/dependent-details?library=jackson-databind&version=2.17.2&dependent=com_amazonaws-jmespath-java-1.12.769.jar
 * ====================================================================
 * Get detailed API usage info for a specific dependent.
 */

// function parseUsage(usageStr) {
//   if (!usageStr) return { package: "", class: "", method: "", methodFull: "" };
//   const cleaned = usageStr.split(":")[0].trim();
//   const parts = cleaned.split(".");
//   if (parts.length < 2) return { package: "", class: "", method: "", methodFull: cleaned };

//   const method = parts.pop();
//   const className = parts.pop();
//   const pkg = parts.join(".");
//   const methodFull = cleaned;

//   return { package: pkg, class: className, method, methodFull };
// }



function parseUsage(usageStr) {
  if (!usageStr) return { package: "", class: "", method: "", methodFull: "" };
  
  const cleaned = usageStr.split(" : ")[0].trim();
  const parts = cleaned.split(".");
  
  if (parts.length < 2) {
    return { package: "", class: "", method: "", methodFull: cleaned };
  }

  const method = parts.pop();
  const className = parts.pop();
  const pkg = parts.join(".");
  const fullyQualifiedClass = pkg ? `${pkg}.${className}` : className;
  const methodFull = cleaned;

  return { 
    package: pkg, 
    class: fullyQualifiedClass,
    method, 
    methodFull 
  };
}


// router.get("/dependent-details", async (req, res) => {
//   try {
//     const { library, version, dependent } = req.query;

//     // Validate query params
//     if (!library || !version || !dependent) {
//       return res.status(400).json({
//         error: "library, version, and dependent parameters are required",
//       });
//     }

//     // remove '.jar' extension if present in dependent name
//     const depBase = dependent.replace(/\.jar$/, "");

    

//     const depFile = getDatasetPath(
//       'StaticAnaResults',
//       `${library}-${version}`,
//       'Dependents',
//       `${depBase}_third_party_calls.csv`
//     );

//     // Check if file exists
//     if (!fs.existsSync(depFile)) {
//       console.warn(`CSV not found: ${depFile}`);
//       return res.status(404).json({
//         error: `Dependent CSV not found for ${dependent}`,
//         path: depFile,
//       });
//     }

//     console.log(`Reading dependent CSV: ${depFile}`);

//     // Initialize data holders
//     const packages = new Set();
//     const classes = new Set();
//     const methods = new Set();
//     const methodsFull = new Set();
//     const categories = {};
//     const details = [];

//     // Stream read the CSV
//     fs.createReadStream(depFile)
//       .pipe(csv())
//       .on("data", (row) => {
//         // FIX: Include methodFull in destructuring
//         const { package: pkg, class: cls, method, methodFull } = parseUsage(row.Usage);

//         if (pkg) packages.add(pkg);
//         if (cls) classes.add(cls);
//         if (method) methods.add(method);
//         if (methodFull) methodsFull.add(methodFull); // Now methodFull is defined

//         const category = row.Category?.trim() || "UNKNOWN";
//         categories[category] = (categories[category] || 0) + 1;

//         details.push({
//           caller: row.CallerClass,
//           usage: row.Usage,
//           category,
//           package: pkg,
//           class: cls,
//           method,
//           methodFull
//         });
//       })
//       .on("end", () => {
//         console.log(` Processed ${details.length} rows from ${depBase}`);

//         // Send response
//         res.json({
//           dependent,
//           totalCalls: details.length,
//           uniquePackages: packages.size,
//           uniqueClasses: classes.size,
//           uniqueMethods: methods.size,
//           uniqueMethodsFull: methodsFull.size, // Also add this to response
//           categoryDistribution: categories,
//           details,
//         });
//       })
//       .on("error", (err) => {
//         console.error(" CSV reading error:", err);
//         res.status(500).json({ error: "Failed to parse dependent CSV." });
//       });
//   } catch (err) {
//     console.error(" Error reading dependent details:", err);
//     res.status(500).json({ error: err.message });
//   }
// });



router.get("/dependent-details", async (req, res) => {
  try {
    const { library, version, dependent } = req.query;

    // Validate query params
    if (!library || !version || !dependent) {
      return res.status(400).json({
        error: "library, version, and dependent parameters are required",
      });
    }

    // remove '.jar' extension if present in dependent name
    const depBase = dependent.replace(/\.jar$/, "");

    const depFile = getDatasetPath(
      'StaticAnaResults',
      `${library}-${version}`,
      'Dependents',
      `${depBase}_third_party_calls.csv`
    );

    // Check if file exists
    if (!fs.existsSync(depFile)) {
      console.warn(`CSV not found: ${depFile}`);
      return res.status(404).json({
        error: `Dependent CSV not found for ${dependent}`,
        path: depFile,
      });
    }

    console.log(`Reading dependent CSV: ${depFile}`);

    // Define library package prefixes
    const libraryPrefixes = {
      'jackson-databind': 'com.fasterxml.jackson.databind',
      'commons-codec': 'org.apache.commons.codec'
    };

    const libraryPrefix = libraryPrefixes[library] || library;

    // Initialize data holders
    const packages = new Set();
    const classes = new Set();
    const methods = new Set();
    const methodsFull = new Set();
    const categories = {};
    const details = [];

    // Stream read the CSV
    fs.createReadStream(depFile)
      .pipe(csv())
      .on("data", (row) => {
        const { package: pkg, class: cls, method, methodFull } = parseUsage(row.Usage);

        // Only count if it belongs to the target library
        const belongsToLibrary = pkg && pkg.startsWith(libraryPrefix);

        if (belongsToLibrary) {
          packages.add(pkg);
          if (cls) classes.add(cls);
          if (method) methods.add(method);
          if (methodFull) methodsFull.add(methodFull);
        }

        const category = row.Category?.trim() || "UNKNOWN";
        categories[category] = (categories[category] || 0) + 1;

        details.push({
          caller: row.CallerClass,
          usage: row.Usage,
          category,
          package: pkg,
          class: cls,
          method,
          methodFull,
          belongsToLibrary // Add this flag so frontend knows which entries are library calls
        });
      })
      .on("end", () => {
        console.log(`Processed ${details.length} rows from ${depBase}`);

        // Send response
        res.json({
          dependent,
          totalCalls: details.length,
          uniquePackages: packages.size,
          uniqueClasses: classes.size,
          uniqueMethods: methods.size,
          uniqueMethodsFull: methodsFull.size,
          categoryDistribution: categories,
          details,
        });
      })
      .on("error", (err) => {
        console.error(" CSV reading error:", err);
        res.status(500).json({ error: "Failed to parse dependent CSV." });
      });
  } catch (err) {
    console.error(" Error reading dependent details:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * ====================================================================
 * NEW ROUTE 2: /api/analysis/maintainer-summary
 * GET API
 * http://localhost:5050/api/analysisV2/maintainer-summary?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Aggregates all dependents’ data and computes package/class/method usage
 */


router.get("/maintainer-summary", async (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version) {
      return res
        .status(400)
        .json({ error: "library and version parameters are required" });
    }

    const baseDir = getDatasetPath('StaticAnaResults', `${library}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ error: "Dependents folder not found" });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    // Define library package prefixes
    const libraryPrefixes = {
      'jackson-databind': 'com.fasterxml.jackson.databind',
      'commons-codec': 'org.apache.commons.codec'
    };

    const libraryPrefix = libraryPrefixes[library] || library;

    const allPackages = new Set();
    const allClasses = new Set();
    const allMethods = new Set();
    const categoryTotals = {};
    const methodStats = {};

    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve, reject) => {
        const filePath = path.join(baseDir, file);
        const methodsInThisDependent = new Set();
        const methodCountInThisFile = {};

        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (row) => {
            const category = row.Category?.trim() || "UNKNOWN";
            categoryTotals[category] = (categoryTotals[category] || 0) + 1;

            const { package: pkg, class: cls, method, methodFull } = parseUsage(row.Usage);

            // Only count if it belongs to the target library
            const belongsToLibrary = pkg && pkg.startsWith(libraryPrefix);

            if (belongsToLibrary) {
              allPackages.add(pkg);
              if (cls && cls.trim()) allClasses.add(cls);
              if (methodFull && methodFull.trim()) {
                allMethods.add(methodFull);
                methodsInThisDependent.add(methodFull);
                methodCountInThisFile[methodFull] = (methodCountInThisFile[methodFull] || 0) + 1;
              }
            }
          })
          .on("end", () => {
            methodsInThisDependent.forEach((methodFull) => {
              if (!methodStats[methodFull]) {
                methodStats[methodFull] = {
                  totalUsageCount: 0,
                  dependentCount: 0
                };
              }
              methodStats[methodFull].dependentCount++;
              methodStats[methodFull].totalUsageCount += methodCountInThisFile[methodFull];
            });
            resolve();
          })
          .on("error", (err) => {
            reject(err);
          });
      });
    });

    await Promise.all(filePromises);

    const topMethods = Object.entries(methodStats)
      .sort((a, b) => b[1].dependentCount - a[1].dependentCount)
      .slice(0, 15)
      .map(([methodFull, stats]) => ({
        methodFull,
        dependentCount: stats.dependentCount,
        totalUsageCount: stats.totalUsageCount
      }));

    res.json({
      library,
      version,
      totalDependents: dependentFiles.length,
      uniquePackages: allPackages.size,
      uniqueClasses: allClasses.size,
      uniqueMethods: allMethods.size,
      categoryDistribution: categoryTotals,
      topMethods,
    });

  } catch (err) {
    console.error("Error aggregating maintainer summary:", err);
    res.status(500).json({ error: err.message });
  }
});



/**
 * ====================================================================
 * NEW ROUTE: /api/analysisV2/usage-intensity
 * GET API
 * http://localhost:5050/api/analysisV2/usage-intensity?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Shows distribution of how deeply dependents integrate (light/medium/heavy users)
 */
router.get("/usage-intensity", async (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version) {
      return res.status(400).json({ error: "library and version parameters are required" });
    }

    // const summaryFile = path.resolve(
    //   `../../AutomatedJarDownload/Dataset/StaticAnaResults/${library}-${version}/analysis_summary.csv`
    // );

    const summaryFile = getDatasetPath('StaticAnaResults', `${library}-${version}`, 'analysis_summary.csv');

    if (!fs.existsSync(summaryFile)) {
      return res.status(404).json({ error: "Analysis summary not found" });
    }

    const intensityData = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(summaryFile)
        .pipe(csv())
        .on("data", (row) => {
          const jarFile = row.JarFile;
          const usageCount = parseInt(row.UniqueThirdPartyUsages) || 0;

          if (jarFile && usageCount > 0) {
            intensityData.push({
              jarFile,
              usageCount
            });
          }
        })
        .on("end", resolve)
        .on("error", reject);
    });

    // Sort by usage count
    intensityData.sort((a, b) => b.usageCount - a.usageCount);

    // Calculate distribution buckets
    const light = intensityData.filter(d => d.usageCount <= 10).length;
    const medium = intensityData.filter(d => d.usageCount > 10 && d.usageCount <= 50).length;
    const heavy = intensityData.filter(d => d.usageCount > 50 && d.usageCount <= 200).length;
    const veryHeavy = intensityData.filter(d => d.usageCount > 200).length;

    // Calculate stats
    const mean = intensityData.reduce((sum, d) => sum + d.usageCount, 0) / intensityData.length;
    const median = intensityData[Math.floor(intensityData.length / 2)]?.usageCount || 0;

    res.json({
      library,
      version,
      distribution: {
        "Light (1-10 APIs)": light,
        "Medium (11-50 APIs)": medium,
        "Heavy (51-200 APIs)": heavy,
        "Very Heavy (200+ APIs)": veryHeavy
      },
      topHeavyUsers: intensityData.slice(0, 20),
      stats: {
        mean: parseFloat(mean.toFixed(2)),
        median,
        max: intensityData[0]?.usageCount || 0,
        min: intensityData[intensityData.length - 1]?.usageCount || 0
      }
    });
  } catch (err) {
    console.error("Error fetching usage intensity:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * ====================================================================
 * NEW ROUTE: /api/analysisV2/package-heatmap
 * GET API
 * http://localhost:5050/api/analysisV2/package-heatmap?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Shows which packages and classes are most frequently used across dependents
 */
router.get("/package-heatmap", async (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version) {
      return res.status(400).json({ error: "library and version parameters are required" });
    }

    const baseDir = getDatasetPath('StaticAnaResults', `${library}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ error: "Dependents folder not found" });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    // Define library package prefixes, TODO: WE NEED TO REMOVE THIS HARDCODING
    const libraryPrefixes = {
      'jackson-databind': 'com.fasterxml.jackson.databind',
      'commons-codec': 'org.apache.commons.codec'
    };

    const libraryPrefix = libraryPrefixes[library] || library;

    const packageUsage = {};
    const classUsage = {};
    const packageDependents = {}; // Track which dependents use each package
    const classDependents = {}; // Track which dependents use each class

    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve, reject) => {
        const filePath = path.join(baseDir, file);
        const packagesInThisFile = new Set();
        const classesInThisFile = new Set();

        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (row) => {
            const usage = row.Usage;
            if (!usage) return;

            const cleaned = usage.split(":")[0].trim();
            const parts = cleaned.split(".");

            if (parts.length >= 2) {
              const method = parts.pop();
              const className = parts.pop();
              const pkg = parts.join(".");

              // Only count if it belongs to the target library
              const belongsToLibrary = pkg && pkg.startsWith(libraryPrefix);

              if (belongsToLibrary) {
                if (pkg) {
                  packageUsage[pkg] = (packageUsage[pkg] || 0) + 1;
                  packagesInThisFile.add(pkg);
                }

                if (className && pkg) {
                  const fullClass = pkg + "." + className;
                  classUsage[fullClass] = (classUsage[fullClass] || 0) + 1;
                  classesInThisFile.add(fullClass);
                }
              }
            }
          })
          .on("end", () => {
            // Count dependents for each package
            packagesInThisFile.forEach(pkg => {
              packageDependents[pkg] = (packageDependents[pkg] || 0) + 1;
            });

            // Count dependents for each class
            classesInThisFile.forEach(cls => {
              classDependents[cls] = (classDependents[cls] || 0) + 1;
            });

            resolve();
          })
          .on("error", reject);
      });
    });

    await Promise.all(filePromises);

    const topPackages = Object.entries(packageUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({
        name,
        totalUsage: count,
        dependentCount: packageDependents[name] || 0
      }));

    const topClasses = Object.entries(classUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({
        name,
        totalUsage: count,
        dependentCount: classDependents[name] || 0
      }));

    res.json({
      library,
      version,
      topPackages,
      topClasses,
      totalPackages: Object.keys(packageUsage).length,
      totalClasses: Object.keys(classUsage).length
    });
  } catch (err) {
    console.error("Error generating package heatmap:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * ====================================================================
 * ENHANCED ROUTE: /api/analysisV2/maintainer-summary (with category breakdown)
 * GET API
 * http://localhost:5050/api/analysisV2/maintainer-summary?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Enhanced to include category breakdown per method
 */
router.get("/maintainer-summary-enhanced", async (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version) {
      return res
        .status(400)
        .json({ error: "library and version parameters are required" });
    }

    // const baseDir = path.resolve(
    //   `../../AutomatedJarDownload/Dataset/StaticAnaResults/${library}-${version}/Dependents`
    // );

    const baseDir = getDatasetPath('StaticAnaResults', `${library}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ error: "Dependents folder not found" });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    const allPackages = new Set();
    const allClasses = new Set();
    const allMethods = new Set();
    const categoryTotals = {};
    const methodStats = {};

    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve, reject) => {
        const filePath = path.join(baseDir, file);
        const methodsInThisDependent = new Set();
        const methodCountInThisFile = {};

        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (row) => {
            const category = row.Category || "UNKNOWN";
            const { package: pkg, class: cls, method, methodFull } = parseUsage(row.Usage);
            

            if (pkg) allPackages.add(pkg);
            if (cls) allClasses.add(cls);
            if (methodFull) {
              allMethods.add(methodFull);
              methodsInThisDependent.add(methodFull);

              // Initialize method stats if needed
              if (!methodStats[methodFull]) {
                methodStats[methodFull] = {
                  totalUsageCount: 0,
                  dependentCount: 0,
                  categoryBreakdown: {}
                };
              }

              // Track category breakdown
              if (!methodStats[methodFull].categoryBreakdown[category]) {
                methodStats[methodFull].categoryBreakdown[category] = 0;
              }
              methodStats[methodFull].categoryBreakdown[category]++;

              methodCountInThisFile[methodFull] = (methodCountInThisFile[methodFull] || 0) + 1;
            }
            categoryTotals[category] = (categoryTotals[category] || 0) + 1;
          })
          .on("end", () => {
            methodsInThisDependent.forEach((methodFull) => {
              methodStats[methodFull].dependentCount++;
              methodStats[methodFull].totalUsageCount += methodCountInThisFile[methodFull];
            });
            resolve();
          })
          .on("error", reject);
      });
    });

    await Promise.all(filePromises);

    const topMethods = Object.entries(methodStats)
      .sort((a, b) => b[1].dependentCount - a[1].dependentCount)
      .slice(0, 15)
      .map(([methodFull, stats]) => ({
        methodFull,
        dependentCount: stats.dependentCount,
        totalUsageCount: stats.totalUsageCount,
        categoryBreakdown: stats.categoryBreakdown
      }));

    res.json({
      library,
      version,
      totalDependents: dependentFiles.length,
      uniquePackages: allPackages.size,
      uniqueClasses: allClasses.size,
      uniqueMethods: allMethods.size,
      categoryDistribution: categoryTotals,
      topMethods,
    });

  } catch (err) {
    console.error("Error aggregating maintainer summary:", err);
    res.status(500).json({ error: err.message });
  }
});



/**
 * ====================================================================
 * Another extension of the maintainer view
 * * ====================================================================
 */

/**
 * ====================================================================
 * ROUTE: /api/analysisV2/api-surface-usage
 * GET API
 * http://localhost:5050/api/analysisV2/api-surface-usage?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Compare available APIs vs used APIs to show API surface usage
 * NOTE: Requires that extraction has been run offline first
 */
router.get("/api-surface-usage", async (req, res) => {
  try {
    const { library, version } = req.query;

    if (!library || !version) {
      return res.status(400).json({ error: "library and version are required" });
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;



    const availableCsvPath = getDatasetPath('LibraryJars', `${cleanLibrary}-${version}_available_apis.csv`);

    if (!fs.existsSync(availableCsvPath)) {
      return res.status(404).json({
        error: `Available APIs not found for ${cleanLibrary}-${version}. Please run the extraction script first.`,
        needsExtraction: true,
        searchedPath: availableCsvPath,
        instructions: "Run: cd AutomatedJarDownload && ./ExtractDetailsFromJar.sh"
      });
    }

    console.log(`Reading available APIs from: ${availableCsvPath}`);

    // Store both signatures for each API
    const availableApisMap = new Map(); // SimpleSignature -> { fullSignature, methodDescriptor }
    const availableSimpleSignatures = new Set();

    await new Promise((resolve, reject) => {
      fs.createReadStream(availableCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature && row.FullSignature) {
            const simpleSignature = row.SimpleSignature.trim();
            const fullSignature = row.FullSignature.trim();

            availableSimpleSignatures.add(simpleSignature);

            // Store full details (for overloaded methods, we'll aggregate)
            if (!availableApisMap.has(simpleSignature)) {
              availableApisMap.set(simpleSignature, {
                package: row.Package,
                class: row.Class,
                method: row.Method,
                simpleSignature: simpleSignature,
                overloads: []
              });
            }

            availableApisMap.get(simpleSignature).overloads.push({
              fullSignature: fullSignature,
              methodDescriptor: row.MethodDescriptor
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const totalAvailableApis = availableApisMap.size;
    const totalOverloads = [...availableApisMap.values()].reduce((sum, api) => sum + api.overloads.length, 0);

    console.log(`Total available APIs (unique methods): ${totalAvailableApis}`);
    console.log(`Total overloads: ${totalOverloads}`);


    const baseDir = getDatasetPath('StaticAnaResults', `${cleanLibrary}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({
        error: "Dependents folder not found",
        searchedPath: baseDir
      });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    console.log(`Processing ${dependentFiles.length} dependent files...`);

    const usedApis = new Set(); // These don't have parameter info

    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve) => {
        const filePath = path.join(baseDir, file);

        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            const { methodFull } = parseUsage(row.Usage);
            if (methodFull) {
              usedApis.add(methodFull.trim());
            }
          })
          .on('end', resolve)
          .on('error', (err) => {
            console.error(`Error reading ${file}:`, err);
            resolve();
          });
      });
    });

    await Promise.all(filePromises);

    console.log(`Total used APIs: ${usedApis.size}`);

    // 3. Calculate usage by matching on SimpleSignature
    const usedFromAvailable = [];
    const unusedApis = [];

    // First, find which available APIs are matched by used APIs
    const matchedAvailableSignatures = new Set();

    for (const usedApi of usedApis) {
      const matched = tryMatchSignature(usedApi, availableApisMap);
      if (matched) {
        matchedAvailableSignatures.add(matched);
      }
    }

    // Now categorize available APIs
    for (const [simpleSignature, apiInfo] of availableApisMap.entries()) {
      if (matchedAvailableSignatures.has(simpleSignature)) {
        usedFromAvailable.push({
          ...apiInfo,
          overloadCount: apiInfo.overloads.length
        });
      } else {
        unusedApis.push({
          ...apiInfo,
          overloadCount: apiInfo.overloads.length
        });
      }
    }



    const usagePercentage = totalAvailableApis > 0
      ? ((usedFromAvailable.length / totalAvailableApis) * 100).toFixed(2)
      : 0;

    console.log(`Usage: ${usedFromAvailable.length}/${totalAvailableApis} = ${usagePercentage}%`);

    res.json({
      library,
      version,
      totalAvailableApis: totalAvailableApis,
      totalAvailableOverloads: totalOverloads,
      totalUsedApis: usedFromAvailable.length,
      totalUnusedApis: unusedApis.length,
      totalDependentsAnalyzed: dependentFiles.length,
      usagePercentage: parseFloat(usagePercentage),
      topUnusedApis: unusedApis.slice(0, 50).map(api => ({
        signature: api.simpleSignature,
        package: api.package,
        class: api.class,
        method: api.method,
        overloadCount: api.overloadCount
      })),
      topUsedApis: usedFromAvailable.slice(0, 50).map(api => ({
        signature: api.simpleSignature,
        package: api.package,
        class: api.class,
        method: api.method,
        overloadCount: api.overloadCount
      })),
      summary: {
        message: `${usagePercentage}% of your library's available APIs are being used by ${dependentFiles.length} dependents`,
        note: `Methods with multiple overloads are counted as one API. Total overloads: ${totalOverloads}`
      }
    });

  } catch (err) {
    console.error("Error calculating API surface usage:", err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});



/**
 * ====================================================================
 * ROUTE: /api/analysisV2/used-api-test-coverage
 * ====================================================================
 */
router.get("/used-api-test-coverage", async (req, res) => {
  try {
    const { library, version } = req.query;

    if (!library || !version) {
      return res.status(400).json({ error: "library and version are required" });
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;


    const coverageXmlPath = getDatasetPath('TestCoverage', `${cleanLibrary}-${version}_coverage.xml`);

    let overallProjectCoverage = 0;
    let totalProjectInstructions = 0;
    let coveredProjectInstructions = 0;

    if (fs.existsSync(coverageXmlPath)) {
      const xml2js = require('xml2js');
      const xmlContent = fs.readFileSync(coverageXmlPath, 'utf8');

      xml2js.parseString(xmlContent, (err, result) => {
        if (!err && result.report && result.report.counter) {
          // Find the INSTRUCTION counter at the report level (overall project)
          const instructionCounter = result.report.counter.find(c => c.$.type === 'INSTRUCTION');
          if (instructionCounter) {
            coveredProjectInstructions = parseInt(instructionCounter.$.covered) || 0;
            totalProjectInstructions = coveredProjectInstructions + (parseInt(instructionCounter.$.missed) || 0);

            if (totalProjectInstructions > 0) {
              overallProjectCoverage = ((coveredProjectInstructions / totalProjectInstructions) * 100).toFixed(2);
            }
          }
        }
      });
    }

    console.log(`Overall Project Coverage: ${overallProjectCoverage}% (${coveredProjectInstructions}/${totalProjectInstructions} instructions)`);

    const availableCsvPath = getDatasetPath('LibraryJars', `${cleanLibrary}-${version}_available_apis.csv`);

    if (!fs.existsSync(availableCsvPath)) {
      return res.status(404).json({
        error: "Available APIs not found. Run extraction first."
      });
    }

    const availableApisMap = new Map();
    await new Promise((resolve, reject) => {
      fs.createReadStream(availableCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature) {
            const simpleSignature = row.SimpleSignature.trim();
            if (!availableApisMap.has(simpleSignature)) {
              availableApisMap.set(simpleSignature, {
                package: row.Package,
                class: row.Class,
                method: row.Method,
                simpleSignature: simpleSignature
              });
            }
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const baseDir = getDatasetPath('StaticAnaResults', `${cleanLibrary}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ error: "Dependents folder not found" });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    const usedApisSet = new Set();
    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve) => {
        const filePath = path.join(baseDir, file);

        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            const { methodFull } = parseUsage(row.Usage);
            if (methodFull) {
              const trimmed = methodFull.trim();
              if (availableApisMap.has(trimmed)) {
                usedApisSet.add(trimmed);
              }
            }
          })
          .on('end', resolve)
          .on('error', resolve);
      });
    });

    await Promise.all(filePromises);

    const totalUsedApis = usedApisSet.size;
    console.log(`Total UNIQUE used APIs: ${totalUsedApis}`);


    const coverageCsvPath = getDatasetPath('TestCoverage', `${cleanLibrary}-${version}_all_apis_coverage.csv`);

    if (!fs.existsSync(coverageCsvPath)) {
      return res.status(404).json({
        error: "Coverage data not found. Run pipeline first.",
        instructions: "cd AutomatedJarDownload && python scripts/run_pipeline.py"
      });
    }

    const coverageMap = new Map();
    await new Promise((resolve, reject) => {
      fs.createReadStream(coverageCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature) {
            const sig = row.SimpleSignature.trim();
            if (!coverageMap.has(sig)) {
              coverageMap.set(sig, {
                package: row.Package,
                class: row.Class,
                method: row.Method,
                instructionCovered: parseInt(row.INSTRUCTION_COVERED) || 0,
                instructionMissed: parseInt(row.INSTRUCTION_MISSED) || 0,
                isCovered: (parseInt(row.INSTRUCTION_COVERED) || 0) > 0
              });
            } else {
              const existing = coverageMap.get(sig);
              existing.instructionCovered += parseInt(row.INSTRUCTION_COVERED) || 0;
              existing.instructionMissed += parseInt(row.INSTRUCTION_MISSED) || 0;
              existing.isCovered = existing.instructionCovered > 0;
            }
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 5. Match used APIs with coverage
    const apiDetails = [];
    const coveredApis = [];
    const notCoveredApis = [];
    const notFoundApis = [];

    usedApisSet.forEach(api => {
      // const coverage = coverageMap.get(api);
      // const apiInfo = availableApisMap.get(api);

      // Try to find in availableApisMap with matching
      const matchedAvailableKey = tryMatchSignature(api, availableApisMap);
      const apiInfo = matchedAvailableKey ? availableApisMap.get(matchedAvailableKey) : null;

      // Try to find in coverageMap - use the SAME key we found in availableMap if possible
      let coverage = coverageMap.get(api);
      if (!coverage && matchedAvailableKey) {
        coverage = coverageMap.get(matchedAvailableKey);
      }
      if (!coverage) {
        const matchedCoverageKey = tryMatchSignature(api, coverageMap);
        coverage = matchedCoverageKey ? coverageMap.get(matchedCoverageKey) : null;
      }

      if (coverage) {

        const detail = {
          ...apiInfo,
          ...coverage
        };
        apiDetails.push(detail);

        if (coverage.isCovered) {
          coveredApis.push(detail);
        } else {
          notCoveredApis.push(detail);
        }
      } else {
        notFoundApis.push(apiInfo);
      }
    });



    // 6. Calculate metrics
    const coveredCount = coveredApis.length;
    const notCoveredCount = notCoveredApis.length;
    const notFoundCount = notFoundApis.length;

    const usageBasedCoverage = totalUsedApis > 0
      ? ((coveredCount / totalUsedApis) * 100).toFixed(2)
      : 0;

    console.log(`Usage-Based Coverage: ${coveredCount}/${totalUsedApis} = ${usageBasedCoverage}%`);

    // 7. Calculate impact
    const potentialUsageBasedCoverage = 100.00; // If all used APIs had tests
    const usageBasedCoverageGain = (potentialUsageBasedCoverage - parseFloat(usageBasedCoverage)).toFixed(2);

    // Calculate impact on overall project coverage
    const missedInstructionsFromUncovered = notCoveredApis.reduce((sum, api) =>
      sum + (api.instructionMissed || 0), 0
    );

    const potentialProjectInstructions = coveredProjectInstructions + missedInstructionsFromUncovered;
    const potentialProjectCoverage = totalProjectInstructions > 0
      ? ((potentialProjectInstructions / totalProjectInstructions) * 100).toFixed(2)
      : 0;

    const projectCoverageGain = (parseFloat(potentialProjectCoverage) - parseFloat(overallProjectCoverage)).toFixed(2);

    // 8. Determine interpretation
    const coverageDiff = parseFloat(usageBasedCoverage) - parseFloat(overallProjectCoverage);
    let interpretation;

    if (Math.abs(coverageDiff) < 1) {
      interpretation = "Used APIs have similar coverage to overall project - well balanced!";
    } else if (coverageDiff < 0) {
      interpretation = "Used APIs have lower coverage than overall project - could prioritize testing these!";
    } else {
      interpretation = "Used APIs have better coverage than overall project - great job!";
    }

    res.json({
      library,
      version,

      totalUsedApis,
      coveredByTests: coveredCount,
      notCoveredByTests: notCoveredCount,
      notFoundInCoverage: notFoundCount,

      usageBasedCoverage: parseFloat(usageBasedCoverage),
      overallProjectCoverage: parseFloat(overallProjectCoverage),

      summary: {
        totalDependents: dependentFiles.length,
        mainMessage: `${usageBasedCoverage}% of APIs used by dependents have test coverage`,
        comparisonMessage: `Overall project test coverage is ${overallProjectCoverage}%`,
        interpretation: interpretation,
        note: `Out of ${totalUsedApis} APIs used by ${dependentFiles.length} dependents, ${coveredCount} are covered fully or partially by tests`
      },

      impact: {
        potentialUsageBasedCoverage: parseFloat(potentialUsageBasedCoverage),
        usageBasedCoverageGain: parseFloat(usageBasedCoverageGain),
        potentialProjectCoverage: parseFloat(potentialProjectCoverage),
        projectCoverageGain: parseFloat(projectCoverageGain),
        uncoveredInstructionCount: missedInstructionsFromUncovered,
        recommendation: parseFloat(usageBasedCoverageGain) > 0
          ? `Adding tests for ${notCoveredCount} uncovered APIs would increase usage-based coverage to ${potentialUsageBasedCoverage}% (+${usageBasedCoverageGain}%) and overall project coverage to ${potentialProjectCoverage}% (+${projectCoverageGain}%)`
          : "All used APIs already have test coverage! "
      },

      topUncoveredAPIs: notCoveredApis
        .filter(api => api.instructionMissed > 0)   // This is very important filter to filtering out the abstract/interface methods that can't be tested directly. 
        .sort((a, b) => (b.instructionMissed || 0) - (a.instructionMissed || 0))
        .slice(0, 20)
        .map(api => ({
          package: api.package,
          class: api.class,
          method: api.method,
          signature: api.simpleSignature,
          instructionsMissed: api.instructionMissed
        })),

      notFoundAPIs: notFoundApis.slice(0, 20).map(api => ({
        package: api.package,
        class: api.class,
        method: api.method,
        signature: api.simpleSignature
      }))
    });

  } catch (err) {
    console.error("Error analyzing used API test coverage:", err);
    res.status(500).json({ error: err.message });
  }
});



/**
 * ====================================================================
 * ROUTE: /api/analysisV2/community-test-coverage
 * http://localhost:5050/api/analysisV2/community-test-coverage?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Community Test Coverage (CTC): Measures the percentage of dependent 
 * projects where ALL APIs they use are fully covered by the library's tests
 */
router.get("/community-test-coverage", async (req, res) => {
  try {
    const { library, version } = req.query;

    if (!library || !version) {
      return res.status(400).json({ error: "library and version are required" });
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;

    // 1. Get coverage data for all APIs
    // const coverageCsvPath = path.resolve(
    //   __dirname,
    //   '../../../../AutomatedJarDownload/Dataset/TestCoverage',
    //   `${cleanLibrary}-${version}_all_apis_coverage.csv`
    // );

    const coverageCsvPath = getDatasetPath('TestCoverage', `${cleanLibrary}-${version}_all_apis_coverage.csv`);

    if (!fs.existsSync(coverageCsvPath)) {
      return res.status(404).json({
        error: "Coverage data not found. Run pipeline first.",
        instructions: "cd AutomatedJarDownload && python scripts/run_pipeline.py"
      });
    }

    // Build coverage map: SimpleSignature -> coverage info
    const coverageMap = new Map();
    await new Promise((resolve, reject) => {
      fs.createReadStream(coverageCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature) {
            const sig = row.SimpleSignature.trim();
            if (!coverageMap.has(sig)) {
              coverageMap.set(sig, {
                package: row.Package,
                class: row.Class,
                method: row.Method,
                instructionCovered: parseInt(row.INSTRUCTION_COVERED) || 0,
                instructionMissed: parseInt(row.INSTRUCTION_MISSED) || 0,
                isCovered: (parseInt(row.INSTRUCTION_COVERED) || 0) > 0
              });
            } else {
              const existing = coverageMap.get(sig);
              existing.instructionCovered += parseInt(row.INSTRUCTION_COVERED) || 0;
              existing.instructionMissed += parseInt(row.INSTRUCTION_MISSED) || 0;
              existing.isCovered = existing.instructionCovered > 0;
            }
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 2. Get available APIs
    // const availableCsvPath = path.resolve(
    //   __dirname,
    //   '../../../../AutomatedJarDownload/Dataset/LibraryJars',
    //   `${cleanLibrary}-${version}_available_apis.csv`
    // );

    const availableCsvPath = getDatasetPath('LibraryJars', `${cleanLibrary}-${version}_available_apis.csv`);

    if (!fs.existsSync(availableCsvPath)) {
      return res.status(404).json({
        error: "Available APIs not found. Run extraction first."
      });
    }

    const availableApisSet = new Set();
    await new Promise((resolve, reject) => {
      fs.createReadStream(availableCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature) {
            availableApisSet.add(row.SimpleSignature.trim());
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // 3. Analyze each dependent project
    // const baseDir = path.resolve(
    //   __dirname,
    //   '../../../../AutomatedJarDownload/Dataset/StaticAnaResults',
    //   `${cleanLibrary}-${version}/Dependents`
    // );

    const baseDir = getDatasetPath('StaticAnaResults', `${cleanLibrary}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      return res.status(404).json({ error: "Dependents folder not found" });
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    const NPtotal = dependentFiles.length;
    const dependentProjects = [];

    // Analyze each dependent
    for (const file of dependentFiles) {
      const filePath = path.join(baseDir, file);
      const dependentName = file.replace("_third_party_calls.csv", "");

      const usedApis = new Set();

      await new Promise((resolve) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            const { methodFull } = parseUsage(row.Usage);
            if (methodFull) {
              const trimmed = methodFull.trim();
              if (availableApisSet.has(trimmed)) {
                usedApis.add(trimmed);
              }
            }
          })
          .on('end', resolve)
          .on('error', resolve);
      });

      // Check coverage for all APIs used by this dependent
      let totalApis = usedApis.size;
      let coveredApis = 0;
      let uncoveredApis = 0;
      let notFoundApis = 0;
      const uncoveredApisList = [];

      usedApis.forEach(api => {
        const coverage = coverageMap.get(api);
        if (coverage) {
          if (coverage.isCovered) {
            coveredApis++;
          } else {
            uncoveredApis++;
            uncoveredApisList.push({
              signature: api,
              package: coverage.package,
              class: coverage.class,
              method: coverage.method,
              instructionsMissed: coverage.instructionMissed
            });
          }
        } else {
          notFoundApis++;
        }
      });

      const isFullyCovered = uncoveredApis === 0 && notFoundApis === 0 && totalApis > 0;
      const coveragePercentage = totalApis > 0
        ? ((coveredApis / totalApis) * 100).toFixed(2)
        : 0;

      dependentProjects.push({
        name: dependentName,
        totalApisUsed: totalApis,
        coveredApis,
        uncoveredApis,
        notFoundApis,
        coveragePercentage: parseFloat(coveragePercentage),
        isFullyCovered,
        topUncoveredApis: uncoveredApisList
          .sort((a, b) => b.instructionsMissed - a.instructionsMissed)
          .slice(0, 5)
      });
    }

    // 4. Calculate CTC
    const NPFullyCovered = dependentProjects.filter(p => p.isFullyCovered).length;
    const ctcPercentage = NPtotal > 0
      ? ((NPFullyCovered / NPtotal) * 100).toFixed(2)
      : 0;

    // 5. Additional statistics
    const fullyCoveredProjects = dependentProjects.filter(p => p.isFullyCovered);
    const partiallyCoveredProjects = dependentProjects.filter(p =>
      !p.isFullyCovered && p.coveredApis > 0
    );
    const notCoveredProjects = dependentProjects.filter(p =>
      p.coveredApis === 0 && p.totalApisUsed > 0
    );

    // Sort by coverage percentage
    const sortedProjects = [...dependentProjects].sort((a, b) =>
      b.coveragePercentage - a.coveragePercentage
    );

    // Projects with most uncovered APIs
    const projectsNeedingMostWork = [...dependentProjects]
      .filter(p => p.uncoveredApis > 0)
      .sort((a, b) => b.uncoveredApis - a.uncoveredApis)
      .slice(0, 10);

    // Calculate average coverage across all dependents
    const totalCoverageSum = dependentProjects.reduce((sum, p) =>
      sum + p.coveragePercentage, 0
    );
    const averageProjectCoverage = NPtotal > 0
      ? (totalCoverageSum / NPtotal).toFixed(2)
      : 0;

    // 6. Generate interpretation
    let interpretation;
    const ctcValue = parseFloat(ctcPercentage);

    if (ctcValue >= 80) {
      interpretation = "Excellent! Most dependent projects use only well-tested APIs.";
    } else if (ctcValue >= 60) {
      interpretation = "Good coverage, but some dependents rely on untested APIs.";
    } else if (ctcValue >= 40) {
      interpretation = "Moderate coverage. Many dependents use APIs without complete test coverage.";
    } else if (ctcValue >= 20) {
      interpretation = "Low coverage. Most dependents use some untested APIs.";
    } else {
      interpretation = "Critical! Very few dependents use well tested API methods of your library.";
    }

    res.json({
      library,
      version,

      // Core CTC Metric
      communityTestCoverage: parseFloat(ctcPercentage),
      NPFullyCovered,
      NPtotal,

      // Summary
      summary: {
        interpretation,
        mainMessage: `${ctcPercentage}% of dependent projects use only APIs that are fully covered by tests`,
        fullyCoveredCount: NPFullyCovered,
        partiallyCoveredCount: partiallyCoveredProjects.length,
        notCoveredCount: notCoveredProjects.length,
        averageProjectCoverage: parseFloat(averageProjectCoverage)
      },

      // Breakdown by coverage status
      breakdown: {
        fullyCovered: {
          count: NPFullyCovered,
          percentage: parseFloat(ctcPercentage),
          description: "Dependents where ALL used API methods have test coverage"
        },
        partiallyCovered: {
          count: partiallyCoveredProjects.length,
          percentage: NPtotal > 0
            ? ((partiallyCoveredProjects.length / NPtotal) * 100).toFixed(2)
            : 0,
          description: "Dependents where SOME API methods lacking test coverage"
        },
        notCovered: {
          count: notCoveredProjects.length,
          percentage: NPtotal > 0
            ? ((notCoveredProjects.length / NPtotal) * 100).toFixed(2)
            : 0,
          description: "Dependents where NONE of the used API methods have test coverage"
        }
      },

      // Top performers (fully covered projects)
      topPerformers: fullyCoveredProjects
        .sort((a, b) => b.totalApisUsed - a.totalApisUsed)
        .slice(0, 10)
        .map(p => ({
          name: p.name,
          totalApisUsed: p.totalApisUsed,
          coveragePercentage: p.coveragePercentage
        })),

      // Projects needing attention
      projectsNeedingAttention: projectsNeedingMostWork.map(p => ({
        name: p.name,
        totalApisUsed: p.totalApisUsed,
        coveredApis: p.coveredApis,
        uncoveredApis: p.uncoveredApis,
        coveragePercentage: p.coveragePercentage,
        topUncoveredApis: p.topUncoveredApis
      })),

      // Distribution statistics
      distribution: {
        "100% coverage": fullyCoveredProjects.length,
        "80-99% coverage": dependentProjects.filter(p =>
          p.coveragePercentage >= 80 && p.coveragePercentage < 100
        ).length,
        "60-79% coverage": dependentProjects.filter(p =>
          p.coveragePercentage >= 60 && p.coveragePercentage < 80
        ).length,
        "40-59% coverage": dependentProjects.filter(p =>
          p.coveragePercentage >= 40 && p.coveragePercentage < 60
        ).length,
        "20-39% coverage": dependentProjects.filter(p =>
          p.coveragePercentage >= 20 && p.coveragePercentage < 40
        ).length,
        "0-19% coverage": dependentProjects.filter(p =>
          p.coveragePercentage >= 0 && p.coveragePercentage < 20
        ).length
      },

      // All projects detail (optional, can be large)
      allProjects: sortedProjects.map(p => ({
        name: p.name,
        totalApisUsed: p.totalApisUsed,
        coveredApis: p.coveredApis,
        uncoveredApis: p.uncoveredApis,
        coveragePercentage: p.coveragePercentage,
        isFullyCovered: p.isFullyCovered
      }))
    });

  } catch (err) {
    console.error("Error calculating community test coverage:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
