// Keeps a local copy of the Hugging Face dataset so that queries never wait on the network.
// Each sync downloads only the files that are new or changed and removes deleted ones.

const fs = require("fs");
const path = require("path");

const HF = "https://huggingface.co";
const TOKEN = process.env.HF_TOKEN || "";

// Splits a path such as hf://datasets/owner/name/results into the dataset and the folder.
// It returns null for a local folder.
function parseHf(location) {
  const match = /^hf:\/\/datasets\/([^/]+\/[^/]+)\/?(.*)$/.exec(location || "");
  return match ? { repo: match[1], dir: match[2].replace(/\/$/, "") } : null;
}

async function hfFetch(url, timeout = 30000) {
  const response = await fetch(url, {
    headers: { "User-Agent": "ossbridge-backend", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response;
}

// Returns the commit that the main branch of the dataset points to now.
// A sync reads every file from this one commit, so it never mixes two publishes.
async function currentCommit(location) {
  const { repo } = parseHf(location);
  const response = await hfFetch(`${HF}/api/datasets/${repo}/revision/main`);
  return (await response.json()).sha;
}

// Lists every file in a dataset folder at one commit with its checksum.
// Hugging Face returns long lists in pages, so this follows the link to the next page.
async function listFiles(repo, dir, commit) {
  const files = [];
  let url = `${HF}/api/datasets/${repo}/tree/${commit}/${dir}?recursive=true`;
  while (url) {
    const response = await hfFetch(url);
    for (const entry of await response.json()) {
      if (entry.type === "file") files.push({ path: entry.path, checksum: entry.lfs?.oid || entry.oid });
    }
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") || "");
    url = next ? next[1] : null;
  }
  return files;
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return {};
  }
}

// Copies the files that keep accepts from a dataset folder at one commit into target.
// It returns true when any file was added, changed or removed.
async function syncFolder(location, target, keep, commit) {
  const { repo, dir } = parseHf(location);
  const stateFile = path.join(target, ".sync.json");
  const state = readState(stateFile);
  const wanted = (await listFiles(repo, dir, commit))
    .map((f) => ({ ...f, local: path.posix.relative(dir, f.path) }))
    .filter((f) => keep(f.local));

  let changed = false;
  for (const file of wanted) {
    const local = path.join(target, file.local);
    if (state[file.local] === file.checksum && fs.existsSync(local)) continue;
    const response = await hfFetch(`${HF}/datasets/${repo}/resolve/${commit}/${file.path}`, 120000);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(`${local}.part`, Buffer.from(await response.arrayBuffer()));
    fs.renameSync(`${local}.part`, local);
    state[file.local] = file.checksum;
    changed = true;
  }
  // A file that is gone from the dataset is removed here too.
  const names = new Set(wanted.map((f) => f.local));
  for (const local of Object.keys(state)) {
    if (names.has(local)) continue;
    fs.rmSync(path.join(target, local), { force: true });
    delete state[local];
    changed = true;
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  return changed;
}

module.exports = { parseHf, currentCommit, syncFolder };
