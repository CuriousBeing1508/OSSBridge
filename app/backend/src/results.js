// ====================================================================
// RESULT TABLES
// ====================================================================
// Loads the OSSBridge result tables (Parquet, written by the pipeline's step 7)
// into an in-memory DuckDB database and answers the routes' queries from it.
//
// RESULTS_PATH is a local results folder or the Hugging Face dataset, e.g.
//   RESULTS_PATH=../data/results
//   RESULTS_PATH=hf://datasets/rachna1508/ossbridge-results/results
// Each table is read from <RESULTS_PATH>/<table>/*.parquet.
//
// Derived tables shared by the routes:
//   uses         api_usage with the class each use resolves to (the declaring
//                class when the analyzer resolved it inside the library), its
//                package, and the old "usage" text: <class>.<member> : <descriptor>
//   api_methods  methods and constructors of the library with their test coverage;
//                signature = <package>.<Class>.<member> groups the overloads
//                (one "API" in the routes' counts, as in the old dataset)
//
// INDEX_PATH is the dependents index (local folder or Hugging Face dataset), e.g.
//   INDEX_PATH=hf://datasets/rachna1508/ossbridge-results/dependents-index
// Its summaries list every library and version on Maven Central in the Goblin
// snapshot, analyzed or not:
//   index_libraries  library_ga, versions, dependents, reach
//   index_versions   library_ga, library_version, dependents
// Without them the app lists only the analyzed versions.

const path = require("path");
const { DuckDBInstance } = require("@duckdb/node-api");

const RESULTS_PATH = process.env.RESULTS_PATH ||
  path.resolve(__dirname, "../../../data/results");
const INDEX_PATH = process.env.INDEX_PATH ||
  path.resolve(__dirname, "../../../data/dependents-index");

const TABLES = ["library_versions", "apis", "dependents", "api_usage", "api_coverage"];

let connection = null;
let loading = null;
let loadedAt = null;
let index = { available: false, snapshot: null };

function root(base) {
  return (base.includes("://") ? base : path.resolve(base)).replace(/\/$/, "");
}

function source(table) {
  return `${root(RESULTS_PATH)}/${table}/*.parquet`;
}

function quoted(file) {
  return `'${file.replace(/'/g, "''")}'`;
}

/** Loads the index summaries; empty tables when the index has none. */
async function loadIndex(con) {
  const base = root(INDEX_PATH);
  try {
    await con.run(`CREATE TABLE index_libraries AS SELECT * FROM read_parquet(${quoted(`${base}/libraries.parquet`)})`);
    await con.run(`CREATE TABLE index_versions AS SELECT * FROM read_parquet(${quoted(`${base}/versions.parquet`)})`);
  } catch (err) {
    console.log(`[INFO] No dependents index summaries at ${base}; listing analyzed versions only (${err.message.split("\n")[0]})`);
    await con.run("CREATE OR REPLACE TABLE index_libraries (library_ga VARCHAR, versions BIGINT, dependents BIGINT, reach BIGINT)");
    await con.run("CREATE OR REPLACE TABLE index_versions (library_ga VARCHAR, library_version VARCHAR, dependents BIGINT)");
    return { available: false, snapshot: null };
  }
  let snapshot = null;
  try {
    const reader = await con.runAndReadAll(
      `SELECT CAST(source.snapshot AS VARCHAR) AS snapshot FROM read_json_auto(${quoted(`${base}/manifest.json`)})`);
    snapshot = reader.getRowObjectsJS()[0]?.snapshot ?? null;
  } catch (err) {
    // The manifest only adds the snapshot date
  }
  return { available: true, snapshot };
}

async function load() {
  const instance = await DuckDBInstance.create(":memory:");
  const con = await instance.connect();
  for (const table of TABLES) {
    const glob = source(table).replace(/'/g, "''");
    await con.run(`CREATE TABLE ${table} AS SELECT * FROM read_parquet('${glob}', union_by_name = true)`);
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
           CASE WHEN c.status = 'no_code' AND c.overrides > 0 THEN 'not_covered' ELSE c.status END AS status,
           coalesce(c.instruction_missed, 0) AS instruction_missed,
           coalesce(c.instruction_covered, 0) AS instruction_covered
    FROM apis a
    LEFT JOIN api_coverage c USING (library_ga, version, api_id)
    WHERE a.kind IN ('method', 'constructor')`);
  index = await loadIndex(con);
  return con;
}

/** Loads (or reloads) the tables; queries wait for a load in progress. */
async function reload() {
  loading = load().then((con) => {
    connection = con;
    loadedAt = new Date().toISOString();
    console.log(`[INFO] Result tables loaded from ${RESULTS_PATH}`);
    if (index.available) console.log(`[INFO] Dependents index summaries loaded from ${INDEX_PATH}`);
    return con;
  });
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function getConnection() {
  if (loading) return loading;
  if (connection) return connection;
  return reload();
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
  const con = await getConnection();
  const reader = await con.runAndReadAll(sql, params);
  return reader.getRowObjectsJS().map(plain);
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
  index: () => index,
  query,
  reload,
  resolveLibrary,
  compareVersions,
  libraryVersion,
  coverage,
  loadedAt: () => loadedAt,
};
