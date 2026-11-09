// ====================================================================
// RESULT TABLES
// ====================================================================
// The backend answers every page from the OSSBridge result tables and the dependents index.
// They come from a local folder or from the Hugging Face dataset, set in RESULTS_PATH and INDEX_PATH.
//
//   RESULTS_PATH=../data/results
//   RESULTS_PATH=hf://datasets/rachna1508/ossbridge-results/results
//   INDEX_PATH=hf://datasets/rachna1508/ossbridge-results/dependents-index
//
// Data from Hugging Face is first copied to DATA_DIR, so queries never wait on the network.
// The tables are kept in DuckDB files in DATA_DIR, and DUCKDB_MEMORY_LIMIT caps the memory they use.
//
// Every SYNC_MINUTES the backend looks for new or changed files and rebuilds the tables if it finds any.
// The current tables keep answering while the new ones are built, so a rebuild never blocks a page.
//
// Tables built from the results for the routes.
//   uses         api_usage with the class each use resolves to, its package and a readable usage text
//   api_methods  methods and constructors with their coverage, grouped by signature into one API per name
//
// Tables from the dependents index. Without them the app lists only the analyzed versions.
//   index_libraries  library_ga, versions, dependents, reach
//   index_versions   library_ga, library_version, dependents

const fs = require("fs");
const os = require("os");
const path = require("path");
const { DuckDBInstance } = require("@duckdb/node-api");
const { parseHf, currentCommit, syncFolder } = require("./sync");

const RESULTS_PATH = process.env.RESULTS_PATH ||
  path.resolve(__dirname, "../../../data/results");
const INDEX_PATH = process.env.INDEX_PATH ||
  path.resolve(__dirname, "../../../data/dependents-index");
const DATA_DIR = process.env.DATA_DIR || path.join(os.tmpdir(), "ossbridge");
const MEMORY_LIMIT = process.env.DUCKDB_MEMORY_LIMIT || "1GB";
const SYNC_MINUTES = Number(process.env.SYNC_MINUTES || 5);

const TABLES = ["library_versions", "apis", "dependents", "api_usage", "api_coverage"];
const INDEX_FILES = ["libraries.parquet", "versions.parquet", "manifest.json"];

// Data from Hugging Face is read from its copy in DATA_DIR. A local folder is read where it is.
const RESULTS_DIR = parseHf(RESULTS_PATH) ? path.join(DATA_DIR, "results") : path.resolve(RESULTS_PATH);
const INDEX_DIR = parseHf(INDEX_PATH) ? path.join(DATA_DIR, "dependents-index") : path.resolve(INDEX_PATH);

let instance = null;
let admin = null;
let current = null;
let refreshing = null;
let generation = 0;
let built = { results: null, index: null };
let indexDb = null;
let loadedAt = null;
let index = { available: false, snapshot: null };
const syncedCommits = new Map();

function quoted(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

// Lists the files of a folder with their size and change time.
// Two equal lists mean nothing changed since the last build.
function signature(dir, accept) {
  const found = [];
  const walk = (folder) => {
    if (!fs.existsSync(folder)) return;
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(dir, full).split(path.sep).join("/");
        if (accept(rel)) {
          const stat = fs.statSync(full);
          found.push(`${rel}:${stat.size}:${stat.mtimeMs}`);
        }
      }
    }
  };
  walk(dir);
  return found.sort().join("\n");
}

const isResultFile = (rel) => TABLES.includes(rel.split("/")[0]) && rel.endsWith(".parquet");
const isIndexFile = (rel) => INDEX_FILES.includes(rel);

// Starts the single DuckDB that holds every table.
// One instance means one memory limit covers the old and the new tables during a rebuild.
async function openInstance() {
  if (instance) return;
  fs.mkdirSync(path.join(DATA_DIR, "tmp"), { recursive: true });
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (/^(results|index)-\d+\.duckdb(\.wal)?$/.test(file)) fs.rmSync(path.join(DATA_DIR, file), { force: true });
  }
  instance = await DuckDBInstance.create(":memory:");
  admin = await instance.connect();
  await admin.run(`SET memory_limit = ${quoted(MEMORY_LIMIT)}`);
  await admin.run(`SET temp_directory = ${quoted(path.join(DATA_DIR, "tmp"))}`);
}

// Builds the index tables in their own file, because the index changes far less often than the results.
// It returns the name of the attached database, or null when there is no index.
async function buildIndex(gen) {
  const libraries = path.join(INDEX_DIR, "libraries.parquet");
  const versions = path.join(INDEX_DIR, "versions.parquet");
  if (!fs.existsSync(libraries) || !fs.existsSync(versions)) {
    console.log(`[INFO] No dependents index summaries in ${INDEX_DIR}. Only analyzed versions are listed.`);
    index = { available: false, snapshot: null };
    return null;
  }
  const name = `index_${gen}`;
  await admin.run(`ATTACH ${quoted(path.join(DATA_DIR, `index-${gen}.duckdb`))} AS ${name}`);
  await admin.run(`CREATE TABLE ${name}.index_libraries AS SELECT * FROM read_parquet(${quoted(libraries)})`);
  await admin.run(`CREATE TABLE ${name}.index_versions AS SELECT * FROM read_parquet(${quoted(versions)})`);
  await admin.run(`CHECKPOINT ${name}`);
  let snapshot = null;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "manifest.json"), "utf8")).source?.snapshot ?? null;
  } catch (err) {
    // The manifest only adds the snapshot date.
  }
  index = { available: true, snapshot };
  return name;
}

// Builds the result tables of one generation in a new file and returns its connection.
// The routes query it with plain table names, so it uses that file as its default database.
async function buildResults(gen, indexName) {
  const name = `results_${gen}`;
  await admin.run(`ATTACH ${quoted(path.join(DATA_DIR, `results-${gen}.duckdb`))} AS ${name}`);
  const con = await instance.connect();
  await con.run(`USE ${name}`);
  for (const table of TABLES) {
    const glob = path.join(RESULTS_DIR, table, "*.parquet");
    await con.run(`CREATE TABLE ${table} AS SELECT * FROM read_parquet(${quoted(glob)}, union_by_name = true)`);
  }
  // Results stored before the run times were recorded have no time columns.
  for (const column of ["usage_seconds", "coverage_seconds", "analysis_seconds"]) {
    await con.run(`ALTER TABLE library_versions ADD COLUMN IF NOT EXISTS ${column} BIGINT`);
  }
  await con.run(`
    CREATE TABLE uses AS
    SELECT library_ga, version, dependent_ga || ':' || dependent_version AS dependent,
           category, cls AS class,
           CASE WHEN contains(cls, '.') THEN regexp_extract(cls, '^(.*)\\.[^.]*$', 1) ELSE '' END AS package,
           member, target_descriptor AS descriptor, api_id, occurrences, caller_classes,
           CASE WHEN member IS NOT NULL THEN cls || '.' || member END AS method_full,
           CASE WHEN member IS NOT NULL THEN cls || '.' || member || ' : ' || coalesce(target_descriptor, '')
                ELSE cls || coalesce(target_member, '') END AS usage
    FROM (
      SELECT *,
             CASE WHEN resolution IN ('declared', 'inherited', 'subclass') THEN declaring_class
                  ELSE target_class END AS cls,
             CASE WHEN target_member IN ('<extends>', '<implements>') THEN NULL
                  ELSE target_member END AS member
      FROM api_usage)`);
  await con.run(`
    CREATE TABLE api_methods AS
    SELECT a.library_ga, a.version, a.api_id, a.package, a.class_name, a.member, a.descriptor,
           CASE WHEN a.package = '' THEN a.class_name ELSE a.package || '.' || a.class_name END
             || '.' || a.member AS signature,
           -- Older results count abstract methods with untested implementations as no_code.
           -- They are not covered only when their package is in the coverage report, which leaves out bundled code.
           CASE WHEN c.status = 'no_code' AND c.overrides > 0 AND p.reported THEN 'not_covered' ELSE c.status END AS status,
           coalesce(c.instruction_missed, 0) AS instruction_missed,
           coalesce(c.instruction_covered, 0) AS instruction_covered
    FROM apis a
    LEFT JOIN api_coverage c USING (library_ga, version, api_id)
    LEFT JOIN (
      SELECT a2.library_ga, a2.version, a2.package,
             bool_or(coalesce(c2.instruction_covered, 0) + coalesce(c2.instruction_missed, 0) > 0) AS reported
      FROM apis a2 LEFT JOIN api_coverage c2 USING (library_ga, version, api_id)
      GROUP BY ALL) p USING (library_ga, version, package)
    WHERE a.kind IN ('method', 'constructor')`);
  if (indexName) {
    await con.run(`CREATE VIEW index_libraries AS SELECT * FROM ${indexName}.index_libraries`);
    await con.run(`CREATE VIEW index_versions AS SELECT * FROM ${indexName}.index_versions`);
  } else {
    await con.run("CREATE TABLE index_libraries (library_ga VARCHAR, versions BIGINT, dependents BIGINT, reach BIGINT)");
    await con.run("CREATE TABLE index_versions (library_ga VARCHAR, library_version VARCHAR, dependents BIGINT)");
  }
  await con.run("CHECKPOINT");
  return { con, name, file: path.join(DATA_DIR, `results-${gen}.duckdb`), index: indexName, inflight: 0 };
}

// Closes an old generation once no query uses it anymore, and deletes its files.
// Its index is removed too when the new generation uses another one.
async function retire(old) {
  old.retired = true;
  if (old.inflight > 0 || old.closed) return;
  old.closed = true;
  old.con.closeSync();
  await admin.run(`DETACH ${old.name}`);
  fs.rmSync(old.file, { force: true });
  fs.rmSync(`${old.file}.wal`, { force: true });
  if (old.index && old.index !== current?.index) {
    await admin.run(`DETACH ${old.index}`);
    const file = path.join(DATA_DIR, `${old.index.replace("_", "-")}.duckdb`);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.wal`, { force: true });
  }
}

// Copies new data from Hugging Face, then rebuilds the tables if any file changed.
// A failed sync or build keeps the current tables, and the next round tries again.
async function refresh({ force = false } = {}) {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    // Both folders are read from the same commit when they are in the same dataset.
    const commits = new Map();
    const commitOf = async (location) => {
      const { repo } = parseHf(location);
      if (!commits.has(repo)) commits.set(repo, await currentCommit(location));
      return commits.get(repo);
    };
    // A folder whose commit has not changed since its last sync needs no listing.
    for (const [location, dir, keep] of [[RESULTS_PATH, RESULTS_DIR, isResultFile], [INDEX_PATH, INDEX_DIR, isIndexFile]]) {
      if (!parseHf(location)) continue;
      const commit = await commitOf(location);
      if (syncedCommits.get(location) === commit) continue;
      await syncFolder(location, dir, keep, commit);
      syncedCommits.set(location, commit);
    }
    const results = signature(RESULTS_DIR, isResultFile);
    const indexFiles = signature(INDEX_DIR, isIndexFile);
    if (!force && current && results === built.results && indexFiles === built.index) return false;

    await openInstance();
    const gen = ++generation;
    const indexChanged = indexFiles !== built.index;
    const indexName = indexChanged ? await buildIndex(gen) : indexDb;
    let next;
    try {
      next = await buildResults(gen, indexName);
    } catch (err) {
      if (indexChanged && indexName) await admin.run(`DETACH ${indexName}`);
      throw err;
    }
    const old = current;
    current = next;
    indexDb = indexName;
    built = { results, index: indexFiles };
    loadedAt = new Date().toISOString();
    console.log(`[INFO] Result tables loaded from ${RESULTS_PATH}`);
    if (old) await retire(old);
    return true;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

// Loads the tables when the server starts and then checks for new data every SYNC_MINUTES.
// If the data cannot be loaded, it tries again after a pause that grows up to five minutes.
async function start() {
  for (let pause = 5; !current; pause = Math.min(pause * 2, 300)) {
    try {
      await refresh({ force: true });
    } catch (err) {
      console.error(`[ERROR] Loading the result tables failed. Trying again in ${pause} seconds. ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, pause * 1000));
    }
  }
  if (SYNC_MINUTES > 0) {
    setInterval(() => {
      refresh().catch((err) => console.error(`[ERROR] Updating the result tables failed. ${err.message}`));
    }, SYNC_MINUTES * 60 * 1000).unref();
  }
}

// Pages ask for the tables here. Before the first load finishes they get a clear error.
async function ready() {
  if (current) return current;
  const err = new Error("The data is still loading. Please try again in a minute.");
  err.status = 503;
  throw err;
}

function plain(value) {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

/** Rows as plain objects; params are bound to $name placeholders. */
async function query(sql, params = {}) {
  const gen = await ready();
  // A rebuild can finish while this query waited, so it asks again for the newest tables.
  if (gen.closed) return query(sql, params);
  gen.inflight += 1;
  try {
    const reader = await gen.con.runAndReadAll(sql, params);
    return reader.getRowObjectsJS().map(plain);
  } finally {
    gen.inflight -= 1;
    if (gen.retired && gen.inflight === 0) {
      retire(gen).catch((err) => console.error(`[ERROR] Closing old result tables failed. ${err.message}`));
    }
  }
}

/**
 * The library_ga for a "groupId:artifactId" or a bare artifactId (as the
 * frontend sends it), or null if no version of it has results.
 */
async function resolveLibrary(library) {
  if (!library) return null;
  const rows = await query(`
    SELECT library_ga, count(*) AS versions FROM library_versions
    WHERE library_ga = $library OR split_part(library_ga, ':', 2) = $library
    GROUP BY library_ga ORDER BY library_ga = $library DESC, versions DESC, library_ga`,
    { library });
  return rows.length ? rows[0].library_ga : null;
}

/**
 * Numeric-aware version order: 2.9 before 2.10, and a release after its
 * qualified builds (2.0.0-M1 and 2.0.0-RC1 before 2.0.0, 2.0.0 before 2.0.0.1).
 */
function compareVersions(a, b) {
  const pa = a.split(/[.\-]/);
  const pb = b.split(/[.\-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    // One version ends here: it is older than a further number, newer than a qualifier
    if (x === "" && y !== "") return Number.isNaN(ny) ? 1 : -1;
    if (y === "" && x !== "") return Number.isNaN(nx) ? -1 : 1;
    // A number is newer than a qualifier (2.0.0.1 after 2.0.0-M1)
    if (Number.isNaN(nx) !== Number.isNaN(ny)) return Number.isNaN(nx) ? -1 : 1;
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Express helper: resolves ?library and checks ?version. Sends the error
 * response and returns null when the library version has no results.
 */
async function libraryVersion(req, res) {
  const { library, version } = req.query;
  if (!library || !version) {
    res.status(400).json({ error: "library and version are required" });
    return null;
  }
  const ga = await resolveLibrary(library);
  const rows = ga ? await query(
    "SELECT * FROM library_versions WHERE library_ga = $ga AND version = $version",
    { ga, version }) : [];
  if (!rows.length) {
    res.status(404).json({ error: `No results for ${library} ${version}` });
    return null;
  }
  return { ga, version, summary: rows[0] };
}

/**
 * Whether a version has test coverage, and why not if it has none.
 * Results stored before reasons were added have no reason.
 */
function coverage(summary) {
  if (summary.coverage_status === "ok") return { available: true, status: "ok", reason: null, error: null };
  return {
    available: false,
    status: summary.coverage_status,
    reason: summary.coverage_reason || null,
    error: summary.coverage_error || null,
  };
}

module.exports = {
  RESULTS_PATH,
  INDEX_PATH,
  TABLES,
  RESULTS_DIR,
  index: () => index,
  query,
  start,
  refresh,
  isRefreshing: () => Boolean(refreshing),
  isLoaded: () => Boolean(current),
  resolveLibrary,
  compareVersions,
  libraryVersion,
  coverage,
  loadedAt: () => loadedAt,
};
