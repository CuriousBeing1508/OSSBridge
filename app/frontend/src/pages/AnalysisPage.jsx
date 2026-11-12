import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getLibraryVersions, getAnalyzeConfig, getAnalyzeStatus, startAnalysis } from "../services/api";
import Header from "../components/Header";
import { useLibrary } from "../context/LibraryContext";
import InfoIcon from "../components/InfoIcon";
import FewDependentsBadge from "../components/FewDependentsBadge";
import { pageParam, pageUrl } from "../utils/pageUrl";

// The tooltip of an analyzed version. It tells how many projects list it and how many call it.
const versionInfo = (v) =>
  `${v.dependents.toLocaleString()} ${v.dependents === 1 ? "project lists" : "projects list"} this version as a dependency. `
  + `${v.analyzedProjects.toLocaleString()} of them call its code, and the results come from these projects. `
  + "A smaller sample of projects is faster to analyze.";

// A run time in seconds as text, for example 45 seconds, 9 minutes or 1 hour 5 minutes.
const duration = (seconds) => {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${hours === 1 ? "hour" : "hours"}${rest ? ` ${rest} ${rest === 1 ? "minute" : "minutes"}` : ""}`;
};

// Analysis run states (GitHub Actions run status, or "requested" before GitHub lists it)
const ACTIVE_STATES = ["requested", "queued", "waiting", "pending", "in_progress"];
const FAILED_STATES = ["failure", "cancelled", "timed_out", "startup_failure"];
const POLL_MS = 20000;
// Versions grouped by how many projects use them, compared with the other versions of the library
const USAGE_GROUPS = [
  ["most", "Most used versions"],
  ["moderate", "Moderately used versions"],
  ["rare", "Rarely used versions"],
];
const REQUEST_VISIBLE_MS = 3 * 60 * 1000;
// How long a finished run is followed until the backend has loaded its results
const LOAD_WAIT_MS = 10 * 60 * 1000;
// Failed status requests in a row before the page stops asking
const MAX_POLL_FAILURES = 5;

// A run that succeeded but whose results the backend has not loaded yet
const waitingForResults = (run) => run.state === "success" && run.loaded === false
  && Date.now() - Date.parse(run.updatedAt) < LOAD_WAIT_MS;

// "2025-04-20" as "20 April 2025"
const longDate = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB",
  { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// What the current step of analyze-library.yml does, in plain words
const STEP_LABELS = {
  "1 Dependents": "Finding the projects that use it",
  "2-3 Download and analyze dependents": "Downloading and checking the projects that use it",
  "4 Library API": "Reading the library's API",
  "5 Test coverage": "Running the library's tests",
  "6 API coverage": "Comparing use with test coverage",
  "7 Store results": "Saving the results",
  "Publish to Hugging Face": "Publishing the results",
  "Run summary": "Finishing",
  "Attach run.json, summaries and build logs": "Finishing",
};
const stepLabel = (step) => STEP_LABELS[step] || "Getting ready";

const runLabel = (run) =>
  run.state === "in_progress" ? "Analysis running"
    : run.state === "requested" ? "Analysis requested"
      : "Analysis queued";

const AnalysisPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const { library: contextLibrary, setLibrary, setVersion } = useLibrary();
  const stateLibrary = pageParam(location, "library");

  const library = stateLibrary || contextLibrary;

  // [{ version, dependents, analyzed, inIndex }], newest first
  const [versions, setVersions] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [libraryInfo, setLibraryInfo] = useState(null);
  const [sortBy, setSortBy] = useState("use");
  // Releases on Maven Central that are not listed (not in the dependents index)
  const [notListed, setNotListed] = useState(0);
  const [showAll, setShowAll] = useState(true);
  const [versionFilter, setVersionFilter] = useState("");
  // Analyses: whether they can be started here, the latest run per version, errors
  const [analyzeConfig, setAnalyzeConfig] = useState(null);
  const [runs, setRuns] = useState({});
  const [analyzeErrors, setAnalyzeErrors] = useState({});
  const [versionsLoads, setVersionsLoads] = useState(0);
  const [pollKey, setPollKey] = useState(0);
  const [resultsReloading, setResultsReloading] = useState(false);
  const previousRuns = useRef({});
  const previousReloading = useRef(false);
  const previousPolled = useRef(false);
  const localRequests = useRef({});  // version -> when it was started from this page
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState("");

  // Update context when library comes from navigation
  useEffect(() => {
    if (stateLibrary) {
      console.log("Setting library in context:", stateLibrary);
      setLibrary(stateLibrary);
    }
  }, [stateLibrary, setLibrary]);

  // Fetch versions when library is available
  useEffect(() => {
    if (!library) {
      console.log("No library, skipping version fetch");
      return;
    }

    const fetchVersions = async () => {
      // A reload after an analysis finished updates the list in place
      const firstLoad = versionsLoads === 0;
      if (firstLoad) setLoadingVersions(true);
      setError("");
      try {
        const res = await getLibraryVersions(library);
        setVersions(res.data.versions);
        setSnapshot(res.data.snapshot);
        setLibraryInfo({ popular: res.data.popular, fewDependents: res.data.fewDependents });
        setNotListed(res.data.notListed || 0);
        // Only analyzed versions can be opened: show them alone when there are some
        if (firstLoad) setShowAll(!res.data.versions.some((v) => v.analyzed));
      } catch (err) {
        console.error("Error fetching versions:", err);
        setError(err.response?.data?.error || "Failed to fetch versions.");
      } finally {
        setLoadingVersions(false);
      }
    };

    fetchVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, versionsLoads]);

  useEffect(() => {
    getAnalyzeConfig()
      .then((res) => setAnalyzeConfig(res.data))
      .catch(() => setAnalyzeConfig({ enabled: false }));
  }, []);

  // Analysis runs of this library, polled while one is requested, queued or running, while
  // a finished run's results are not loaded yet, or while the backend is reloading the results.
  // The version list is fetched again when a run has succeeded, its results are loaded or a
  // reload has finished, so the version turns green without a page refresh.
  useEffect(() => {
    if (!library || !library.includes(":")) return;
    let timer = null;
    let stopped = false;
    let failures = 0;
    const poll = async () => {
      try {
        const res = await getAnalyzeStatus(library);
        if (stopped) return;
        failures = 0;
        const next = { ...res.data.versions };
        // Analyses started from this page stay "requested" until GitHub lists their run
        for (const [version, at] of Object.entries(localRequests.current)) {
          if (!next[version] && Date.now() - at < REQUEST_VISIBLE_MS) next[version] = { state: "requested", url: null };
        }
        const succeeded = Object.entries(next).some(([version, run]) =>
          run.state === "success" && previousRuns.current[version]?.state !== "success");
        const loaded = Object.entries(next).some(([version, run]) =>
          run.loaded && previousRuns.current[version]?.loaded === false);
        const reloaded = previousReloading.current && !res.data.reloading;
        previousRuns.current = next;
        previousReloading.current = res.data.reloading;
        setRuns(next);
        setResultsReloading(res.data.reloading);
        if ((succeeded && previousPolled.current) || loaded || reloaded) setVersionsLoads((n) => n + 1);
        previousPolled.current = true;
        const waiting = res.data.reloading || Object.values(next).some((run) =>
          ACTIVE_STATES.includes(run.state) || waitingForResults(run));
        if (waiting) timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        // A failed request is tried again, so a short network or GitHub problem does not stop the updates
        failures += 1;
        if (!stopped && failures < MAX_POLL_FAILURES) timer = setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [library, pollKey]);

  const handleAnalyze = async (version) => {
    const release = `${library}:${version}`;
    if (!window.confirm(
      `Start the analysis of ${release}?\n\nIt runs on GitHub and takes 10 to 15 minutes on average. ` +
      "You can leave this page. The version turns green here when the results are ready.")) {
      return;
    }
    setAnalyzeErrors((errors) => ({ ...errors, [version]: null }));
    try {
      const res = await startAnalysis(library, version);
      // Shown as requested until GitHub lists the run; polling starts again
      localRequests.current[version] = Date.now();
      setRuns((current) => ({ ...current, [version]: { state: "requested", url: res.data.url || null } }));
      setPollKey((n) => n + 1);
    } catch (err) {
      setAnalyzeErrors((errors) => ({
        ...errors,
        [version]: err.response?.data?.error || "Could not start the analysis.",
      }));
    }
  };

  const handleVersionSelect = (version) => {
    setVersion(version);
    // Automatically navigate to maintainer summary when version is selected
    navigate(pageUrl("/analysisV2/maintainer-summary", { library, version }), {
      state: { library, version }
    });
  };

  // Show error if no library
  if (!library) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header currentPage="user" />
        <div className="max-w-7xl mx-auto px-4 py-12 text-center">
          <p className="text-red-600 text-lg mb-4">Missing library.</p>
          <p className="text-gray-600 mb-6">Please select a library from the home page.</p>
          <button
            onClick={() => navigate("/")}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
          >
            Go to Home Page
          </button>
        </div>
      </div>
    );
  }

  // Show the versions of the library
  return (
      <div className="min-h-screen bg-gray-50">
        <Header currentPage="user" />
        
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 via-white to-blue-200 px-6 py-12">
          <div className="w-full max-w-4xl">
            
            <div className="text-center mb-8">
              <button
                onClick={() => navigate("/")}
                className="mb-4 text-gray-600 hover:text-gray-800 flex items-center mx-auto"
              >
                Back to Home
              </button>
              <h1 className="text-4xl font-bold text-blue-800 mb-3">
                Select a Version
              </h1>
              <p className="text-xl text-gray-700">
                Library: <span className="font-semibold text-blue-600">{library}</span>
              </p>
              {libraryInfo?.fewDependents && (
                <p className="mt-1 text-sm">
                  <FewDependentsBadge popular={libraryInfo.popular} />
                </p>
              )}
            </div>

            <div className="bg-white shadow-2xl rounded-2xl p-8 border border-gray-200">
              {loadingVersions && (
                <div className="text-center py-12">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <p className="text-gray-600 mt-4">Loading versions...</p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
                  {error}
                </div>
              )}

              {!loadingVersions && !error && versions.length === 0 && (
                <p className="text-gray-500 text-center py-8">
                  {notListed > 0
                    ? "None of its versions are listed because no project in our data uses them yet."
                    : "No versions found."}
                </p>
              )}

              {!loadingVersions && versions.length > 0 && (() => {
                const analyzedCount = versions.filter((v) => v.analyzed).length;
                // The cards show "v1.17.0": a leading v is not part of the version
                const filter = versionFilter.trim().toLowerCase().replace(/^v(?=\d)/, "");
                const shown = versions.filter((v) =>
                  (showAll || v.analyzed) && (!filter || v.version.toLowerCase().includes(filter)));
                return (
                <div>
                  <h2 className="text-lg font-semibold text-gray-700 mb-2">
                    {versions.length.toLocaleString()} {versions.length === 1 ? "version" : "versions"}, {analyzedCount} analyzed
                  </h2>
                  <p className="text-sm text-gray-600 mb-4">
                    Click a green version to see its results. Gray versions show how many projects list
                    them as a dependency.
                    {analyzeConfig?.enabled && " Press Analyze to study one of them. The analysis runs on GitHub and takes 10 to 15 minutes on average."}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                      <button
                        onClick={() => setShowAll(false)}
                        disabled={analyzedCount === 0}
                        className={`px-3 py-2 ${!showAll ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"} disabled:opacity-50`}
                      >
                        Analyzed ({analyzedCount})
                      </button>
                      <button
                        onClick={() => setShowAll(true)}
                        className={`px-3 py-2 border-l border-gray-300 ${showAll ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        All versions ({versions.length.toLocaleString()})
                      </button>
                    </div>
                    <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
                      <button
                        onClick={() => setSortBy("use")}
                        className={`px-3 py-2 ${sortBy === "use" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Most used first
                      </button>
                      <button
                        onClick={() => setSortBy("newest")}
                        className={`px-3 py-2 border-l border-gray-300 ${sortBy === "newest" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                      >
                        Newest first
                      </button>
                    </div>
                    {versions.length > 20 && (
                      <input
                        type="text"
                        value={versionFilter}
                        onChange={(e) => setVersionFilter(e.target.value)}
                        placeholder="Filter, for example 2.17"
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:border-blue-500 focus:outline-none"
                      />
                    )}
                    <span className="flex items-center gap-4 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-green-500 inline-block" /> Analyzed
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-amber-400 inline-block" /> Being analyzed
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 h-3 rounded bg-gray-300 inline-block" /> Not analyzed yet
                      </span>
                    </span>
                  </div>

                  {shown.length === 0 && (
                    <p className="text-gray-500 text-center py-8">No version matches "{versionFilter}".</p>
                  )}

                  {(() => {
                  const card = (v) => v.analyzed ? (
                      <button
                        key={v.version}
                        onClick={() => handleVersionSelect(v.version)}
                        className="text-left bg-green-50 hover:bg-green-600 text-gray-800 hover:text-white py-3 px-4 rounded-xl border-2 border-green-400 hover:border-green-600 transition-all hover:scale-105 shadow-md"
                      >
                        <span className="block font-semibold break-all">
                          v{v.version}
                          {v.dependents > 0 && v.analyzedProjects != null && (
                            <> <InfoIcon text={versionInfo(v)} /></>
                          )}
                        </span>
                        <span className="block text-xs mt-1">Analyzed, see the results</span>
                        {v.analysisSeconds != null && (
                          <span className="block text-xs mt-1">Analysis took {duration(v.analysisSeconds)}</span>
                        )}
                      </button>
                    ) : (() => {
                      const run = runs[v.version];
                      const active = run && ACTIVE_STATES.includes(run.state);
                      const failed = run && FAILED_STATES.includes(run.state);
                      const canAnalyze = analyzeConfig?.enabled && v.inIndex && v.dependents > 0;
                      // The run on GitHub Actions, or the workflow's list of runs before GitHub lists it
                      const runUrl = run?.url || (analyzeConfig?.repo
                        && `https://github.com/${analyzeConfig.repo}/actions/workflows/analyze-library.yml`);
                      const githubLink = (text) => runUrl && (
                        <a href={runUrl} target="_blank" rel="noopener noreferrer"
                           className="text-xs underline hover:no-underline">{text}</a>
                      );
                      if (active) {
                        return (
                          <div key={v.version} className="bg-amber-50 text-amber-900 py-3 px-4 rounded-xl border-2 border-amber-400">
                            <span className="block font-semibold break-all">v{v.version}</span>
                            <span className="block text-xs mt-1 font-semibold">{runLabel(run)}</span>
                            {run.step && <span className="block text-xs mt-1">{stepLabel(run.step)}</span>}
                            <span className="block mt-1">{githubLink("Follow it on GitHub")}</span>
                          </div>
                        );
                      }
                      if (run && run.state === "success" && (resultsReloading || run.loaded !== false)) {
                        return (
                          <div key={v.version} className="bg-green-50 text-green-900 py-3 px-4 rounded-xl border-2 border-dashed border-green-400">
                            <span className="block font-semibold break-all">v{v.version}</span>
                            <span className="block text-xs mt-1">Finished. Loading the results...</span>
                          </div>
                        );
                      }
                      if (run && run.state === "success") {
                        return (
                          <div key={v.version} className="bg-gray-50 text-gray-600 py-3 px-4 rounded-xl border-2 border-dashed border-gray-300">
                            <span className="block font-semibold break-all">v{v.version}</span>
                            <span className="block text-xs mt-1">
                              The analysis finished but had no results to publish. This happens when
                              none of the projects actually call the library. {githubLink("See the run on GitHub")}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={v.version}
                          className="bg-gray-50 text-gray-500 py-3 px-4 rounded-xl border-2 border-dashed border-gray-300"
                        >
                          <span className="block font-semibold break-all">v{v.version}</span>
                          <span className="block text-xs mt-1">Not analyzed yet</span>
                          <span className="block text-xs">
                            {v.dependents > 0
                              ? `Used by ${v.dependents.toLocaleString()} ${v.dependents === 1 ? "project" : "projects"}`
                              : "Only used in tests"}
                          </span>
                          {failed && (
                            <span className="block text-xs mt-1 text-red-700">
                              The last analysis did not finish. {githubLink("See why on GitHub")}
                            </span>
                          )}
                          {canAnalyze && (
                            <button
                              onClick={() => handleAnalyze(v.version)}
                              className="mt-2 text-xs font-semibold bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition"
                            >
                              {failed ? "Analyze again" : "Analyze"}
                            </button>
                          )}
                          {analyzeErrors[v.version] && (
                            <span className="block text-xs mt-1 text-red-700">{analyzeErrors[v.version]}</span>
                          )}
                        </div>
                      );
                    })();
                  const grid = (list) => (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {list.map(card)}
                    </div>
                  );
                  // Newest first is the order the backend sends
                  if (sortBy === "newest") {
                    return <div className="max-h-[500px] overflow-y-auto p-2">{grid(shown)}</div>;
                  }
                  const byUse = (a, b) => (Number(b.dependents) || 0) - (Number(a.dependents) || 0);
                  return (
                    <div className="max-h-[500px] overflow-y-auto p-2 space-y-6">
                      {USAGE_GROUPS.map(([usage, title]) => {
                        const list = shown.filter((v) => (v.usage || "rare") === usage).sort(byUse);
                        return list.length > 0 && (
                          <section key={usage}>
                            <h3 className="text-sm font-semibold text-gray-700 mb-3">
                              {title} ({list.length.toLocaleString()})
                            </h3>
                            {grid(list)}
                          </section>
                        );
                      })}
                    </div>
                  );
                  })()}
                </div>
                );
              })()}

              {!loadingVersions && !error && notListed > 0 && snapshot && (
                <p className="text-sm text-gray-500 mt-6">
                  Our dashboard contains insights from Maven Central dump as of {longDate(snapshot)}, so
                  newer releases are not in it yet. We also exclude versions for which no direct dependent
                  projects are found.
                </p>
              )}
            </div>

            <footer className="mt-8 text-gray-500 text-sm text-center">
              Click a green version to see its results
            </footer>
          </div>
        </div>
      </div>
  );
};

export default AnalysisPage;