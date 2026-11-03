// ====================================================================
// MAVEN CENTRAL
// ====================================================================
// The releases of a library, read from its maven-metadata.xml on Maven Central.

const METADATA_TTL_MS = 60 * 60 * 1000;
const GA = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/;
const metadataCache = new Map();

/** Releases of groupId:artifactId (no snapshots), cached for an hour; null when unreachable. */
async function mavenReleases(ga) {
  const cached = metadataCache.get(ga);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.versions;
  const [group, artifact] = ga.split(":");
  const url = `https://repo1.maven.org/maven2/${group.replace(/\./g, "/")}/${artifact}/maven-metadata.xml`;
  let versions = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const xml = await response.text();
      versions = [...xml.matchAll(/<version>\s*([^<\s]+)\s*<\/version>/g)]
        .map((m) => m[1]).filter((v) => !v.endsWith("-SNAPSHOT"));
    } else if (response.status === 404) {
      versions = [];
    }
  } catch (err) {
    console.log(`[INFO] Maven Central metadata for ${ga} not available: ${err.message}`);
  }
  if (versions) metadataCache.set(ga, { at: Date.now(), versions });
  return versions;
}

// Release dates are not in maven-metadata.xml; deps.dev (free, no key) has them
const datesCache = new Map();

/** Map of version to release date (YYYY-MM-DD), cached for an hour; null when unreachable. */
async function releaseDates(ga) {
  const cached = datesCache.get(ga);
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) return cached.dates;
  const url = `https://api.deps.dev/v3/systems/maven/packages/${encodeURIComponent(ga)}`;
  let dates = null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const body = await response.json();
      dates = new Map((body.versions ?? [])
        .filter((v) => v.publishedAt)
        .map((v) => [v.versionKey.version, v.publishedAt.slice(0, 10)]));
    } else if (response.status === 404) {
      dates = new Map();
    }
  } catch (err) {
    console.log(`[INFO] deps.dev release dates for ${ga} not available: ${err.message}`);
  }
  if (dates) datesCache.set(ga, { at: Date.now(), dates });
  return dates;
}

module.exports = { GA, mavenReleases, releaseDates };
