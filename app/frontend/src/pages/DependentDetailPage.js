import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getVersions } from "../services/api";
import axios from "axios";
import MethodSearchButton from "../components/MethodSearchButton";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import API_BASE_URL from '../services/api';
import { pageParam, pageUrl } from "../utils/pageUrl";

const COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#22C55E", "#6366F1"
];

const DependentDetailPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const library = pageParam(location, "library");
  const dependent = pageParam(location, "dependent");
  const stateVersion = pageParam(location, "version");
  
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(stateVersion || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [error, setError] = useState("");

  console.log(" DependentDetailPage - Received version:", stateVersion);

  // Fetch versions on mount
  useEffect(() => {
    if (!library) return;

    const fetchVersions = async () => {
      setLoadingVersions(true);
      try {
        const cleanLibrary = library.includes(":")
          ? library.split(":").pop()
          : library;

        const res = await getVersions(cleanLibrary);
        console.log(" Versions:", res.data);
        setVersions(res.data);
      } catch (err) {
        console.error(" Error fetching versions:", err);
        setError("Failed to fetch versions.");
      } finally {
        setLoadingVersions(false);
      }
    };

    fetchVersions();
  }, [library]);

  // Fetch dependent details when version changes
  useEffect(() => {
    if (!library || !selectedVersion || !dependent) return;

    const fetchDetails = async () => {
      setLoading(true);
      setError("");
      try {
        const cleanLibrary = library.includes(":")
          ? library.split(":").pop()
          : library;

        const res = await axios.get(`${API_BASE_URL}/api/analysisV2/dependent-details`, {
          params: { library: cleanLibrary, version: selectedVersion, dependent },
        });

        console.log(" Dependent details:", res.data);
        setData(res.data);
      } catch (err) {
        console.error(" Error fetching dependent details:", err);
        setError("Failed to fetch dependent details.");
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [library, selectedVersion, dependent]);

  if (!library || !dependent) {
    return (
      <p className="p-6 text-red-600 text-center">
        Missing library or dependent info.
      </p>
    );
  }

  // Show version selection if no version selected
  if (!selectedVersion) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="mb-4 text-gray-600 hover:text-gray-800 flex items-center"
          >
            Back
          </button>
          
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-blue-800 mb-2">
              Select a Version
            </h1>
            <p className="text-gray-600">
              Dependent: <span className="font-semibold">{dependent}</span>
            </p>
            <p className="text-gray-600">
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

            {!loadingVersions && versions.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-gray-700 mb-6">
                  Available Versions ({versions.length})
                </h2>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[500px] overflow-y-auto p-2">
                  {versions.map((version, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedVersion(version)}
                      className="bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-600 hover:to-blue-700 text-gray-800 hover:text-white font-semibold py-4 px-4 rounded-xl border-2 border-blue-200 hover:border-blue-600 transition-all hover:scale-105 shadow-md"
                    >
                      v{version}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pie chart slices with a value: a zero slice has no area but would still get a label
  const categorySlices = data?.categoryDistribution
    ? Object.entries(data.categoryDistribution)
        .map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }))
        .filter((slice) => slice.value > 0)
    : [];

  // Show details after version is selected
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Version Selector Navbar */}
      <div className="bg-white shadow-md border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => navigate(pageUrl("/analysisV2", { library, version: selectedVersion }), { state: { library, version: selectedVersion } })}
              className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition"
            >
              Back to Analysis
            </button>
            
            <h1 className="text-xl font-bold text-blue-700">
              Dependent: {dependent}
            </h1>
            <MethodSearchButton library={library} version={selectedVersion} />
            <div className="w-20"></div>
          </div>

         
        </div>
      </div>

      {/* Main Content */}
      <div className="p-8 flex flex-col items-center font-sans">
        {loading && <p className="text-gray-600">Loading dependent details...</p>}
        {error && <p className="text-red-500">{error}</p>}

        {data && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4 mb-10 w-full max-w-6xl">
              <div className="p-4 border rounded shadow bg-blue-50 text-center">
                <h2 className="text-sm font-semibold text-gray-700">Total Calls</h2>
                <p className="text-2xl font-bold text-blue-600">
                  {data.totalCalls}
                </p>
              </div>
              <div className="p-4 border rounded shadow bg-green-50 text-center">
                <h2 className="text-sm font-semibold text-gray-700">Packages</h2>
                <p className="text-2xl font-bold text-green-600">
                  {data.uniquePackages}
                </p>
              </div>
              <div className="p-4 border rounded shadow bg-orange-50 text-center">
                <h2 className="text-sm font-semibold text-gray-700">Classes</h2>
                <p className="text-2xl font-bold text-orange-600">
                  {data.uniqueClasses}
                </p>
              </div>
              <div className="p-4 border rounded shadow bg-purple-50 text-center">
                <h2 className="text-sm font-semibold text-gray-700">Methods</h2>
                <p className="text-2xl font-bold text-purple-600">
                  {data.uniqueMethods}
                </p>
              </div>
            </div>

            {/* Charts */}
            <div className="bg-white p-6 shadow rounded-xl border w-full max-w-3xl mb-10">
              <h3 className="text-lg font-semibold mb-4 text-gray-700 text-center">
                Category Distribution
              </h3>
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={categorySlices}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={120}
                    label
                  >
                    {categorySlices.map((slice) => (
                      <Cell key={slice.name} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Detailed Call Table */}
            <div className="bg-white shadow rounded-xl border p-6 w-full max-w-6xl">
              <h3 className="text-lg font-semibold mb-4 text-gray-700">
                API Usage Details
              </h3>
              <div className="overflow-y-auto max-h-[500px] border-t">
                <table className="w-full text-sm text-left text-gray-600">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="p-2">Caller</th>
                      <th className="p-2">Usage</th>
                      <th className="p-2">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.details.slice(0, 200).map((row, i) => (
                      <tr key={i} className="border-b hover:bg-blue-50">
                        <td className="p-2">{row.caller}</td>
                        <td className="p-2 font-mono text-xs text-gray-700">
                          {row.usage}
                        </td>
                        <td className="p-2">{row.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DependentDetailPage;