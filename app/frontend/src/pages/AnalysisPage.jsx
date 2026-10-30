


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

//   console.log("🎯 AnalysisPage mounted!");
//   console.log("📦 Received library:", library);
//   console.log("📦 Received version:", stateVersion);

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
//                 ← Back to Home
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
//               ← Change Version
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
//                         console.log("🚀 Navigating to dependent with:", { library, version: selectedVersion, dependent: d.dependent });
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




import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getVersions } from "../services/api";
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

const AnalysisPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const { library: contextLibrary, setLibrary, setVersion } = useLibrary();
  const stateLibrary = location.state?.library;
  const stateVersion = location.state?.version;
  
  const library = stateLibrary || contextLibrary;

  console.log("🎯 AnalysisPage mounted!");
  console.log("📦 Received library:", library);
  console.log("📦 Received version:", stateVersion);

  const [versions, setVersions] = useState([]);
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
      console.log("⚠️ No library, skipping version fetch");
      return;
    }

    const fetchVersions = async () => {
      setLoadingVersions(true);
      setError("");
      try {
        const cleanLibrary = library.includes(":")
          ? library.split(":").pop()
          : library;

        console.log("📡 Fetching versions for:", cleanLibrary);
        const res = await getVersions(cleanLibrary);
        console.log("✅ Got versions:", res.data);
        setVersions(res.data);
      } catch (err) {
        console.error("❌ Error fetching versions:", err);
        setError("Failed to fetch versions.");
      } finally {
        setLoadingVersions(false);
      }
    };

    fetchVersions();
  }, [library]);

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

        console.log("📊 Fetching analysis for:", cleanLibrary, selectedVersion);
        const res = await axios.get(`${API_BASE_URL}/api/analysisV2/usage`, {
          params: { library: cleanLibrary, version: selectedVersion, top },
        });

        console.log("✅ Got analysis data:", res.data);
        setData(res.data);
      } catch (err) {
        console.error("❌ Error fetching analysis:", err);
        setError("Failed to fetch analysis data.");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalysis();
  }, [library, selectedVersion, top]);

  const handleVersionSelect = (version) => {
    console.log("✅ Selected version:", version);
    setSelectedVersion(version);
    setVersion(version);
    // Automatically navigate to maintainer summary when version is selected
    navigate("/analysisV2/maintainer-summary", { 
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
                ← Back to Home
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
                <p className="text-gray-500 text-center py-8">No versions found.</p>
              )}

              {!loadingVersions && versions.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-700 mb-6">
                    Available Versions ({versions.length})
                  </h2>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto p-2">
                    {versions.map((version, i) => (
                      <button
                        key={i}
                        onClick={() => handleVersionSelect(version)}
                        className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-600 hover:to-blue-700 text-gray-800 hover:text-white font-semibold py-4 px-4 rounded-xl border-2 border-blue-200 hover:border-blue-600 transition-all hover:scale-105 shadow-md"
                      >
                        v{version}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <footer className="mt-8 text-gray-500 text-sm text-center">
              Click on any version to view the maintainer summary
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
              ← Change Version
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
                        console.log("🚀 Navigating to dependent with:", { library, version: selectedVersion, dependent: d.dependent });
                        navigate("/analysisV2/dependent", {
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