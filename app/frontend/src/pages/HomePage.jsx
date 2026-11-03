
// import { useNavigate } from "react-router-dom";
// import React, { useState } from "react";
// import { searchLibraries } from "../services/api";
// import Header from "../components/Header";
// import { useLibrary } from "../context/LibraryContext";
// import "../index.css";

// const HomePage = () => {
//   const [libraries, setLibraries] = useState([]);
//   const [selectedLib, setSelectedLib] = useState("");
//   const [loading, setLoading] = useState(false);
//   const [searchQuery, setSearchQuery] = useState("");

//   const navigate = useNavigate();
//   const { setLibrary } = useLibrary();

//   const handleSearch = async () => {
//     if (!searchQuery.trim()) return;
    
//     setLoading(true);
//     setSelectedLib("");

//     try {
//       const res = await searchLibraries(searchQuery);
//       setLibraries(res.data);
//     } catch (err) {
//       alert("Error fetching libraries");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleKeyPress = (e) => {
//     if (e.key === 'Enter') {
//       handleSearch();
//     }
//   };

//   const handleSelectLibrary = (lib) => {
//     console.log("Selected library:", lib);
//     setSelectedLib(lib);
//     setLibrary(lib); // Update context
//   };

//   const handleViewAnalysis = () => {
//   console.log(" Navigating to analysis with library:", selectedLib);
//   if (!selectedLib) {
//     alert("Please select a library first");
//     return;
//   }
//   navigate("/analysisV2", {
//     state: { library: selectedLib },
//     replace: true  // Add this line
//   });
// };

//   const handleDecline = () => {
//     setSelectedLib("");
//     setLibraries([]);
//     setSearchQuery("");
//   };

//   return (
//     <div className="min-h-screen bg-gray-50">
//       <Header currentPage="home" />
      
//       <div className="min-h-screen flex flex-col justify-center items-center bg-gradient-to-br from-blue-100 via-white to-blue-200 font-sans px-6 py-8 bridge-overlay">
//         <div className="w-full max-w-3xl">
          
//           {/* Main Card */}
//           <div className="bg-white/95 backdrop-blur shadow-2xl rounded-3xl overflow-hidden border border-gray-200">
            
//             {/* Title Section */}
//             <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-10 py-12 text-center">
//               <h1 className="text-5xl font-extrabold mb-3">
//                 OSSBridge
//               </h1>
//               <p className="text-blue-100 text-lg">
//                 Explore open-source library dependencies
//               </p>
//             </div>

//             {/* Search Section */}
//             <div className="p-10">
              
//               {/* Search input */}
//               {!selectedLib && (
//                 <div className="mb-6">
//                   <div className="relative">
//                     <input
//                       type="text"
//                       value={searchQuery}
//                       onChange={(e) => setSearchQuery(e.target.value)}
//                       onKeyPress={handleKeyPress}
//                       placeholder="Search for a library..."
//                       className="w-full px-5 py-4 pr-28 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:outline-none text-lg shadow-sm"
//                     />
//                     <button
//                       onClick={handleSearch}
//                       className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 transition"
//                     >
//                       <svg 
//                         xmlns="http://www.w3.org/2000/svg" 
//                         width="20" 
//                         height="20" 
//                         viewBox="0 0 24 24" 
//                         fill="none" 
//                         stroke="currentColor" 
//                         strokeWidth="2" 
//                         strokeLinecap="round" 
//                         strokeLinejoin="round"
//                       >
//                         <circle cx="11" cy="11" r="8"></circle>
//                         <path d="m21 21-4.35-4.35"></path>
//                       </svg>
//                     </button>
//                   </div>
//                 </div>
//               )}

//               {loading && (
//                 <p className="text-gray-500 py-6 text-center">Searching...</p>
//               )}

//               {/* Library selection dropdown */}
//               {!loading && libraries.length > 0 && !selectedLib && (
//                 <div>
//                   <label className="block mb-3 font-semibold text-gray-700 text-lg">
//                     Select a library:
//                   </label>
//                   <select
//                     className="w-full border-2 border-gray-300 p-4 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:outline-none text-lg shadow-sm"
//                     value={selectedLib}
//                     onChange={(e) => handleSelectLibrary(e.target.value)}
//                   >
//                     <option value="">-- Choose a library --</option>
//                     {libraries.map((lib, i) => (
//                       <option key={i} value={lib}>
//                         {lib}
//                       </option>
//                     ))}
//                   </select>
//                 </div>
//               )}

//               {/* Explore prompt */}
//               {selectedLib && (
//                 <div>
//                   <div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl border-2 border-blue-200">
//                     <p className="text-2xl font-bold text-gray-800 mb-2">
//                       {selectedLib}
//                     </p>
//                     <p className="text-gray-600 text-lg">
//                       Ready to explore dependencies?
//                     </p>
//                   </div>
                  
//                   <div className="flex justify-center gap-5">
//                     <button
//                       onClick={handleViewAnalysis}
//                       className="bg-blue-600 text-white px-12 py-4 rounded-xl shadow-lg hover:bg-blue-700 transition-all hover:scale-105 font-semibold text-lg"
//                     >
//                       Explore Analysis
//                     </button>
//                     <button
//                       onClick={handleDecline}
//                       className="bg-gray-400 text-white px-12 py-4 rounded-xl shadow-lg hover:bg-gray-500 transition-all hover:scale-105 font-semibold text-lg"
//                     >
//                       Search Again
//                     </button>
//                   </div>
//                 </div>
//               )}
//             </div>
//           </div>

//           {/* Footer */}
//           <footer className="mt-8 text-gray-600 text-sm text-center">
//             © {new Date().getFullYear()} OSSBridge — Empowering Open Source Analysis
//           </footer>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default HomePage;


import { useNavigate } from "react-router-dom";
import React, { useState } from "react";
import { searchLibraries } from "../services/api";
import Header from "../components/Header";
import { pageUrl } from "../utils/pageUrl";
import { useLibrary } from "../context/LibraryContext";
import "../index.css";

const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

// Whether any version of a library has been analyzed
const StatusBadge = ({ analyzedVersions }) =>
  analyzedVersions > 0 ? (
    <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-800 border border-green-300">
      Analyzed: {plural(analyzedVersions, "version")}
    </span>
  ) : (
    <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600 border border-gray-300">
      Not analyzed yet
    </span>
  );

const HomePage = () => {
  const [libraries, setLibraries] = useState([]);
  const [selectedLib, setSelectedLib] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searched, setSearched] = useState(false);

  const navigate = useNavigate();
  const { setLibrary } = useLibrary();

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setSelectedLib("");

    try {
      const res = await searchLibraries(searchQuery.trim());
      setLibraries(res.data);
      setSearched(true);
    } catch (err) {
      alert("Error fetching libraries");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleSelectLibrary = (lib) => {
    console.log("Selected library:", lib);
    setSelectedLib(lib);
    setLibrary(lib);
  };

  const selectedInfo = libraries.find((lib) => lib.library === selectedLib);

  const handleViewAnalysis = () => {
    console.log(" Navigating to analysis with library:", selectedLib);
    if (!selectedLib) {
      alert("Please select a library first");
      return;
    }
    navigate(pageUrl("/analysisV2", { library: selectedLib }), {
      state: { library: selectedLib },
      replace: true
    });
  };

  const handleDecline = () => {
    setSelectedLib("");
    setLibraries([]);
    setSearchQuery("");
    setSearched(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentPage="home" />
      
      <div className="min-h-screen flex flex-col justify-center items-center font-sans px-6 py-12 bridge-overlay relative">
        <div className="w-full max-w-3xl relative z-10">
          
          {/* Main Card - More transparent to show background */}
          <div className="bg-white/70 backdrop-blur-sm shadow-2xl rounded-3xl overflow-hidden border border-gray-200">
            
            {/* Title Section - Simpler */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-800 text-white px-10 py-10 text-center">
              <h1 className="text-5xl font-extrabold mb-3">
                OSSBridge
              </h1>
              <p className="text-blue-100 text-lg">
                Explore open-source library dependencies
              </p>
            </div>

            {/* Search Section */}
            <div className="p-10">
              
              {/* Search input */}
              {!selectedLib && (
                <div className="mb-6">
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyPress={handleKeyPress}
                      placeholder="Search any Java library on Maven Central (ex. jackson-databind)..."
                      className="w-full px-5 py-4 pr-14 border-2 border-gray-300 rounded-xl focus:border-blue-500 focus:outline-none text-lg shadow-sm"
                    />
                    <button
                      onClick={handleSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                    >
                      Search
                    </button>
                  </div>
                </div>
              )}

              {loading && (
                <p className="text-gray-500 py-6 text-center">Searching...</p>
              )}

              {!loading && searched && libraries.length === 0 && !selectedLib && (
                <p className="text-gray-500 py-6 text-center">
                  No library matches "{searchQuery}". Search by groupId or artifactId, e.g. jackson-databind.
                </p>
              )}

              {/* Matching libraries, analyzed ones first */}
              {!loading && libraries.length > 0 && !selectedLib && (
                <div>
                  <label className="block mb-1 font-semibold text-gray-700 text-lg">
                    Select a library:
                  </label>
                  <p className="text-sm text-gray-500 mb-3">
                    Libraries with analyzed versions are listed first
                    {libraries.length === 50 ? "; showing the first 50 matches, refine the search to see others" : ""}.
                  </p>
                  <ul className="max-h-96 overflow-y-auto border-2 border-gray-200 rounded-xl divide-y divide-gray-200 bg-white">
                    {libraries.map((lib) => (
                      <li key={lib.library}>
                        <button
                          onClick={() => handleSelectLibrary(lib.library)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 transition flex items-center justify-between gap-3"
                        >
                          <span className="min-w-0">
                            <span className="block font-mono text-sm text-gray-800 break-all">{lib.library}</span>
                            <span className="block text-xs text-gray-500 mt-1">
                              {lib.inIndex
                                ? `${plural(lib.indexVersions, "version")}, ${plural(lib.dependents, "dependent project")}`
                                : lib.mavenVersions
                                  ? `${plural(lib.mavenVersions, "version")} on Maven Central, no dependents in the snapshot`
                                  : "Not in the dependents index"}
                            </span>
                          </span>
                          <StatusBadge analyzedVersions={lib.analyzedVersions} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Explore prompt */}
              {selectedLib && (
                <div>
                  <div className="mb-8 p-6 bg-gradient-to-r from-blue-50 to-blue-100 rounded-xl border-2 border-blue-200">
                    <p className="text-2xl font-bold text-gray-800 mb-2 break-all">
                      {selectedLib}
                    </p>
                    <p className="text-gray-600 text-lg">
                      {selectedInfo && selectedInfo.analyzedVersions > 0
                        ? `${plural(selectedInfo.analyzedVersions, "analyzed version")}. Explore them, or see which versions are not analyzed yet.`
                        : "No version of this library has been analyzed yet. See its versions and their dependents."}
                    </p>
                  </div>
                  
                  <div className="flex justify-center gap-5">
                    <button
                      onClick={handleViewAnalysis}
                      className="bg-blue-600 text-white px-12 py-4 rounded-xl shadow-lg hover:bg-blue-700 transition-all hover:scale-105 font-semibold text-lg"
                    >
                      {selectedInfo && selectedInfo.analyzedVersions > 0 ? "Explore Analysis" : "See Versions"}
                    </button>
                    <button
                      onClick={handleDecline}
                      className="bg-gray-400 text-white px-12 py-4 rounded-xl shadow-lg hover:bg-gray-500 transition-all hover:scale-105 font-semibold text-lg"
                    >
                      Search Again
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-8 text-gray-600 text-sm text-center">
            © {new Date().getFullYear()} OSSBridge — Empowering Open Source Analysis
          </footer>
        </div>
      </div>
    </div>
  );
};

export default HomePage;