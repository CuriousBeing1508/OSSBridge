// ====================================================================
// ANALYZE A LIBRARY VERSION
// ====================================================================
// Starts the GitHub Actions workflow "Analyze library" for a version that has
// not been analyzed, and reports the progress of its runs. The GitHub token
// stays on the server; the browser only talks to these routes.
//
//   GITHUB_TOKEN          fine-grained token with "Actions: Read and write" on
//                         GITHUB_REPO; without it, analyses cannot be started
//   GITHUB_REPO           owner/name (default CuriousBeing1508/OSSBridge)
//   GITHUB_REF            branch the workflow runs from (default main)
//   ANALYZE_MAX_RUNNING   analyses queued or running at once (default 3)
//   ANALYZE_MAX_PER_HOUR  analyses started per hour (default 5)
//
//   RESULTS_DATASET       Hugging Face dataset the workflow publishes to (default
//                         rachna1508/ossbridge-results)
//
// Runs are found by their name, "Analyze <groupId:artifactId:version> [<request id>]"
// (the workflow's run-name). A run that succeeds has published its results to the dataset.
// The backend then updates its tables right away instead of waiting for the next regular update.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const results = require("../results");
const { GA, mavenReleases } = require("../mavenCentral");

const router = express.Router();

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPO || "CuriousBeing1508/OSSBridge";
const REF = process.env.GITHUB_REF || "main";
const WORKFLOW = "analyze-library.yml";
const MAX_RUNNING = Number(process.env.ANALYZE_MAX_RUNNING || 3);
const MAX_PER_HOUR = Number(process.env.ANALYZE_MAX_PER_HOUR || 5);
const DATASET = process.env.RESULTS_DATASET || "rachna1508/ossbridge-results";
const VERSION = /^[A-Za-z0-9_.+-]+$/;
const RUN_NAME = /^Analyze (\S+?)(?: \[(\S+)\])?$/;
const CACHE_MS = 15 * 1000;
// A started analysis is shown as requested until its run appears on GitHub
const REQUEST_VISIBLE_MS = 3 * 60 * 1000;

const requested = new Map();   // release -> { requestId, at }
const jobCache = new Map();    // run id -> { at, step }
const loadAttempted = new Set();  // releases whose published results were loaded once
let runCache = { at: 0, runs: null };

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ossbridge-backend",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
}

/** The workflow's 100 most recent runs, newest first, with the release each analyzes. */
async function recentRuns(fresh = false) {
  if (!fresh && runCache.runs && Date.now() - runCache.at < CACHE_MS) return runCache.runs;
  const data = await github(`/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=100`);
  const runs = data.workflow_runs.map((run) => {
    const match = RUN_NAME.exec(run.display_title || "");
    return {
      id: run.id,
      release: match ? match[1] : null,
      requestId: match ? match[2] || null : null,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      event: run.event,
    };
  });
  runCache = { at: Date.now(), runs };
  return runs;
}

/** Name of the step a running run is on. */
async function currentStep(run) {
  const cached = jobCache.get(run.id);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.step;
  let step = null;
  try {
    const data = await github(`/repos/${REPO}/actions/runs/${run.id}/jobs`);
    const steps = data.jobs.flatMap((job) => job.steps || []);
    step = (steps.find((s) => s.status === "in_progress") || {}).name || null;
  } catch (err) {
    // The progress text is optional
  }
  jobCache.set(run.id, { at: Date.now(), step });
  return step;
}

function isActive(run) {
  return run.status !== "completed";
}

async function analyzedVersions(ga) {
  const rows = await results.query("SELECT version FROM library_versions WHERE library_ga = $ga", { ga });
  return new Set(rows.map((r) => r.version));
}

/** Downloads a version's published result files into the local results folder. */
async function downloadPublished(release) {
  const [group, artifact, version] = release.split(":");
  const file = `${group}__${artifact}@${version}.parquet`;
  for (const table of results.TABLES) {
    const url = `https://huggingface.co/datasets/${DATASET}/resolve/main/results/${table}/${file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const target = path.join(results.RESULTS_DIR, table, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.part`, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(`${target}.part`, target);
  }
  console.log(`[INFO] Downloaded the published results of ${release} into ${results.RESULTS_PATH}`);
}

// Loads the results of a finished run whose version has no results here yet.
// Each version is tried once, because a run can succeed without publishing any results.
function reloadIfPublished(runs, analyzed) {
  if (results.isRefreshing()) return;
  const published = runs.filter((run) => run.conclusion === "success" && !analyzed(run.release)
    && !loadAttempted.has(run.release));
  if (published.length) {
    published.forEach((run) => loadAttempted.add(run.release));
    console.log("[INFO] An analysis has finished. Loading its results.");
    // A local results folder gets the published files first. Data from Hugging Face is copied by the update itself.
    const local = !results.RESULTS_PATH.includes("://");
    (async () => {
      if (local) {
        for (const run of published) await downloadPublished(run.release);
      }
      await results.refresh();
    })().catch((err) => console.error(`[ERROR] Loading the new results failed. ${err.message}`));
  }
}

// Whether analyses can be started here, and the limits
// http://localhost:5050/api/analyze/config
router.get("/config", (req, res) => {
  res.json({ enabled: Boolean(TOKEN), repo: REPO, maxRunning: MAX_RUNNING, maxPerHour: MAX_PER_HOUR });
});

// Latest analysis run of each version of a library
// http://localhost:5050/api/analyze/status?library=org.mybatis:mybatis
router.get("/status", async (req, res) => {
  const { library } = req.query;
  if (!library || !GA.test(library)) return res.status(400).json({ error: "Give the library as groupId:artifactId" });
  try {
    const runs = await recentRuns();
    const prefix = `${library}:`;
    const latest = new Map();
    for (const run of runs) {
      if (run.release && run.release.startsWith(prefix) && !latest.has(run.release)) latest.set(run.release, run);
    }
    const analyzed = await analyzedVersions(library);
    reloadIfPublished([...latest.values()], (release) => analyzed.has(release.slice(prefix.length)));

    const versions = {};
    for (const [release, run] of latest) {
      const version = release.slice(prefix.length);
      versions[version] = {
        state: run.status === "completed" ? run.conclusion : run.status,
        // Whether this app has the version's results
        loaded: analyzed.has(version),
        step: isActive(run) ? await currentStep(run) : null,
        url: run.url,
        startedAt: run.createdAt,
        updatedAt: run.updatedAt,
      };
    }
    // Started here, but GitHub does not list the run yet
    for (const [release, request] of requested) {
      const version = release.slice(prefix.length);
      if (release.startsWith(prefix) && Date.now() - request.at < REQUEST_VISIBLE_MS
          && !runs.some((run) => run.requestId === request.requestId)) {
        versions[version] = { state: "requested", step: null, url: null, startedAt: new Date(request.at).toISOString() };
      }
    }
    res.json({ library, reloading: results.isRefreshing(), versions });
  } catch (err) {
    res.status(502).json({ error: `Could not read the analysis runs. ${err.message}` });
  }
});

// Start the analysis of a library version
// curl -X POST -H 'Content-Type: application/json' \
//   -d '{"library":"org.mybatis:mybatis","version":"3.5.13"}' http://localhost:5050/api/analyze
router.post("/", async (req, res) => {
  const { library, version } = req.body || {};
  if (!TOKEN) {
    return res.status(503).json({ error: "Analyses cannot be started from this site right now." });
  }
  if (!library || !GA.test(library) || !version || !VERSION.test(version)) {
    return res.status(400).json({ error: "Give a library as groupId:artifactId and a version" });
  }
  const release = `${library}:${version}`;
  try {
    if ((await analyzedVersions(library)).has(version)) {
      return res.status(409).json({ error: `${release} has already been analyzed.` });
    }
    const releases = await mavenReleases(library);
    if (releases && !releases.includes(version)) {
      return res.status(400).json({ error: `${release} is not a release on Maven Central.` });
    }
    if (results.index().available) {
      const [row] = await results.query(
        "SELECT dependents FROM index_versions WHERE library_ga = $ga AND library_version = $version",
        { ga: library, version });
      if (!row || !row.dependents) {
        return res.status(400).json({
          error: `No project in our data uses ${release}, so there is nothing to analyze.`,
        });
      }
    }

    const runs = await recentRuns(true);
    const active = runs.find((run) => run.release === release && isActive(run));
    const pending = requested.get(release);
    if (active || (pending && Date.now() - pending.at < REQUEST_VISIBLE_MS)) {
      return res.json({ release, alreadyRunning: true, url: active ? active.url : null });
    }
    const running = runs.filter(isActive).length;
    if (running >= MAX_RUNNING) {
      return res.status(429).json({
        error: `${running} analyses are already running and the limit is ${MAX_RUNNING} at a time. Please try again later.`,
      });
    }
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const lastHour = runs.filter((run) => run.event === "workflow_dispatch" && Date.parse(run.createdAt) > hourAgo).length;
    if (lastHour >= MAX_PER_HOUR) {
      return res.status(429).json({
        error: `${lastHour} analyses were started in the last hour and the limit is ${MAX_PER_HOUR}. Please try again later.`,
      });
    }

    const requestId = crypto.randomBytes(6).toString("hex");
    await github(`/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: REF, inputs: { release, request_id: requestId } }),
    });
    requested.set(release, { requestId, at: Date.now() });
    runCache = { at: 0, runs: null };
    console.log(`[INFO] Started the analysis of ${release} [${requestId}]`);
    res.status(202).json({ release, requestId });
  } catch (err) {
    res.status(502).json({ error: `Could not start the analysis. ${err.message}` });
  }
});

module.exports = router;
