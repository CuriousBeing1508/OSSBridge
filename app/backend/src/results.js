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

const path = require("path");
const { DuckDBInstance } = require("@duckdb/node-api");

const RESULTS_PATH = process.env.RESULTS_PATH ||
  path.resolve(__dirname, "../../../data/results");

const TABLES = ["library_versions", "apis", "dependents", "api_usage", "api_coverage"];

let connection = null;
let loading = null;
let loadedAt = null;

function source(table) {
  const root = RESULTS_PATH.includes("://") ? RESULTS_PATH : path.resolve(RESULTS_PATH);
  return `${root.replace(/\/$/, "")}/${table}/*.parquet`;
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
           c.status, coalesce(c.instruction_missed, 0) AS instruction_missed,
           coalesce(c.instruction_covered, 0) AS instruction_covered
    FROM apis a
    LEFT JOIN api_coverage c USING (library_ga, version, api_id)
    WHERE a.kind IN ('method', 'constructor')`);
  return con;
}

/** Loads (or reloads) the tables; queries wait for a load in progress. */
async function reload() {
  loading = load().then((con) => {
    connection = con;
    loadedAt = new Date().toISOString();
    console.log(`[INFO] Result tables loaded from ${RESULTS_PATH}`);
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

/** Numeric-aware version order: 2.9 before 2.10. */
function compareVersions(a, b) {
  const pa = a.split(/[.\-]/);
  const pb = b.split(/[.\-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
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

module.exports = {
  RESULTS_PATH,
  query,
  reload,
  resolveLibrary,
  compareVersions,
  libraryVersion,
  loadedAt: () => loadedAt,
};
