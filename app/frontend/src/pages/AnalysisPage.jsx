


// import React, { useEffect, useState } from "react";
// import { useLocation, useNavigate } from "react-router-dom";
// import { getVersions } from "../services/api";
// import axios from "axios";
// import {
//   BarChart,
//   Bar,
//   XAxis,
//   YAxis,
//   Tooltip,
//   CartesianGrid,
//   ResponsiveContainer,
//   Legend,
// } from "recharts";
// import Header from "../components/Header";
// import { useLibrary } from "../context/LibraryContext";
// import MethodSearchButton from "../components/MethodSearchButton";
// import API_BASE_URL from '../services/api';

// const AnalysisPage = () => {
//   const location = useLocation();
//   const navigate = useNavigate();
  
//   const { library: contextLibrary, setLibrary, setVersion } = useLibrary();
//   const stateLibrary = location.state?.library;
//   const stateVersion = location.state?.version;
  
//   const library = stateLibrary || contextLibrary;

//   console.log("AnalysisPage mounted!");
//   console.log("Received library:", library);
//   console.log("Received version:", stateVersion);

//   const [versions, setVersions] = useState([]);
//   const [selectedVersion, setSelectedVersion] = useState(stateVersion || "");
//   const [data, setData] = useState(null);
//   const [top, setTop] = useState(10);
//   const [loading, setLoading] = useState(false);
//   const [loadingVersions, setLoadingVersions] = useState(false);
//   const [error, setError] = useState("");

//   // Update context when library comes from navigation
//   useEffect(() => {
//     if (stateLibrary) {
//       console.log("Setting library in context:", stateLibrary);
//       setLibrary(stateLibrary);
//     }
//   }, [stateLibrary, setLibrary]);

//   // Fetch versions when library is available
//   useEffect(() => {
//     if (!library) {
//       console.log(" No library, skipping version fetch");
//       return;
//     }

//     const fetchVersions = async () => {
//       setLoadingVersions(true);
//       setError("");
//       try {
//         const cleanLibrary = library.includes(":")
//           ? library.split(":").pop()
//           : library;

//         console.log(" Fetching versions for:", cleanLibrary);
//         const res = await getVersions(cleanLibrary);
//         console.log(" Got versions:", res.data);
//         setVersions(res.data);
//       } catch (err) {
//         console.error(" Error fetching versions:", err);
//         setError("Failed to fetch versions.");
//       } finally {
//         setLoadingVersions(false);
//       }
//     };

//     fetchVersions();
//   }, [library]);

//   // Fetch analysis data when version is selected
//   useEffect(() => {
//     if (!library || !selectedVersion) return;

//     const fetchAnalysis = async () => {
//       setLoading(true);
//       setError("");
//       try {
//         const cleanLibrary = library.includes(":")
//           ? library.split(":").pop()
//           : library;

//         console.log(" Fetching analysis for:", cleanLibrary, selectedVersion);
//         const res = await axios.get(`${API_BASE_URL}/api/analysisV2/usage`, {
//           params: { library: cleanLibrary, version: selectedVersion, top },
//         });

//         console.log(" Got analysis data:", res.data);
//         setData(res.data);
//       } catch (err) {
//         console.error(" Error fetching analysis:", err);
//         setError("Failed to fetch analysis data.");
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchAnalysis();
//   }, [library, selectedVersion, top]);

//   const handleVersionSelect = (version) => {
//     console.log(" Selected version:", version);
//     setSelectedVersion(version);
//     setVersion(version);
//   };

//   // Show error if no library
//   if (!library) {
//     return (
//       <div className="min-h-screen bg-gray-50">
//         <Header currentPage="user" />
//         <div className="max-w-7xl mx-auto px-4 py-12 text-center">
//           <p className="text-red-600 text-lg mb-4">Missing library.</p>
//           <p className="text-gray-600 mb-6">Please select a library from the home page.</p>
//           <button
//             onClick={() => navigate("/")}
//             className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
//           >
//             Go to Home Page
//           </button>
//         </div>
//       </div>
//     );
//   }

//   // Show version selection if no version selected
//   if (!selectedVersion) {
//     return (
//       <div className="min-h-screen bg-gray-50">
//         <Header currentPage="user" />
        
//         <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-100 via-white to-blue-200 px-6 py-12">
//           <div className="w-full max-w-4xl">
            
//             <div className="text-center mb-8">
//               <button
//                 onClick={() => navigate("/")}
//                 className="mb-4 text-gray-600 hover:text-gray-800 flex items-center mx-auto"
//               >
//                 Back to Home
//               </button>
//               <h1 className="text-4xl font-bold text-blue-800 mb-3">
//                 Select a Version
//               </h1>
//               <p className="text-xl text-gray-700">
//                 Library: <span className="font-semibold text-blue-600">{library}</span>
//               </p>
//             </div>

//             <div className="bg-white shadow-2xl rounded-2xl p-8 border border-gray-200">
//               {loadingVersions && (
//                 <div className="text-center py-12">
//                   <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
//                   <p className="text-gray-600 mt-4">Loading versions...</p>
//                 </div>
//               )}

//               {error && (
//                 <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
//                   {error}
//                 </div>
//               )}

//               {!loadingVersions && !error && versions.length === 0 && (
//                 <p className="text-gray-500 text-center py-8">No versions found.</p>
//               )}

//               {!loadingVersions && versions.length > 0 && (
//                 <div>
//                   <h2 className="text-lg font-semibold text-gray-700 mb-6">
//                     Available Versions ({versions.length})
//                   </h2>
                  
//                   <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto p-2">
//                     {versions.map((version, i) => (
//                       <button
//                         key={i}
//                         onClick={() => handleVersionSelect(version)}
//                         className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-600 hover:to-blue-700 text-gray-800 hover:text-white font-semibold py-4 px-4 rounded-xl border-2 border-blue-200 hover:border-blue-600 transition-all hover:scale-105 shadow-md"
//                       >
//                         v{version}
//                       </button>
//                     ))}
//                   </div>
//                 </div>
//               )}
//             </div>

//             <footer className="mt-8 text-gray-500 text-sm text-center">
//               Click on any version to view its analysis
//             </footer>
//           </div>
//         </div>
//       </div>
//     );
//   }

//   // Show analysis after version is selected
//   return (
//     <div className="min-h-screen bg-gray-50">
//       <Header currentPage="user" />
      
//       {/* Version navbar */}
//       <div className="bg-white shadow-md border-b sticky top-0 z-50">
//         <div className="max-w-7xl mx-auto px-6 py-4">
//           <div className="flex items-center justify-between">
//             <button
//               onClick={() => setSelectedVersion("")}
//               className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition"
//             >
//               Change Version
//             </button>
//             <h1 className="text-xl font-bold text-gray-800">
//               {library} <span className="text-blue-600">v{selectedVersion}</span>
//             </h1>
//             <MethodSearchButton library={library} version={selectedVersion} />
//           </div>
//         </div>
//       </div>

//       <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
//         {loading && (
//           <div className="text-center py-12">
//             <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
//             <p className="text-gray-600 mt-4">Loading analysis...</p>
//           </div>
//         )}
        
//         {error && (
//           <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
//             {error}
//           </div>
//         )}

//         {data && (
//           <div className="space-y-8">
//             {/* Stats Cards */}
//             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
//               <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
//                 <h2 className="text-sm font-semibold text-gray-600 mb-2">Mean</h2>
//                 <p className="text-3xl font-bold text-blue-600">
//                   {data.mean.toFixed(2)}
//                 </p>
//                 <p className="text-xs text-gray-500 mt-1">APIs per dependent</p>
//               </div>
//               <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
//                 <h2 className="text-sm font-semibold text-gray-600 mb-2">Median</h2>
//                 <p className="text-3xl font-bold text-green-600">
//                   {data.median.toFixed(2)}
//                 </p>
//                 <p className="text-xs text-gray-500 mt-1">APIs per dependent</p>
//               </div>
//               <div className="bg-white p-6 rounded-lg shadow border-l-4 border-orange-500">
//                 <h2 className="text-sm font-semibold text-gray-600 mb-2">Max</h2>
//                 <p className="text-3xl font-bold text-orange-600">{data.max}</p>
//                 <p className="text-xs text-gray-500 mt-1">Most APIs used</p>
//               </div>
//             </div>

//             {/* Chart */}
//             <div className="bg-white p-6 rounded-lg shadow">
//               <div className="flex justify-between items-center mb-6">
//                 <h3 className="text-lg font-semibold text-gray-700">
//                   API Usage Distribution
//                 </h3>
//                 <div className="flex items-center gap-3">
//                   <label className="text-sm font-medium text-gray-700">
//                     Show top dependents:
//                   </label>
//                   <select
//                     value={top}
//                     onChange={(e) => setTop(Number(e.target.value))}
//                     className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
//                   >
//                     <option value={10}>Top 10</option>
//                     <option value={20}>Top 20</option>
//                     <option value={50}>Top 50</option>
//                     <option value={data.topDependents.length}>All</option>
//                   </select>
//                 </div>
//               </div>

//               <ResponsiveContainer width="100%" height={400}>
//                 <BarChart data={data.topDependents}>
//                   <CartesianGrid strokeDasharray="3 3" />
//                   <XAxis dataKey="dependent" tick={false} />
//                   <YAxis />
//                   <Tooltip />
//                   <Legend />
//                   <Bar dataKey="apisUsed" fill="#3B82F6" name="APIs Used" barSize={40} />
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>

//             {/* Dependents List */}
//             <div className="bg-white rounded-lg shadow">
//               <div className="p-6">
//                 <h3 className="text-lg font-semibold mb-4 text-gray-700">
//                   Top Dependents (click to explore)
//                 </h3>
//                 <ul className="divide-y divide-gray-200">
//                   {data.topDependents.map((d, i) => (
//                     <li
//                       key={i}
//                       onClick={() => {
//                         console.log("Navigating to dependent with:", { library, version: selectedVersion, dependent: d.dependent });
//                         navigate("/analysisV2/dependent", {
//                           state: { library, version: selectedVersion, dependent: d.dependent },
//                         });
//                       }}
//                       className="px-4 py-4 hover:bg-blue-50 cursor-pointer transition flex justify-between items-center"
//                     >
//                       <span className="font-medium text-blue-700">{d.dependent}</span>
//                       <span className="text-gray-600 text-sm">
//                         {d.apisUsed} APIs used
//                       </span>
//                     </li>
//                   ))}
//                 </ul>
//               </div>
//             </div>

//             {/* Maintainer Summary Button */}
//             <div className="text-center">
//               <button
//                 onClick={() =>
//                   navigate("/analysisV2/maintainer-summary", { state: { library, version: selectedVersion } })
//                 }
//                 className="bg-green-600 text-white px-8 py-3 rounded-lg shadow-lg hover:bg-green-700 transition-all hover:scale-105 font-semibold"
//               >
//                 View Maintainer Summary
//               </button>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default AnalysisPage;




import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getLibraryVersions, getAnalyzeConfig, getAnalyzeStatus, startAnalysis } from "../services/api";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";
import Header from "../components/Header";
import { useLibrary } from "../context/LibraryContext";
import MethodSearchButton from "../components/MethodSearchButton";
import API_BASE_URL from '../services/api';
import { pageParam, pageUrl } from "../utils/pageUrl";

// Analysis run states (GitHub Actions run status, or "requested" before GitHub lists it)
const ACTIVE_STATES = ["requested", "queued", "waiting", "pending", "in_progress"];
const FAILED_STATES = ["failure", "cancelled", "timed_out", "startup_failure"];
const POLL_MS = 20000;
const REQUEST_VISIBLE_MS = 3 * 60 * 1000;

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
  const stateVersion = pageParam(location, "version");

  const library = stateLibrary || contextLibrary;

  console.log("AnalysisPage mounted!");
  console.log("Received library:", library);
  console.log("Received version:", stateVersion);

  // [{ version, dependents, analyzed, inIndex }], newest first
  const [versions, setVersions] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
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
  const [selectedVersion, setSelectedVersion] = useState(stateVersion || "");
  const [data, setData] = useState(null);
  const [top, setTop] = useState(10);
  const [loading, setLoading] = useState(false);
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

  // Analysis runs of this library, polled while one is requested, queued or running or
  // the backend is reloading the results. The version list is fetched again when a run
  // has succeeded or a reload has finished, so the version turns green.
  useEffect(() => {
    if (!library || !library.includes(":")) return;
    let timer = null;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await getAnalyzeStatus(library);
        if (stopped) return;
        const next = { ...res.data.versions };
        // Analyses started from this page stay "requested" until GitHub lists their run
        for (const [version, at] of Object.entries(localRequests.current)) {
          if (!next[version] && Date.now() - at < REQUEST_VISIBLE_MS) next[version] = { state: "requested", url: null };
        }
        const succeeded = Object.entries(next).some(([version, run]) =>
          run.state === "success" && previousRuns.current[version]?.state !== "success");
        const reloaded = previousReloading.current && !res.data.reloading;
        previousRuns.current = next;
        previousReloading.current = res.data.reloading;
        setRuns(next);
        setResultsReloading(res.data.reloading);
        if ((succeeded && previousPolled.current) || reloaded) setVersionsLoads((n) => n + 1);
        previousPolled.current = true;
        const waiting = res.data.reloading || Object.values(next).some((run) => ACTIVE_STATES.includes(run.state));
        if (waiting) timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        // Progress is shown again on the next poll or page load
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

  // Fetch analysis data when version is selected
  useEffect(() => {
    if (!library || !selectedVersion) return;

    const fetchAnalysis = async () => {
      setLoading(true);
      setError("");
      try {
        const cleanLibrary = library.includes(":")
          ? library.split(":").pop()
          : library;

        console.log("Fetching analysis for:", cleanLibrary, selectedVersion);
        const res = await axios.get(`${API_BASE_URL}/api/analysisV2/usage`, {
          params: { library: cleanLibrary, version: selectedVersion, top },
        });

        console.log("Got analysis data:", res.data);
        setData(res.data);
      } catch (err) {
        console.error("Error fetching analysis:", err);
        setError(err.response?.status === 404
          ? `${library} ${selectedVersion} has not been analyzed yet.`
          : "Failed to fetch analysis data.");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, [library, selectedVersion, top]);

  const handleVersionSelect = (version) => {
    console.log("Selected version:", version);
    setSelectedVersion(version);
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

  // Show version selection if no version selected
  if (!selectedVersion) {
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
                    Click a green version to see its results. For the other versions you can see how many
                    projects use them.
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

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto p-2">
                    {shown.map((v) => v.analyzed ? (
                      <button
                        key={v.version}
                        onClick={() => handleVersionSelect(v.version)}
                        className="text-left bg-green-50 hover:bg-green-600 text-gray-800 hover:text-white py-3 px-4 rounded-xl border-2 border-green-400 hover:border-green-600 transition-all hover:scale-105 shadow-md"
                      >
                        <span className="block font-semibold break-all">v{v.version}</span>
                        <span className="block text-xs mt-1">Analyzed, see the results</span>
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
                    })())}
                  </div>
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
  }

  // Show analysis after version is selected (User Summary view)
  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentPage="user" />
      
      {/* Version navbar */}
      <div className="bg-white shadow-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedVersion("")}
              className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition"
            >
              Change Version
            </button>
            <h1 className="text-xl font-bold text-gray-800">
              {library} <span className="text-blue-600">v{selectedVersion}</span>
            </h1>
            <MethodSearchButton library={library} version={selectedVersion} />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="text-gray-600 mt-4">Loading analysis...</p>
          </div>
        )}
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-8">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Mean</h2>
                <p className="text-3xl font-bold text-blue-600">
                  {data.mean.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500 mt-1">APIs per dependent</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Median</h2>
                <p className="text-3xl font-bold text-green-600">
                  {data.median.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500 mt-1">APIs per dependent</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-orange-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Max</h2>
                <p className="text-3xl font-bold text-orange-600">{data.max}</p>
                <p className="text-xs text-gray-500 mt-1">Most APIs used</p>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-white p-6 rounded-lg shadow">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-700">
                  API Usage Distribution
                </h3>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-700">
                    Show top dependents:
                  </label>
                  <select
                    value={top}
                    onChange={(e) => setTop(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value={10}>Top 10</option>
                    <option value={20}>Top 20</option>
                    <option value={50}>Top 50</option>
                    <option value={data.topDependents.length}>All</option>
                  </select>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={data.topDependents}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dependent" tick={false} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="apisUsed" fill="#3B82F6" name="APIs Used" barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Dependents List */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">
                  Top Dependents (click to explore)
                </h3>
                <ul className="divide-y divide-gray-200">
                  {data.topDependents.map((d, i) => (
                    <li
                      key={i}
                      onClick={() => {
                        console.log("Navigating to dependent with:", { library, version: selectedVersion, dependent: d.dependent });
                        navigate(pageUrl("/analysisV2/dependent", { library, version: selectedVersion, dependent: d.dependent }), {
                          state: { library, version: selectedVersion, dependent: d.dependent },
                        });
                      }}
                      className="px-4 py-4 hover:bg-blue-50 cursor-pointer transition flex justify-between items-center"
                    >
                      <span className="font-medium text-blue-700">{d.dependent}</span>
                      <span className="text-gray-600 text-sm">
                        {d.apisUsed} APIs used
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisPage;