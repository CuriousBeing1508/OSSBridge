import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  PieChart,
  Pie,
  Cell,
} from "recharts";
import Header from "../components/Header";
import { useLibrary } from "../context/LibraryContext";

import MethodSearchButton from "../components/MethodSearchButton";
import API_BASE_URL from '../services/api';
import { pageParam, pageUrl } from "../utils/pageUrl";
const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#22C55E", "#6366F1"
];

// Pie chart slices with a value: a zero slice has no area but would still get a label
const pieSlices = (slices) => slices.filter((slice) => slice.value > 0);

const MaintainerSummaryPage = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const { library: contextLibrary, version: contextVersion, setLibrary, setVersion } = useLibrary();
  const stateLibrary = pageParam(location, "library");
  const stateVersion = pageParam(location, "version");

  const library = stateLibrary || contextLibrary;
  const version = stateVersion || contextVersion;

  useEffect(() => {
    if (stateLibrary && stateVersion) {
      setLibrary(stateLibrary);
      setVersion(stateVersion);
    }
  }, [stateLibrary, stateVersion, setLibrary, setVersion]);

  const [data, setData] = useState(null);
  const [intensityData, setIntensityData] = useState(null);
  const [packageData, setPackageData] = useState(null);
  const [apiSurfaceData, setApiSurfaceData] = useState(null);
  const [needsExtraction, setNeedsExtraction] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");


  const [testCoverageData, setTestCoverageData] = useState(null);
  const [testCoverageError, setTestCoverageError] = useState(null);


  const [communityTestCoverageData, setCommunityTestCoverageData] = useState(null);
  const [communityTestCoverageError, setCommunityTestCoverageError] = useState(null);

  useEffect(() => {
    if (!library || !version) return;

    const fetchAllData = async () => {
      setLoading(true);
      setError("");
      try {
        const cleanLibrary = library.includes(":")
          ? library.split(":").pop()
          : library;

        // Summary
        const summaryRes = await axios.get(
          `${API_BASE_URL}/api/analysisV2/maintainer-summary`,
          { params: { library: cleanLibrary, version } }
        );
        setData(summaryRes.data);

        // Intensity
        const intensityRes = await axios.get(
          `${API_BASE_URL}/api/analysisV2/usage-intensity`,
          { params: { library: cleanLibrary, version } }
        );
        setIntensityData(intensityRes.data);

        // Package
        const packageRes = await axios.get(
          `${API_BASE_URL}/api/analysisV2/package-heatmap`,
          { params: { library: cleanLibrary, version } }
        );
        setPackageData(packageRes.data);

        // API Surface
        try {
          const surfaceRes = await axios.get(
            `${API_BASE_URL}/api/analysisV2/api-surface-usage`,
            { params: { library: cleanLibrary, version } }
          );
          setApiSurfaceData(surfaceRes.data);
          setNeedsExtraction(false);
        } catch (surfaceErr) {
          if (surfaceErr.response?.data?.needsExtraction) {
            setNeedsExtraction(true);
          }
          console.log("API surface data not available:", surfaceErr.response?.data?.error);
        }


        // Community Test Coverage
        try {
          const ctcRes = await axios.get(
            `${API_BASE_URL}/api/analysisV2/community-test-coverage`,
            { params: { library: cleanLibrary, version } }
          );
          setCommunityTestCoverageData(ctcRes.data);
          setCommunityTestCoverageError(null);
        } catch (ctcErr) {
          console.log("Community test coverage data not available:", ctcErr.response?.data?.error);
          setCommunityTestCoverageData(null);
          setCommunityTestCoverageError(ctcErr.response?.data?.error || "Failed to fetch community test coverage");
        }

        // Test Coverage
        try {
          const coverageRes = await axios.get(
            `${API_BASE_URL}/api/analysisV2/used-api-test-coverage`,
            { params: { library: cleanLibrary, version } }
          );
          setTestCoverageData(coverageRes.data);
          setTestCoverageError(null);
        } catch (coverageErr) {
          console.log("Test coverage data not available:", coverageErr.response?.data?.error);
          setTestCoverageData(null);
          setTestCoverageError(coverageErr.response?.data?.error || "Failed to fetch test coverage");
        }

      } catch (err) {
        console.error("Error fetching data:", err);
        setError(err.response?.status === 404
          ? `${library} ${version} has not been analyzed yet. Go back to the version list to see the analyzed versions.`
          : "Failed to fetch summary data.");
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, [library, version]);

  if (!library || !version) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header currentPage="maintainer" />
        <div className="max-w-7xl mx-auto px-4 py-12 text-center">
          <p className="text-red-600 text-lg mb-4">Missing library or version.</p>
          <p className="text-gray-600 mb-6">Please select a library and version from the home page.</p>
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentPage="maintainer" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigate(pageUrl("/analysisV2", { library, version }), { state: { library, version } })}
            className="mb-4 text-gray-600 hover:text-gray-800 flex items-center"
          >
            Back to Analysis
          </button>

          <h1 className="text-xl font-bold text-gray-800">
            Maintainer Summary
          </h1>

          <h1 className="text-xl font-bold text-gray-800">
            {library} <span className="text-blue-600">{version}</span>
          </h1>
          <MethodSearchButton library={library} version={version} />
        </div>

        {/* {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
            <p className="text-gray-600 mt-4">Loading data...</p>
          </div>
        )} */}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {data && (
          <div className="mb-6">
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8">
                <button
                  onClick={() => setActiveTab("overview")}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === "overview"
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Overview
                </button>

                <button
                  onClick={() => setActiveTab("api-surface")}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === "api-surface"
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  API Surface Usage
                </button>

                <button
                  onClick={() => setActiveTab("community-test-coverage")}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === "community-test-coverage"
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Community Test Coverage
                </button>


                <button
                  onClick={() => setActiveTab("intensity")}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === "intensity"
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Usage Intensity
                </button>
                <button
                  onClick={() => setActiveTab("packages")}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === "packages"
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                    }`}
                >
                  Packages & Classes
                </button>

              </nav>
            </div>
          </div>
        )}

        {/* Overview Tab */}
        {data && activeTab === "overview" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Total Dependents</h2>
                <p className="text-3xl font-bold text-blue-600">{data.totalDependents}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Unique Packages</h2>
                <p className="text-3xl font-bold text-green-600">{data.uniquePackages}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-orange-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Unique Classes</h2>
                <p className="text-3xl font-bold text-orange-600">{data.uniqueClasses}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-purple-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Unique Method Calls</h2>
                <p className="text-3xl font-bold text-purple-600">{data.uniqueMethods}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Usage by Category</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieSlices(Object.entries(data.categoryDistribution).map(([name, value], i) => (
                        { name, value, color: COLORS[i % COLORS.length] })))}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={100}
                      label
                    >
                      {pieSlices(Object.entries(data.categoryDistribution).map(([name, value], i) => (
                        { name, value, color: COLORS[i % COLORS.length] }))).map((slice) => (
                        <Cell key={slice.name} fill={slice.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Top Methods by Dependent Count</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={data.topMethods}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="methodFull" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="dependentCount" fill="#10B981" name="Dependents" />
                    <Bar dataKey="totalUsageCount" fill="#3B82F6" name="Total Usage" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Top 15 Most Used Methods</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">#</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Method</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Dependents</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Total Usage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {data.topMethods.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600">{idx + 1}</td>
                          <td className="px-4 py-3 font-mono text-xs text-blue-600">{item.methodFull}</td>
                          <td className="px-4 py-3 text-right font-semibold text-green-600">{item.dependentCount}</td>
                          <td className="px-4 py-3 text-right font-semibold text-blue-600">{item.totalUsageCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}


        {/* API Surface Usage Tab */}
        {activeTab === "api-surface" && (
          <div className="space-y-8">
            {/* Explanation Banner */}
            <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">
                What is API Surface Usage?
              </h3>
              <p className="text-blue-800">
                This shows <strong>what percentage of your library's available public API methods are actually being used by your dependents</strong>.
                It helps you understand which public methods are popular and which ones might be candidates for deprecation or removal.
              </p>
            </div>

            {/* If needs extraction */}
            {needsExtraction && (
              <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-lg">
                <h3 className="text-lg font-semibold text-yellow-900 mb-4">
                  Available public API methods Not Yet Extracted
                </h3>
                <p className="text-yellow-800 mb-4">
                  The available public API methods for this library version have not been extracted yet.
                </p>
                <div className="bg-yellow-100 p-4 rounded font-mono text-sm text-yellow-900">
                  <p className="font-semibold mb-2">If you want this analytics</p>
                  <code className="block">Please reach out to us through our contact page</code>
                </div>
                <p className="text-yellow-700 mt-4 text-sm">
                  Note: Extraction can take several minutes for large libraries. Once complete, we will notify you.
                </p>
              </div>
            )}

            {/* API Surface Data */}
            {apiSurfaceData && !needsExtraction && (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                    <h2 className="text-sm font-semibold text-gray-600 mb-2">Available in Library</h2>
                    <p className="text-3xl font-bold text-blue-600">{apiSurfaceData.totalAvailableApis}</p>
                    <p className="text-xs text-gray-500 mt-1">Total public API methods you provide</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                    <h2 className="text-sm font-semibold text-gray-600 mb-2">Used by Dependents</h2>
                    <p className="text-3xl font-bold text-green-600">{apiSurfaceData.totalUsedApis}</p>
                    <p className="text-xs text-gray-500 mt-1">public methods actually used</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
                    <h2 className="text-sm font-semibold text-gray-600 mb-2">Never Used</h2>
                    <p className="text-3xl font-bold text-red-600">{apiSurfaceData.totalUnusedApis}</p>
                    <p className="text-xs text-gray-500 mt-1">Unused public methods</p>
                  </div>
                  <div className="bg-white p-6 rounded-lg shadow border-l-4 border-purple-500">
                    <h2 className="text-sm font-semibold text-gray-600 mb-2">Usage Rate</h2>
                    <p className="text-3xl font-bold text-purple-600">{apiSurfaceData.usagePercentage}%</p>
                    <p className="text-xs text-gray-500 mt-1">Of your public API methods are used</p>
                  </div>
                </div>

                {/* Visual Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-gray-700">API Surface Breakdown</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={pieSlices([
                            { name: "Used by Dependents", value: apiSurfaceData.totalUsedApis, color: "#10B981" },
                            { name: "Never Used", value: apiSurfaceData.totalUnusedApis, color: "#EF4444" }
                          ])}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={100}
                          label={({ percent }) => `${(percent * 100).toFixed(1)}%`}
                        >
                          {pieSlices([
                            { name: "Used by Dependents", value: apiSurfaceData.totalUsedApis, color: "#10B981" },
                            { name: "Never Used", value: apiSurfaceData.totalUnusedApis, color: "#EF4444" }
                          ]).map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-4 text-gray-700">Key Insights</h3>
                    <div className="space-y-4">
                      <div className="flex items-start">
                        <div className="w-2 h-2 bg-green-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-gray-700">{apiSurfaceData.totalUsedApis} APIs are actively used</p>
                          <p className="text-sm text-gray-600">These are the core public API methods your dependents rely on</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-gray-700">{apiSurfaceData.totalUnusedApis} methods are never used</p>
                          <p className="text-sm text-gray-600">Consider these for better documentation or design decisions</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="w-2 h-2 bg-purple-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                        <div>
                          <p className="font-semibold text-gray-700">{apiSurfaceData.usagePercentage}% usage rate</p>
                          <p className="text-sm text-gray-600">
                            {apiSurfaceData.usagePercentage > 50
                              ? "High usage indicates a well-utilized API surface"
                              : "Low usage suggests opportunity to simplify your API"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                  <p className="text-green-800 text-center font-semibold"> {apiSurfaceData.message}</p>
                </div>

                {apiSurfaceData.unusedApis && apiSurfaceData.unusedApis.length > 0 && (
                  <div className="bg-white rounded-lg shadow">
                    <div className="p-6">
                      <h3 className="text-lg font-semibold mb-4 text-gray-700">Sample Unused public API methods (First 50)</h3>
                      <p className="text-sm text-gray-600 mb-4">These public API methods are available in your library but never used by any dependent yet</p>
                      <div className="bg-gray-50 p-4 rounded max-h-96 overflow-y-auto">
                        <ul className="space-y-1 font-mono text-xs text-gray-700">
                          {apiSurfaceData.unusedApis.map((api, idx) => (
                            <li key={idx} className="py-1 border-b border-gray-200 last:border-0">{api}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Test Coverage Card */}
            {loading ? (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Usage-Based API Test Coverage</h2>
                {/* Explanation */}
                <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg mb-6">
                  <p className="text-sm text-purple-800">
                    <strong>What is Usage-Based API Test Coverage?</strong> Measures how well the API methods used by dependents are tested by Library's test suite.
                  </p>
                </div>
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  <span className="ml-3 text-gray-600">Loading...</span>
                </div>
              </div>
            ) : testCoverageError ? (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Usage-Based API Test Coverage</h2>
                {/* Explanation */}
                <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg mb-6">
                  <p className="text-sm text-purple-800">
                    <strong>What is Usage-Based API Test Coverage?</strong> Measures how well the API methods used by dependents are tested by Library's test suite.
                  </p>
                </div>

                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                  <p className="text-sm text-yellow-700">{testCoverageError}</p>
                  <p className="mt-2 text-xs text-yellow-600">
                    Run: <code className="bg-yellow-100 px-1 rounded">cd AutomatedJarDownload && python scripts/run_pipeline.py</code>
                  </p>
                </div>
              </div>
            ) : testCoverageData && (
              <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Usage-Based API Test Coverage</h2>
                {/* Explanation */}
                <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg mb-6">
                  <p className="text-sm text-purple-800">
                    <strong>What is Usage-Based API Test Coverage?</strong> Measures how well the API methods used by dependents are tested by Library's test suite.
                  </p>
                </div>

                {/* Main Coverage Comparison */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  {/* Usage-Based Coverage - Primary Focus */}
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg border-2 border-blue-300 relative">
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-200 text-blue-800">
                        What's used and tested
                      </span>
                    </div>
                    <div className="text-sm text-blue-600 font-semibold mb-2">Usage-Based Coverage</div>
                    <div className="text-5xl font-bold text-blue-700 mb-3">
                      {testCoverageData.usageBasedCoverage}%
                    </div>
                    <div className="text-sm text-blue-600 mb-3">
                      {testCoverageData.coveredByTests.toLocaleString()} / {testCoverageData.totalUsedApis.toLocaleString()} used methods have tests
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-3">
                      <div
                        className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${testCoverageData.usageBasedCoverage}%` }}
                      />
                    </div>
                    <div className="mt-3 text-xs text-blue-700">
                      <strong>Focus:</strong> Public API methods used by {testCoverageData.summary.totalDependents.toLocaleString()} dependents
                    </div>
                  </div>

                  {/* Overall Project Coverage - Reference */}
                  <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-lg border border-gray-300 relative">
                    <div className="absolute top-3 right-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                        Reference
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 font-semibold mb-2">Overall Project Coverage</div>
                    {/* null when the version's results have no project totals */}
                    <div className="text-5xl font-bold text-gray-700 mb-3">
                      {testCoverageData.overallProjectCoverage == null
                        ? <span className="text-2xl">Not recorded</span>
                        : `${testCoverageData.overallProjectCoverage}%`}
                    </div>
                    <div className="text-sm text-gray-600 mb-3">
                      All methods (including internal)
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className="bg-gray-600 h-3 rounded-full transition-all duration-500"
                        style={{ width: `${testCoverageData.overallProjectCoverage}%` }}
                      />
                    </div>
                    <div className="mt-3 text-xs text-gray-600">
                      <strong>Scope:</strong> Entire codebase
                    </div>
                  </div>
                </div>

                {/* Interpretation Alert */}
                {testCoverageData.summary && (
                  <div className={`border-l-4 p-4 mb-6 ${testCoverageData.usageBasedCoverage < testCoverageData.overallProjectCoverage
                    ? 'bg-yellow-50 border-yellow-400'
                    : 'bg-green-50 border-green-400'
                    }`}>
                    <div>
                      <div>
                        <h3 className={`text-sm font-medium ${testCoverageData.usageBasedCoverage < testCoverageData.overallProjectCoverage
                          ? 'text-yellow-800'
                          : 'text-green-800'
                          }`}>
                          {testCoverageData.summary.interpretation}
                        </h3>
                        <div className={`mt-2 text-sm ${testCoverageData.usageBasedCoverage < testCoverageData.overallProjectCoverage
                          ? 'text-yellow-700'
                          : 'text-green-700'
                          }`}>
                          <p>{testCoverageData.summary.mainMessage}</p>
                          <p className="mt-1">{testCoverageData.summary.comparisonMessage}</p>
                        </div>
                        {testCoverageData.summary.note && (
                          <p className="mt-2 text-xs text-gray-600 italic">{testCoverageData.summary.note}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                    <div className="text-sm text-green-600 font-semibold mb-2">Have Tests</div>
                    <div className="text-3xl font-bold text-green-600">
                      {testCoverageData.coveredByTests.toLocaleString()}
                    </div>
                    <div className="text-xs text-green-600 mt-1">
                      {((testCoverageData.coveredByTests / testCoverageData.totalUsedApis) * 100).toFixed(1)}% of used API methods
                    </div>
                  </div>

                  <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                    <div className="text-sm text-red-600 font-semibold mb-2">Need Tests</div>
                    <div className="text-3xl font-bold text-red-600">
                      {testCoverageData.notCoveredByTests.toLocaleString()}
                    </div>
                    <div className="text-xs text-red-600 mt-1">
                      {((testCoverageData.notCoveredByTests / testCoverageData.totalUsedApis) * 100).toFixed(1)}% uncovered
                    </div>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                    <div className="text-sm text-blue-600 font-semibold mb-2">Total Used</div>
                    <div className="text-3xl font-bold text-blue-600">
                      {testCoverageData.totalUsedApis.toLocaleString()}
                    </div>
                    <div className="text-xs text-blue-600 mt-1">
                      API methods used by dependents
                    </div>
                  </div>
                </div>

                {/* Action Items - APIs that NEED tests */}
                {testCoverageData.topUncoveredAPIs && testCoverageData.topUncoveredAPIs.length > 0 && (
                  <div className="bg-white rounded-lg border-2 border-red-300">
                    <div className="bg-red-50 px-6 py-4 border-b border-red-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold text-red-800">
                          Priority: Consider adding tests for these {testCoverageData.notCoveredByTests.toLocaleString()} API methods
                        </h3>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-200 text-red-800">
                          Action Required
                        </span>
                      </div>
                      <p className="text-sm text-red-700 mt-2">
                        These API methods are actively used by {testCoverageData.summary.totalDependents.toLocaleString()} dependents but have <strong>zero test coverage</strong>.
                        Adding tests here will have the highest impact on dependent stability.
                      </p>
                    </div>

                    <div className="p-6">
                      <div className="bg-gray-50 rounded max-h-96 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-100 sticky top-0">
                            <tr>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                #
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Package
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Class
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Method
                              </th>
                              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                <span className="font-bold">Complexity</span> <span className="font-normal">(Missed ByteCode Instructions)</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {testCoverageData.topUncoveredAPIs.map((api, idx) => (
                              <tr key={idx} className="hover:bg-red-50 transition-colors">
                                <td className="px-4 py-3 text-sm text-gray-500">
                                  {idx + 1}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-gray-600">
                                  {api.package}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-gray-800 font-semibold">
                                  {api.class}
                                </td>
                                <td className="px-4 py-3 text-xs font-mono text-gray-800">
                                  {api.method}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                    {api.instructionsMissed} inst.
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {testCoverageData.notCoveredByTests > 20 && (
                        <div className="mt-4 text-center text-sm text-gray-600">
                          Showing top 20 of {testCoverageData.notCoveredByTests.toLocaleString()} uncovered API methods. 
                          Note: This list is sorted based on # missed bytecode instructions.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}




        {/* CTC should be here */}

        {/* Community Test Coverage Tab */}
        {communityTestCoverageData && activeTab === "community-test-coverage" && (
          <div className="space-y-8">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">Community Test Coverage (CTC)</h2>

              {/* Explanation */}
              <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg mb-6">
                <p className="text-sm text-purple-800">
                  <strong>What is CTC?</strong> Measures the percentage of dependent projects where <strong>ALL</strong> API methods they use from your library are fully covered by your library's tests.
                </p>
              </div>

              {/* Main CTC Metric */}
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-8 rounded-lg border-2 border-purple-300 mb-6">
                <div className="text-center">
                  <div className="text-sm text-purple-600 font-semibold mb-2">Community Test Coverage</div>
                  <div className="text-6xl font-bold text-purple-700 mb-4">
                    {communityTestCoverageData.communityTestCoverage}%
                  </div>
                  <div className="text-lg text-purple-600 mb-4">
                    {communityTestCoverageData.NPFullyCovered.toLocaleString()} of {communityTestCoverageData.NPtotal.toLocaleString()} dependents
                  </div>
                  <div className="w-full bg-purple-200 rounded-full h-4 mb-4">
                    <div
                      className="bg-purple-600 h-4 rounded-full transition-all duration-500"
                      style={{ width: `${communityTestCoverageData.communityTestCoverage}%` }}
                    />
                  </div>
                  <p className="text-sm text-purple-700 italic">
                    {communityTestCoverageData.summary.mainMessage}
                  </p>
                </div>
              </div>

              {/* Interpretation Alert */}
              <div className={`border-l-4 p-4 mb-6 ${communityTestCoverageData.communityTestCoverage >= 60
                ? 'bg-green-50 border-green-400'
                : communityTestCoverageData.communityTestCoverage >= 40
                  ? 'bg-yellow-50 border-yellow-400'
                  : 'bg-red-50 border-red-400'
                }`}>
                <div>
                  <div>
                    <h3 className={`text-sm font-medium ${communityTestCoverageData.communityTestCoverage >= 60
                      ? 'text-green-800'
                      : communityTestCoverageData.communityTestCoverage >= 40
                        ? 'text-yellow-800'
                        : 'text-red-800'
                      }`}>
                      {communityTestCoverageData.summary.interpretation}
                    </h3>
                  </div>
                </div>
              </div>

              {/* Breakdown Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-green-600 font-semibold">Fully Covered</div>
                  </div>
                  <div className="text-3xl font-bold text-green-600">
                    {communityTestCoverageData.summary.fullyCoveredCount.toLocaleString()}
                  </div>
                  <div className="text-xs text-green-600 mt-1">
                    Dependents use API methods that are fully covered and tested.
                  </div>
                </div>

                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-yellow-600 font-semibold">Partially Covered</div>
                  </div>
                  <div className="text-3xl font-bold text-yellow-600">
                    {communityTestCoverageData.summary.partiallyCoveredCount.toLocaleString()}
                  </div>
                  <div className="text-xs text-yellow-600 mt-1">
                    Dependents use some API methods that lack tests in your library's test suite.
                  </div>
                </div>

                <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-red-600 font-semibold">Not Covered</div>
                  </div>
                  <div className="text-3xl font-bold text-red-600">
                    {communityTestCoverageData.summary.notCoveredCount.toLocaleString()}
                  </div>
                  <div className="text-xs text-red-600 mt-1">
                    Dependents use API methods that have no test(s) in your library's test suite.
                  </div>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm text-blue-600 font-semibold">Average Coverage</div>
                  </div>
                  <div className="text-3xl font-bold text-blue-600">
                    {communityTestCoverageData.summary.averageProjectCoverage}%
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    Across all dependents
                  </div>
                </div>
              </div>

              {/* Visual Breakdown */}
              <div className="bg-white p-6 rounded-lg border border-gray-200">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Dependent Projects Breakdown</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={pieSlices([
                        {
                          name: "Fully Covered",
                          value: communityTestCoverageData.summary.fullyCoveredCount,
                          color: "#10B981"
                        },
                        {
                          name: "Partially Covered",
                          value: communityTestCoverageData.summary.partiallyCoveredCount,
                          color: "#F59E0B"
                        },
                        {
                          name: "Not Covered",
                          value: communityTestCoverageData.summary.notCoveredCount,
                          color: "#EF4444"
                        }
                      ])}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                    >
                      {pieSlices([
                        { name: "Fully Covered", value: communityTestCoverageData.summary.fullyCoveredCount, color: "#10B981" },
                        { name: "Partially Covered", value: communityTestCoverageData.summary.partiallyCoveredCount, color: "#F59E0B" },
                        { name: "Not Covered", value: communityTestCoverageData.summary.notCoveredCount, color: "#EF4444" },
                      ]).map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}


        {/* Usage Intensity Tab */}
        {intensityData && activeTab === "intensity" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Mean</h2>
                <p className="text-3xl font-bold text-blue-600">{intensityData.stats.mean}</p>
                <p className="text-xs text-gray-500 mt-1">Public API methods per dependent</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Median</h2>
                <p className="text-3xl font-bold text-green-600">{intensityData.stats.median}</p>
                <p className="text-xs text-gray-500 mt-1">Public API methods per dependent</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-orange-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Max</h2>
                <p className="text-3xl font-bold text-orange-600">{intensityData.stats.max}</p>
                <p className="text-xs text-gray-500 mt-1">Most Public API methods used</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-purple-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Min</h2>
                <p className="text-3xl font-bold text-purple-600">{intensityData.stats.min}</p>
                <p className="text-xs text-gray-500 mt-1">Least Public API methods used</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">Usage Intensity Distribution</h3>
              <p className="text-sm text-gray-600 mb-4">How many Public API methods do dependents typically use?</p>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={Object.entries(intensityData.distribution).map(([name, value]) => ({ name, value }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-15} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8B5CF6" name="Dependents" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Top 20 Heavy Users</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">#</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Dependent</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">API Methods Used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {intensityData.topHeavyUsers.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600">{idx + 1}</td>
                          <td className="px-4 py-3 text-blue-600 font-mono text-xs">{item.jarFile}</td>
                          <td className="px-4 py-3 text-right font-semibold text-purple-600">{item.usageCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Packages & Classes Tab */}
        {packageData && activeTab === "packages" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Total Packages Used</h2>
                <p className="text-3xl font-bold text-green-600">{packageData.totalPackages}</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow border-l-4 border-orange-500">
                <h2 className="text-sm font-semibold text-gray-600 mb-2">Total Classes Used</h2>
                <p className="text-3xl font-bold text-orange-600">{packageData.totalClasses}</p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">Top 10 Most Used Packages</h3>
              <ResponsiveContainer width="100%" height={500}>
                <BarChart data={packageData.topPackages} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={300} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="dependentCount" fill="#10B981" name="Dependents" />
                  <Bar dataKey="totalUsage" fill="#3B82F6" name="Total Usage" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Top 15 Most Used Classes</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">#</th>
                        <th className="px-4 py-3 text-left font-semibold text-gray-600">Class</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Dependents</th>
                        <th className="px-4 py-3 text-right font-semibold text-gray-600">Total Usage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {packageData.topClasses.map((item, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600">{idx + 1}</td>
                          <td className="px-4 py-3 font-mono text-xs text-blue-600">{item.name}</td>
                          <td className="px-4 py-3 text-right font-semibold text-green-600">{item.dependentCount}</td>
                          <td className="px-4 py-3 text-right font-semibold text-blue-600">{item.totalUsage}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}



        {/* All card ends before below if the global div*/}

      </div>
    </div>
  );
};

export default MaintainerSummaryPage;