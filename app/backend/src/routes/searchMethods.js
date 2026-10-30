const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const router = express.Router();


const DATASET_ROOT = process.env.DATASET_PATH || 
  path.resolve(__dirname, "../../../../data/dataset");

console.log(`[INFO] Dataset root (searchMethods): ${DATASET_ROOT}`);

// Helper to build paths inside dataset
const getDatasetPath = (...parts) => path.join(DATASET_ROOT, ...parts);

/**
 * ====================================================================
 * CACHING UTILITY FUNCTIONS
 * ====================================================================
 */

const CACHE_DIR = getDatasetPath('CachedAnalytics');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Generate cache file path for an endpoint
 */
function getCachePath(library, version, endpointName, extraParams = {}) {
  const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;
  
  // Create a stable filename from parameters
  let filename = `${cleanLibrary}-${version}_${endpointName}`;
  
  // Add extra params to filename if provided
  if (Object.keys(extraParams).length > 0) {
    const paramString = Object.entries(extraParams)
      .sort(([a], [b]) => a.localeCompare(b)) // Sort for stability
      .map(([key, value]) => `${key}-${value}`)
      .join('_');
    filename += `_${paramString}`;
  }
  
  filename += '.json';
  
  // Sanitize filename (remove special characters)
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  return path.join(CACHE_DIR, filename);
}

/**
 * Load cached data if it exists and is valid
 */
function loadCache(cachePath) {
  try {
    if (fs.existsSync(cachePath)) {
      const data = fs.readFileSync(cachePath, 'utf8');
      const cached = JSON.parse(data);
      
      return {
        data: cached.data,
        timestamp: cached.timestamp,
        exists: true
      };
    }
  } catch (err) {
    console.error('Error loading cache:', err);
  }
  
  return { exists: false };
}

/**
 * Save data to cache
 */
function saveCache(cachePath, data) {
  try {
    const cacheData = {
      data: data,
      timestamp: new Date().toISOString(),
      cachedAt: new Date().toLocaleString()
    };
    
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    console.log(`Cache saved: ${cachePath}`);
    return true;
  } catch (err) {
    console.error('Error saving cache:', err);
    return false;
  }
}

/**
 * Middleware to handle caching
 */
function withCache(endpointName, dataFetcher, getExtraParams = null) {
  return async (req, res) => {
    try {
      const { library, version, recompute } = req.query;
      const shouldRecompute = recompute === 'true' || recompute === '1';
      
      // Get any extra parameters for cache key
      const extraParams = getExtraParams ? getExtraParams(req.query) : {};
      
      // Generate cache path
      const cachePath = getCachePath(library, version, endpointName, extraParams);
      
      // Try to load from cache if not recomputing
      if (!shouldRecompute) {
        const cached = loadCache(cachePath);
        
        if (cached.exists) {
          console.log(`Serving from cache: ${cachePath}`);
          return res.json({
            ...cached.data,
            _metadata: {
              cached: true,
              cachedAt: cached.timestamp,
              message: "Data served from cache. Add ?recompute=true to regenerate."
            }
          });
        }
      }
      
      // Compute fresh data
      console.log(`Computing fresh data for: ${endpointName}`);
      const freshData = await dataFetcher(req, res);
      
      // Save to cache
      saveCache(cachePath, freshData);
      
      // Return with metadata
      res.json({
        ...freshData,
        _metadata: {
          cached: false,
          computedAt: new Date().toISOString(),
          message: "Fresh data computed and cached."
        }
      });
      
    } catch (err) {
      console.error(`Error in ${endpointName}:`, err);
      res.status(500).json({ error: err.message });
    }
  };
}

/**
 * Parse usage string to extract method information
 * Example: "com.fasterxml.jackson.databind.ObjectMapper.readValue(String, Class)"
 */
function parseUsage(usage) {
  if (!usage) return { methodFull: null };
  
  const cleaned = usage.split(":")[0].trim();
  const parts = cleaned.split(".");
  
  if (parts.length >= 2) {
    const methodWithParams = parts.pop();
    const method = methodWithParams.split("(")[0];
    const className = parts.pop();
    const pkg = parts.join(".");
    const methodFull = pkg && className ? `${pkg}.${className}.${method}` : null;
    
    return {
      package: pkg,
      class: className,
      method: method,
      methodFull: methodFull
    };
  }
  
  return { methodFull: null };
}


/**
 * ====================================================================
 * ROUTE: /api/searchMethod/search
 * GET API
 * http://localhost:5050/api/searchMethod/search?library=jackson-databind&version=2.17.2&query=readValue
 * http://localhost:5050/api/searchMethod/search?library=jackson-databind&version=2.17.2&query=readValue&recompute=true
 * ====================================================================
 * Search for API methods by name/pattern - returns matching methods
 * CACHED: Results are cached per query
 */
router.get("/search", withCache(
  "search-methods",
  async (req) => {
    const { library, version, query } = req.query;
    
    if (!library || !version || !query) {
      throw new Error("library, version, and query parameters are required");
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;

    // 1. Get available APIs from extraction
    const availableCsvPath = getDatasetPath('LibraryJars', `${cleanLibrary}-${version}_available_apis.csv`);

    if (!fs.existsSync(availableCsvPath)) {
      throw new Error("Available APIs not found. Run extraction first.");
    }

    const matchingMethods = [];
    const queryLower = query.toLowerCase();

    await new Promise((resolve, reject) => {
      fs.createReadStream(availableCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.Method && row.SimpleSignature) {
            const methodName = row.Method.toLowerCase();
            
            // Match if method name contains the query
            if (methodName.includes(queryLower)) {
              matchingMethods.push({
                methodName: row.Method,
                simpleSignature: row.SimpleSignature,
                fullSignature: row.FullSignature,
                package: row.Package,
                class: row.Class,
                methodDescriptor: row.MethodDescriptor
              });
            }
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    // Group by simple signature (to handle overloads)
    const methodGroups = new Map();
    
    matchingMethods.forEach(method => {
      if (!methodGroups.has(method.simpleSignature)) {
        methodGroups.set(method.simpleSignature, {
          methodName: method.methodName,
          simpleSignature: method.simpleSignature,
          package: method.package,
          class: method.class,
          overloadCount: 0,
          overloads: []
        });
      }
      
      const group = methodGroups.get(method.simpleSignature);
      group.overloadCount++;
      group.overloads.push({
        fullSignature: method.fullSignature,
        methodDescriptor: method.methodDescriptor
      });
    });

    // Convert to array and sort by relevance
    const results = Array.from(methodGroups.values())
      .sort((a, b) => {
        // Exact match first
        const aExact = a.methodName.toLowerCase() === queryLower ? 1 : 0;
        const bExact = b.methodName.toLowerCase() === queryLower ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        
        // Then by method name
        return a.methodName.localeCompare(b.methodName);
      });

    return {
      library,
      version,
      query,
      totalMatches: results.length,
      totalOverloads: matchingMethods.length,
      results: results.map(r => ({
        methodName: r.methodName,
        signature: r.simpleSignature,
        package: r.package,
        class: r.class,
        fullClassName: `${r.package}.${r.class}`,
        overloadCount: r.overloadCount,
        overloads: r.overloads
      }))
    };
  },
  (query) => ({ query: query.query }) // Extra params for cache key
));


/**
 * ====================================================================
 * ROUTE: /api/searchMethod/analytics
 * GET API
 * http://localhost:5050/api/searchMethod/analytics?library=jackson-databind&version=2.17.2&signature=com.fasterxml.jackson.databind.ObjectMapper.readValue
 * http://localhost:5050/api/searchMethod/analytics?library=jackson-databind&version=2.17.2&signature=com.fasterxml.jackson.databind.ObjectMapper.readValue&recompute=true
 * ====================================================================
 * Detailed analytics for a specific API method
 * CACHED: Results are cached per signature
 */
router.get("/analytics", withCache(
  "method-analytics",
  async (req) => {
    const { library, version, signature } = req.query;
    
    if (!library || !version || !signature) {
      throw new Error("library, version, and signature parameters are required");
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;

    // ===== 1. Get method details from available APIs =====
    const availableCsvPath = getDatasetPath('LibraryJars', `${cleanLibrary}-${version}_available_apis.csv`);

    if (!fs.existsSync(availableCsvPath)) {
      throw new Error("Available APIs not found. Run extraction first.");
    }

    let methodInfo = null;
    const overloads = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(availableCsvPath)
        .pipe(csv())
        .on('data', (row) => {
          if (row.SimpleSignature === signature) {
            if (!methodInfo) {
              methodInfo = {
                package: row.Package,
                class: row.Class,
                method: row.Method,
                simpleSignature: row.SimpleSignature
              };
            }
            overloads.push({
              fullSignature: row.FullSignature,
              methodDescriptor: row.MethodDescriptor,
              returnType: row.ReturnType || "void",
              parameters: row.Parameters || ""
            });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    if (!methodInfo) {
      throw new Error(`Method with signature '${signature}' not found`);
    }

    // ===== 2. Get test coverage for this method =====
    const coverageCsvPath = getDatasetPath('TestCoverage', `${cleanLibrary}-${version}_all_apis_coverage.csv`);

    let coverageInfo = {
      hasCoverage: false,
      instructionCovered: 0,
      instructionMissed: 0,
      coveragePercentage: 0
    };

    if (fs.existsSync(coverageCsvPath)) {
      await new Promise((resolve, reject) => {
        fs.createReadStream(coverageCsvPath)
          .pipe(csv())
          .on('data', (row) => {
            if (row.SimpleSignature === signature) {
              const covered = parseInt(row.INSTRUCTION_COVERED) || 0;
              const missed = parseInt(row.INSTRUCTION_MISSED) || 0;
              
              coverageInfo.instructionCovered += covered;
              coverageInfo.instructionMissed += missed;
            }
          })
          .on('end', resolve)
          .on('error', reject);
      });

      const total = coverageInfo.instructionCovered + coverageInfo.instructionMissed;
      if (total > 0) {
        coverageInfo.coveragePercentage = parseFloat(
          ((coverageInfo.instructionCovered / total) * 100).toFixed(2)
        );
        // Set hasCoverage based on whether ANY instructions are covered
        coverageInfo.hasCoverage = coverageInfo.instructionCovered > 0;
      }
    }

    // ===== 3. Analyze usage across dependents =====
    const baseDir = getDatasetPath('StaticAnaResults', `${cleanLibrary}-${version}`, 'Dependents');

    if (!fs.existsSync(baseDir)) {
      throw new Error("Dependents folder not found");
    }

    const dependentFiles = fs
      .readdirSync(baseDir)
      .filter((f) => f.endsWith("_third_party_calls.csv"));

    // Track detailed usage information
    const dependentUsage = new Map();
    const categoryBreakdown = {};
    const parameterPatterns = new Map();
    let totalUsageCount = 0;

    // Process each dependent file
    const filePromises = dependentFiles.map((file) => {
      return new Promise((resolve) => {
        const filePath = path.join(baseDir, file);
        const dependentName = file.replace("_third_party_calls.csv", "");
        let usageInThisDependent = 0;
        const categoriesInThisDependent = {};
        const patternsInThisDependent = new Set();
        
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            const { methodFull } = parseUsage(row.Usage);
            
            if (methodFull && methodFull.trim() === signature) {
              usageInThisDependent++;
              totalUsageCount++;
              
              // Track category
              const category = row.Category || "UNKNOWN";
              categoriesInThisDependent[category] = 
                (categoriesInThisDependent[category] || 0) + 1;
              categoryBreakdown[category] = 
                (categoryBreakdown[category] || 0) + 1;
              
              // Track parameter usage pattern
              const fullUsage = row.Usage || "";
              const paramMatch = fullUsage.match(/\((.*?)\)/);
              if (paramMatch) {
                const params = paramMatch[1].trim();
                if (params) {
                  patternsInThisDependent.add(params);
                  
                  if (!parameterPatterns.has(params)) {
                    parameterPatterns.set(params, {
                      pattern: params,
                      count: 0,
                      dependents: new Set()
                    });
                  }
                  const patternInfo = parameterPatterns.get(params);
                  patternInfo.count++;
                  patternInfo.dependents.add(dependentName);
                }
              }
            }
          })
          .on('end', () => {
            if (usageInThisDependent > 0) {
              dependentUsage.set(dependentName, {
                name: dependentName,
                usageCount: usageInThisDependent,
                categories: categoriesInThisDependent,
                uniquePatterns: patternsInThisDependent.size
              });
            }
            resolve();
          })
          .on('error', () => resolve());
      });
    });

    await Promise.all(filePromises);

    // ===== 4. Calculate statistics =====
    const dependentsUsingMethod = dependentUsage.size;
    const totalDependents = dependentFiles.length;
    const adoptionRate = totalDependents > 0 
      ? ((dependentsUsingMethod / totalDependents) * 100).toFixed(2)
      : 0;

    // Sort dependents by usage
    const topDependentUsers = Array.from(dependentUsage.values())
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 20);

    // Convert parameter patterns to array
    const topParameterPatterns = Array.from(parameterPatterns.values())
      .map(p => ({
        pattern: p.pattern,
        usageCount: p.count,
        dependentCount: p.dependents.size,
        percentage: totalUsageCount > 0 
          ? ((p.count / totalUsageCount) * 100).toFixed(2)
          : 0
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 15);

    // Calculate average usage per dependent
    const avgUsagePerDependent = dependentsUsingMethod > 0
      ? (totalUsageCount / dependentsUsingMethod).toFixed(2)
      : 0;

    // ===== 5. Generate insights =====
    const insights = [];
    
    // Coverage insight
    if (coverageInfo.hasCoverage) {
      if (coverageInfo.coveragePercentage >= 80) {
        insights.push({
          type: "positive",
          message: `Excellent test coverage (${coverageInfo.coveragePercentage}%) - this widely-used API is well-tested`
        });
      } else if (coverageInfo.coveragePercentage >= 50) {
        insights.push({
          type: "warning",
          message: `Moderate test coverage (${coverageInfo.coveragePercentage}%) - consider adding more tests for this popular API`
        });
      } else {
        insights.push({
          type: "critical",
          message: `Low test coverage (${coverageInfo.coveragePercentage}%) - this API is widely used but undertested`
        });
      }
    } else {
      insights.push({
        type: "critical",
        message: "No test coverage detected - consider adding tests for this API used by multiple dependents"
      });
    }

    // Adoption insight
    if (parseFloat(adoptionRate) >= 50) {
      insights.push({
        type: "info",
        message: `High adoption rate (${adoptionRate}%) - this is a core API for your users`
      });
    } else if (parseFloat(adoptionRate) >= 25) {
      insights.push({
        type: "info",
        message: `Moderate adoption (${adoptionRate}%) - important for many users`
      });
    }

    // Usage pattern insight
    if (topParameterPatterns.length > 5) {
      insights.push({
        type: "info",
        message: `${topParameterPatterns.length} different usage patterns detected - API is used flexibly`
      });
    } else if (topParameterPatterns.length === 1) {
      insights.push({
        type: "info",
        message: "Single dominant usage pattern - API is used consistently"
      });
    }

    // Overload insight
    if (overloads.length > 1) {
      insights.push({
        type: "info",
        message: `${overloads.length} overloads available - ensure all variants are tested`
      });
    }

    // ===== 6. Build response =====
    return {
      library,
      version,
      
      // Method Information
      methodInfo: {
        ...methodInfo,
        fullClassName: `${methodInfo.package}.${methodInfo.class}`,
        overloadCount: overloads.length,
        overloads: overloads
      },

      // Test Coverage
      testCoverage: {
        ...coverageInfo,
        status: coverageInfo.hasCoverage 
          ? (coverageInfo.coveragePercentage >= 80 ? "excellent" 
             : coverageInfo.coveragePercentage >= 50 ? "good" 
             : "needs improvement")
          : "no coverage"
      },

      // Usage Statistics
      usageStatistics: {
        totalDependents: totalDependents,
        dependentsUsingMethod: dependentsUsingMethod,
        adoptionRate: parseFloat(adoptionRate),
        totalUsageCount: totalUsageCount,
        averageUsagePerDependent: parseFloat(avgUsagePerDependent),
        uniqueParameterPatterns: topParameterPatterns.length
      },

      // Category Breakdown
      categoryDistribution: categoryBreakdown,

      // Parameter Usage Patterns
      parameterPatterns: {
        total: topParameterPatterns.length,
        top15: topParameterPatterns
      },

      // Top Dependent Users
      topDependents: topDependentUsers.map(d => ({
        name: d.name,
        usageCount: d.usageCount,
        categories: d.categories,
        uniquePatterns: d.uniquePatterns
      })),

      // Insights & Recommendations
      insights: insights,

      // Summary
      summary: {
        mainMessage: `This method is used ${totalUsageCount} times across ${dependentsUsingMethod} dependents (${adoptionRate}% adoption)`,
        coverageSummary: coverageInfo.hasCoverage 
          ? `${coverageInfo.coveragePercentage}% test coverage`
          : "No test coverage",
        recommendation: !coverageInfo.hasCoverage && dependentsUsingMethod > 5
          ? "Critical: Add test coverage for this widely-used API"
          : coverageInfo.coveragePercentage < 50 && dependentsUsingMethod > 3
          ? "Warning: Improve test coverage for this popular API"
          : " Coverage status acceptable"
      }
    };
  },
  (query) => ({ signature: query.signature }) // Extra params for cache key
));


/**
 * ====================================================================
 * ROUTE: /api/searchMethod/compare
 * GET API
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=sig1,sig2,sig3
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=sig1,sig2,sig3&recompute=true
 * ====================================================================
 * Compare multiple methods side-by-side
 * This endpoint has multiple usecases:
 * 
 * USECASE1: Compare Related Methods (Which serialization method is most used?)
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=com.fasterxml.jackson.databind.ObjectMapper.writeValue,com.fasterxml.jackson.databind.ObjectMapper.writeValueAsBytes,com.fasterxml.jackson.databind.ObjectMapper.writeValueAsString
 * 
 * USECASE2: Compare Similar Methods(Which method is more popular ?)
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=com.fasterxml.jackson.databind.ObjectMapper.writeValue,com.fasterxml.jackson.databind.ObjectMapper.writeValueAsString
 * 
 * USECASE3: Compare Overloads (If a method has multiple overloads, which one do developers actually use?)
 * http://localhost:5050/api/searchMethod/compare?library=jackson-databind&version=2.17.2&signatures=com.fasterxml.jackson.databind.ObjectMapper.readValue,com.fasterxml.jackson.databind.ObjectReader.readValue
 * CACHED: Results are cached per set of signatures
 */
router.get("/compare", withCache(
  "method-comparisons",
  async (req) => {
    const { library, version, signatures } = req.query;
    
    if (!library || !version || !signatures) {
      throw new Error("library, version, and signatures parameters are required");
    }

    const signatureList = signatures.split(',').map(s => s.trim());
    
    if (signatureList.length < 2) {
      throw new Error("At least 2 signatures required for comparison");
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;

    // Get analytics for each method
    const comparisons = [];
    
    for (const signature of signatureList) {
      const baseDir = getDatasetPath('StaticAnaResults', `${cleanLibrary}-${version}`, 'Dependents');

      const dependentFiles = fs
        .readdirSync(baseDir)
        .filter((f) => f.endsWith("_third_party_calls.csv"));

      let usageCount = 0;
      let dependentCount = 0;

      for (const file of dependentFiles) {
        const filePath = path.join(baseDir, file);
        let foundInFile = false;
        
        await new Promise((resolve) => {
          fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
              const { methodFull } = parseUsage(row.Usage);
              if (methodFull && methodFull.trim() === signature) {
                usageCount++;
                foundInFile = true;
              }
            })
            .on('end', resolve)
            .on('error', resolve);
        });

        if (foundInFile) dependentCount++;
      }

      comparisons.push({
        signature,
        usageCount,
        dependentCount,
        adoptionRate: ((dependentCount / dependentFiles.length) * 100).toFixed(2)
      });
    }

    // Sort by usage count
    comparisons.sort((a, b) => b.usageCount - a.usageCount);

    return {
      library,
      version,
      totalMethods: comparisons.length,
      comparisons: comparisons,
      winner: comparisons[0],
      summary: {
        message: `Most popular: ${comparisons[0].signature} with ${comparisons[0].usageCount} uses across ${comparisons[0].dependentCount} dependents`
      }
    };
  },
  (query) => ({ signatures: query.signatures }) // Extra params for cache key
));


/**
 * ====================================================================
 * ROUTE: /api/searchMethod/clear-cache
 * DELETE API
 * http://localhost:5050/api/searchMethod/clear-cache?library=jackson-databind&version=2.17.2
 * http://localhost:5050/api/searchMethod/clear-cache?library=jackson-databind&version=2.17.2&endpoint=method-analytics
 * ====================================================================
 * Clear cached data for a library version or specific endpoint
 */
router.delete("/clear-cache", (req, res) => {
  try {
    const { library, version, endpoint } = req.query;
    
    if (!library || !version) {
      return res.status(400).json({ 
        error: "library and version parameters are required" 
      });
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;
    
    // Get all cache files for this library-version
    const pattern = endpoint 
      ? `${cleanLibrary}-${version}_${endpoint}`
      : `${cleanLibrary}-${version}_`;
    
    const files = fs.readdirSync(CACHE_DIR);
    const matchingFiles = files.filter(f => f.startsWith(pattern) && f.endsWith('.json'));
    
    // Delete matching files
    let deletedCount = 0;
    matchingFiles.forEach(file => {
      fs.unlinkSync(path.join(CACHE_DIR, file));
      deletedCount++;
    });

    res.json({
      success: true,
      deletedCount,
      message: endpoint 
        ? `Cleared ${deletedCount} cache file(s) for ${endpoint}`
        : `Cleared ${deletedCount} cache file(s) for ${library}-${version}`,
      deletedFiles: matchingFiles
    });

  } catch (err) {
    console.error("Error clearing cache:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * ====================================================================
 * ROUTE: /api/searchMethod/cache-info
 * GET API
 * http://localhost:5050/api/searchMethod/cache-info?library=jackson-databind&version=2.17.2
 * ====================================================================
 * Get information about cached data
 */
router.get("/cache-info", (req, res) => {
  try {
    const { library, version } = req.query;
    
    if (!library || !version) {
      return res.status(400).json({ 
        error: "library and version parameters are required" 
      });
    }

    const cleanLibrary = library.includes(":") ? library.split(":").pop() : library;
    const pattern = `${cleanLibrary}-${version}_`;
    
    const files = fs.readdirSync(CACHE_DIR);
    const matchingFiles = files.filter(f => f.startsWith(pattern) && f.endsWith('.json'));
    
    const cacheInfo = matchingFiles.map(file => {
      const filePath = path.join(CACHE_DIR, file);
      const stats = fs.statSync(filePath);
      
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
          filename: file,
          size: `${(stats.size / 1024).toFixed(2)} KB`,
          cachedAt: content.cachedAt || content.timestamp,
          endpoint: file.replace(`${cleanLibrary}-${version}_`, '').replace('.json', '')
        };
      } catch {
        return {
          filename: file,
          size: `${(stats.size / 1024).toFixed(2)} KB`,
          error: "Could not read cache file"
        };
      }
    });

    const totalSize = matchingFiles.reduce((sum, file) => {
      return sum + fs.statSync(path.join(CACHE_DIR, file)).size;
    }, 0);

    res.json({
      library,
      version,
      totalCacheFiles: matchingFiles.length,
      totalSize: `${(totalSize / 1024).toFixed(2)} KB`,
      cacheDirectory: CACHE_DIR,
      cacheFiles: cacheInfo
    });

  } catch (err) {
    console.error("Error getting cache info:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;