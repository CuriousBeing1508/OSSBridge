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
import InfoIcon, { DEPENDENTS_INFO } from "../components/InfoIcon";
import API_BASE_URL from '../services/api';
import { pageParam, pageUrl } from "../utils/pageUrl";

// Pie chart slices with a value. A zero slice has no area but would still get a label.
const pieSlices = (slices) => slices.filter((slice) => slice.value > 0);

// Shows why a version has no test coverage, with the raw error behind a toggle.
const CoverageUnavailable = ({ coverage }) => (
  <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
    <p className="text-sm font-semibold text-yellow-800">Test coverage is not available for this version.</p>
    {coverage.reason && <p className="text-sm text-yellow-800 mt-1">{coverage.reason}</p>}
    <p className="text-sm text-yellow-800 mt-1">
      The usage results do not depend on test coverage, so they are complete.
    </p>
    {coverage.error && (
      <details className="mt-3">
        <summary className="text-xs text-yellow-700 cursor-pointer">Details</summary>
        <pre className="mt-2 text-xs bg-yellow-100 text-yellow-900 p-3 rounded overflow-x-auto whitespace-pre-wrap break-words">
          {coverage.error}
        </pre>
      </details>
    )}
  </div>
);

// Every tab starts with its title, its definition and the projects it is based on.
const MetricTab = ({ title, question, definition, basis, headline, children }) => (
  <div className="space-y-8">
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-800">{title}</h2>
      <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
        <p className="text-sm text-purple-800">
          <strong>{question}</strong> {definition}
        </p>
      </div>
      {basis && <p className="text-base text-gray-700">{basis}</p>}
    </div>
    {headline}
    {children}
  </div>
);

// The main number of a tab with one sentence below it.
const Headline = ({ value, sentence, children }) => (
  <div className="bg-white rounded-lg shadow p-6">
    <div className="text-5xl font-bold text-purple-700">{value}</div>
    <div className="text-base text-gray-800 mt-3">{sentence}</div>
    {children && <div className="mt-5 max-w-2xl">{children}</div>}
  </div>
);

// A short bar that splits a total into groups, with a legend.
const Breakdown = ({ title, groups }) => {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  if (total === 0) return null;
  return (
    <div>
      {title && <p className="text-sm font-semibold text-gray-700 mb-2">{title}</p>}
      <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-200">
        {groups.filter((g) => g.count > 0).map((g) => (
          <div key={g.label} className={g.bar} style={{ width: `${(g.count / total) * 100}%` }}
               title={`${g.count.toLocaleString()} ${g.label}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm">
        {groups.map((g) => (
          <span key={g.label} className={g.text}>
            <span className={`inline-block w-3 h-3 rounded-sm mr-1 align-middle ${g.bar}`} />
            <strong>{g.count.toLocaleString()}</strong> {g.label}
            {g.info && <> <InfoIcon text={g.info} /></>}
          </span>
        ))}
      </div>
    </div>
  );
};

const COVERED_INFO = "A method also counts as covered when the tests run a method of the library that overrides "
  + "or implements it. For example, an interface method is covered when the tests run one of its implementations.";
const NOT_MEASURABLE_INFO = "Some APIs have no code that a test could run. These are annotation members, enum "
  + "methods that the compiler generates, and interface methods with no implementation in the library. Other APIs "
  + "are in bundled third-party classes that the coverage report leaves out. These APIs are counted on their own "
  + "and left out of the percentage.";
const FULLY_COVERED_INFO = "Fully covered means the tests run every line of the method.";
const API_INFO = "APIs are the public and protected methods and constructors that a dependent can use. Protected "
  + "ones count only in classes that are not final. Overloaded methods with the same name count as one API.";
const PRIORITY_INFO = "Each row is a method name, so overloads with the same name are counted together. The tests "
  + "run none of the overloads that dependents use. Overloads that no dependent uses may still be covered.";
const INTENSITY_API_INFO = "Here an API is any class, method or field of the library that the project uses.";

const COVERAGE_LABELS = {
  fully_covered: { text: "Fully covered", className: "text-green-700" },
  partly_covered: { text: "Partly covered", className: "text-yellow-700" },
  not_covered: { text: "Not covered", className: "text-red-700" },
  no_code: { text: "No code to test", className: "text-gray-500" },
};

// A top 10 table with fully qualified names and a count for each row.
const TopTable = ({ title, note, column, countColumn = "Projects using it", rows, extra }) => {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-1 text-gray-700">{title}</h3>
      {note && <p className="text-sm text-gray-600 mb-3">{note}</p>}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-semibold text-gray-600">{column}</th>
              <th className="px-4 py-2 text-right font-semibold text-gray-600">{countColumn}</th>
              {extra && <th className="px-4 py-2 text-left font-semibold text-gray-600">{extra.column}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.slice(0, 10).map((r) => (
              <tr key={r.name}>
                <td className="px-4 py-2 font-mono text-xs text-gray-800 break-all">{r.name}</td>
                <td className="px-4 py-2 text-right font-semibold text-gray-800">{r.count.toLocaleString()}</td>
                {extra && <td className="px-4 py-2">{extra.cell(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// The coverage reason from a failed coverage request.
const coverageFromError = (err, fallback) =>
  err.response?.data?.coverage || { reason: fallback, error: null };

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
  const [allDependents, setAllDependents] = useState([]);
  const [apiSurfaceData, setApiSurfaceData] = useState(null);
  const [needsExtraction, setNeedsExtraction] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("api-surface");


  const [testCoverageData, setTestCoverageData] = useState(null);
  const [testCoverageError, setTestCoverageError] = useState(null);


  const [communityTestCoverageData, setCommunityTestCoverageData] = useState(null);
  const [communityTestCoverageError, setCommunityTestCoverageError] = useState(null);

  useEffect(() => {
    if (!library || !version) return;

    const fetchAllData = async () => {
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

        // Every analyzed dependent with the number of APIs it uses
        const usageRes = await axios.get(
          `${API_BASE_URL}/api/analysisV2/usage`,
          { params: { library: cleanLibrary, version, top: 100000 } }
        );
        setAllDependents(usageRes.data.topDependents);

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
          setCommunityTestCoverageError(coverageFromError(ctcErr, "Failed to fetch community test coverage."));
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
          setTestCoverageError(coverageFromError(coverageErr, "Failed to fetch test coverage."));
        }

      } catch (err) {
        console.error("Error fetching data:", err);
        setError(err.response?.status === 404
          ? `${library} ${version} has not been analyzed yet. Go back to the version list to see the analyzed versions.`
          : "Failed to fetch summary data.");
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


        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {data && (() => {
          const basis = (
            <>These results come from {data.totalDependents.toLocaleString()} dependent projects that
              call {library} {version}. <InfoIcon text={DEPENDENTS_INFO} /></>
          );
          const tabs = [
            ["api-surface", "API Surface Usage"],
            ["usage-based-coverage", "Usage-Based API Test Coverage"],
            ["community-test-coverage", "Community Test Coverage"],
            ["overview", "What dependents use"],
          ];
          const coverageUnavailable = data.testCoverage && !data.testCoverage.available;
          return (
          <>
          <div className="mb-6 border-b border-gray-200">
            <nav className="-mb-px flex flex-wrap gap-x-8">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${activeTab === id
                    ? "border-green-600 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {activeTab === "overview" && (
            <div className="space-y-6">
              {coverageUnavailable && <CoverageUnavailable coverage={data.testCoverage} />}
              <MetricTab
                title="What dependents use"
                question="What does this show?"
                definition="Shows which packages, classes and methods of the library dependent projects use, how many projects use each, and how much of the library each project uses."
                basis={basis}
                headline={(
                  <Headline
                    value={`${data.totalDependents.toLocaleString()} projects`}
                    sentence={<>{data.totalDependents.toLocaleString()} projects call {library} {version}. Together
                      they use {data.uniquePackages.toLocaleString()} packages, {data.uniqueClasses.toLocaleString()} classes
                      and {data.uniqueMethods.toLocaleString()} methods of the library.</>}
                  />
                )}
              >
                {[["Most used packages", "Package", data.topPackages], ["Most used classes", "Class", data.topClasses]]
                  .map(([title, column, rows]) => rows && rows.length > 0 && (
                    <TopTable
                      key={title}
                      title={title}
                      column={column}
                      note={<><span className="font-mono">{rows[0].name}</span> is used by {rows[0].projects.toLocaleString()} of {data.totalDependents.toLocaleString()} projects.</>}
                      rows={rows.map((r) => ({ name: r.name, count: r.projects }))}
                    />
                  ))}
                <TopTable
                  title="Most used methods"
                  column="Method"
                  rows={data.topMethods.map((r) => ({ name: r.name, count: r.projects, coverage: r.coverage }))}
                  extra={data.testCoverage?.available ? {
                    column: "Tests",
                    cell: (r) => (
                      <span className={COVERAGE_LABELS[r.coverage]?.className || ""}>
                        {COVERAGE_LABELS[r.coverage]?.text || ""}
                      </span>
                    ),
                  } : null}
                />

                {intensityData && (() => {
                  const heavy = intensityData.distribution["Very Heavy (200+ APIs)"] || 0;
                  const leader = intensityData.topHeavyUsers[0];
                  const cards = [
                    { label: "Mean", value: intensityData.stats.mean, border: "border-blue-500", text: "text-blue-600", note: "APIs per dependent" },
                    { label: "Median", value: intensityData.stats.median, border: "border-green-500", text: "text-green-600", note: "APIs per dependent" },
                    { label: "Max", value: intensityData.stats.max, border: "border-orange-500", text: "text-orange-600", note: "Most APIs used" },
                    { label: "Min", value: intensityData.stats.min, border: "border-purple-500", text: "text-purple-600", note: "Least APIs used" },
                  ];
                  return (
                    <div className="bg-white rounded-lg shadow p-6 space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold mb-1 text-gray-700">Usage Intensity</h3>
                        <p className="text-sm text-gray-600">
                          Usage intensity is the number of different APIs of the library that a dependent project uses. A
                          project with a high usage intensity depends on more of the library, so changes to the API are
                          more likely to affect it.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        {cards.map((c) => (
                          <div key={c.label} className={`bg-white p-6 rounded-lg shadow border-l-4 ${c.border}`}>
                            <h4 className="text-sm font-semibold text-gray-600 mb-2">{c.label}</h4>
                            <p className={`text-3xl font-bold ${c.text}`}>{c.value}</p>
                            <p className="text-xs text-gray-500 mt-1">{c.note}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-base text-gray-800">
                        Half of the projects use {intensityData.stats.median.toLocaleString()} APIs or
                        fewer. <InfoIcon text={INTENSITY_API_INFO} />
                        {heavy > 0 && leader && (
                          <> {heavy.toLocaleString()} {heavy === 1 ? "project uses" : "projects use"} more than 200,
                            led by <span className="font-mono">{leader.jarFile}</span> ({leader.usageCount.toLocaleString()} APIs).</>
                        )}
                      </p>
                      <div>
                        <h4 className="text-base font-semibold mb-1 text-gray-700">Usage Intensity Distribution</h4>
                        <p className="text-sm text-gray-600 mb-4">How many APIs do dependents typically use?</p>
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
                    </div>
                  );
                })()}

                {allDependents.length > 0 && (
                  <div className="bg-white rounded-lg shadow p-6">
                    <h3 className="text-lg font-semibold mb-1 text-gray-700">All dependents</h3>
                    <p className="text-sm text-gray-600 mb-3">Click a project to see which parts of the library it uses.</p>
                    <div className="max-h-96 overflow-y-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-gray-600">Dependent</th>
                            <th className="px-4 py-2 text-right font-semibold text-gray-600">APIs used <InfoIcon text={INTENSITY_API_INFO} /></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {allDependents.map((d) => (
                            <tr
                              key={d.dependent}
                              onClick={() => navigate(pageUrl("/analysisV2/dependent", { library, version, dependent: d.dependent }), {
                                state: { library, version, dependent: d.dependent },
                              })}
                              className="cursor-pointer hover:bg-blue-50"
                            >
                              <td className="px-4 py-2 font-mono text-xs text-blue-700 break-all">{d.dependent}</td>
                              <td className="px-4 py-2 text-right font-semibold text-gray-800">{d.apisUsed.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </MetricTab>
            </div>
          )}

          {activeTab === "api-surface" && (
            <MetricTab
              title="API Surface Usage"
              question="What is API Surface Usage?"
              definition={<>This shows <strong>what percentage of your library's available public API methods are actually being used by your dependents</strong>. It helps you understand which public methods are popular and which ones the analyzed projects do not use.</>}
              basis={basis}
            >
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
                    Extraction can take several minutes for large libraries. Once complete, we will notify you.
                  </p>
                </div>
              )}

              {apiSurfaceData && !needsExtraction && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
                      <h2 className="text-sm font-semibold text-gray-600 mb-2">Available in Library <InfoIcon text={API_INFO} /></h2>
                      <p className="text-3xl font-bold text-blue-600">{apiSurfaceData.totalAvailableApis.toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Total public API methods you provide</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
                      <h2 className="text-sm font-semibold text-gray-600 mb-2">Used by Dependents</h2>
                      <p className="text-3xl font-bold text-green-600">{apiSurfaceData.totalUsedApis.toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">public methods actually used</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500">
                      <h2 className="text-sm font-semibold text-gray-600 mb-2">Not used by these projects</h2>
                      <p className="text-3xl font-bold text-red-600">{apiSurfaceData.totalUnusedApis.toLocaleString()}</p>
                      <p className="text-xs text-gray-500 mt-1">Public methods the analyzed projects do not call</p>
                    </div>
                    <div className="bg-white p-6 rounded-lg shadow border-l-4 border-purple-500">
                      <h2 className="text-sm font-semibold text-gray-600 mb-2">Usage Rate</h2>
                      <p className="text-3xl font-bold text-purple-600">{apiSurfaceData.usagePercentage}%</p>
                      <p className="text-xs text-gray-500 mt-1">Of your public API methods are used</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-white p-6 rounded-lg shadow">
                      <h3 className="text-lg font-semibold mb-4 text-gray-700">API Surface Breakdown</h3>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pieSlices([
                              { name: "Used by Dependents", value: apiSurfaceData.totalUsedApis, color: "#10B981" },
                              { name: "Not used by these projects", value: apiSurfaceData.totalUnusedApis, color: "#EF4444" },
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
                              { name: "Not used by these projects", value: apiSurfaceData.totalUnusedApis, color: "#EF4444" },
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
                            <p className="font-semibold text-gray-700">{apiSurfaceData.totalUsedApis.toLocaleString()} APIs are actively used</p>
                            <p className="text-sm text-gray-600">These are the core public API methods your dependents rely on</p>
                          </div>
                        </div>
                        <div className="flex items-start">
                          <div className="w-2 h-2 bg-red-500 rounded-full mt-2 mr-3 flex-shrink-0"></div>
                          <div>
                            <p className="font-semibold text-gray-700">{apiSurfaceData.totalUnusedApis.toLocaleString()} methods are not used by these projects</p>
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
                    <p className="text-green-800 text-center font-semibold">{apiSurfaceData.message}</p>
                  </div>

                </>
              )}

            </MetricTab>
          )}

          {activeTab === "usage-based-coverage" && (
            <MetricTab
              title="Usage-Based API Test Coverage"
              question="What is Usage-Based API Test Coverage?"
              definition={<>Measures how well the API methods used by dependents are tested by Library's test suite.</>}
              basis={basis}
            >
              <div className="bg-white rounded-lg shadow-md p-6">
                {testCoverageError && <CoverageUnavailable coverage={testCoverageError} />}

                {testCoverageData && (() => {
                  const t = testCoverageData;
                  const share = (n) => (t.usedApisWithCode > 0 ? ((n / t.usedApisWithCode) * 100).toFixed(1) : "0");
                  const lower = t.overallProjectCoverage != null && t.usageBasedCoverage < t.overallProjectCoverage;
                  return (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg border-2 border-blue-300 relative">
                          <div className="absolute top-3 right-3">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-200 text-blue-800">
                              What's used and covered by test
                            </span>
                          </div>
                          <div className="text-sm text-blue-600 font-semibold mb-2">Usage-Based Coverage</div>
                          <div className="text-5xl font-bold text-blue-700 mb-3">{t.usageBasedCoverage}%</div>
                          <div className="text-sm text-blue-600 mb-3">
                            {t.coveredByTests.toLocaleString()} of {t.usedApisWithCode.toLocaleString()} used APIs with code are covered by tests
                          </div>
                          <div className="w-full bg-blue-200 rounded-full h-3">
                            <div className="bg-blue-600 h-3 rounded-full" style={{ width: `${t.usageBasedCoverage}%` }} />
                          </div>
                          <div className="mt-3 text-xs text-blue-700">
                            Covers the public API methods used by {t.summary.totalDependents.toLocaleString()} dependents.
                          </div>
                        </div>

                        <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-6 rounded-lg border border-gray-300 relative">
                          <div className="absolute top-3 right-3">
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                              Reference
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 font-semibold mb-2">Overall Project Coverage</div>
                          <div className="text-5xl font-bold text-gray-700 mb-3">
                            {t.overallProjectCoverage == null
                              ? <span className="text-2xl">Not recorded</span>
                              : `${t.overallProjectCoverage}%`}
                          </div>
                          <div className="text-sm text-gray-600 mb-3">All methods (including internal)</div>
                          <div className="w-full bg-gray-200 rounded-full h-3">
                            <div className="bg-gray-600 h-3 rounded-full" style={{ width: `${t.overallProjectCoverage || 0}%` }} />
                          </div>
                          <div className="mt-3 text-xs text-gray-600">Covers the entire codebase.</div>
                        </div>
                      </div>

                      <div className={`border-l-4 p-4 mb-6 ${lower ? "bg-yellow-50 border-yellow-400" : "bg-green-50 border-green-400"}`}>
                        <h3 className={`text-sm font-medium ${lower ? "text-yellow-800" : "text-green-800"}`}>
                          {t.summary.interpretation}
                        </h3>
                        <div className={`mt-2 text-sm ${lower ? "text-yellow-700" : "text-green-700"}`}>
                          <p>{t.summary.mainMessage}</p>
                          <p className="mt-1">{t.summary.comparisonMessage}</p>
                        </div>
                        {t.summary.note && <p className="mt-2 text-xs text-gray-600 italic">{t.summary.note}</p>}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                          <div className="text-sm text-green-600 font-semibold mb-2">Covered by tests <InfoIcon text={COVERED_INFO} /></div>
                          <div className="text-3xl font-bold text-green-600">{t.coveredByTests.toLocaleString()}</div>
                          <div className="text-xs text-green-600 mt-1">{share(t.coveredByTests)}% of used APIs with code</div>
                        </div>
                        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                          <div className="text-sm text-red-600 font-semibold mb-2">Not covered by tests</div>
                          <div className="text-3xl font-bold text-red-600">{t.notCoveredByTests.toLocaleString()}</div>
                          <div className="text-xs text-red-600 mt-1">{share(t.notCoveredByTests)}% of used APIs with code</div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                          <div className="text-sm text-gray-600 font-semibold mb-2">Not measurable <InfoIcon text={NOT_MEASURABLE_INFO} /></div>
                          <div className="text-3xl font-bold text-gray-600">{t.notFoundInCoverage.toLocaleString()}</div>
                          <div className="text-xs text-gray-600 mt-1">Left out of the percentage</div>
                        </div>
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                          <div className="text-sm text-blue-600 font-semibold mb-2">Total Used</div>
                          <div className="text-3xl font-bold text-blue-600">{t.totalUsedApis.toLocaleString()}</div>
                          <div className="text-xs text-blue-600 mt-1">API methods used by dependents</div>
                        </div>
                      </div>

                      {t.topUncoveredAPIs && t.topUncoveredAPIs.length > 0 && (
                        <div className="bg-white rounded-lg border-2 border-red-300">
                          <div className="bg-red-50 px-6 py-4 border-b border-red-200">
                            <div className="flex items-center justify-between">
                              <h3 className="text-lg font-semibold text-red-800">
                                Priority. Consider adding tests for these API methods <InfoIcon text={PRIORITY_INFO} />
                              </h3>
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-200 text-red-800">
                                Action Required
                              </span>
                            </div>
                            <p className="text-sm text-red-700 mt-2">
                              {t.notCoveredByTests > t.topUncoveredAPIs.length
                                ? `Top ${t.topUncoveredAPIs.length} of ${t.notCoveredByTests.toLocaleString()} methods, sorted by number of dependent projects.`
                                : "Sorted by number of dependent projects."}{" "}
                              Dependents use these methods, but no test runs them.
                            </p>
                          </div>
                          <div className="p-6">
                            <div className="bg-gray-50 rounded max-h-96 overflow-y-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-100 sticky top-0">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Method</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Projects using it</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      <span className="font-bold">Complexity</span> <span className="font-normal">(Missed ByteCode Instructions)</span>
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {t.topUncoveredAPIs.map((api, idx) => (
                                    <tr key={api.signature} className="hover:bg-red-50 transition-colors">
                                      <td className="px-4 py-3 text-sm text-gray-500">{idx + 1}</td>
                                      <td className="px-4 py-3 text-xs font-mono text-gray-800 break-all">{api.signature}</td>
                                      <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800">{api.dependentCount.toLocaleString()}</td>
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
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </MetricTab>
          )}

          {activeTab === "community-test-coverage" && (() => {
            const ctc = communityTestCoverageData;
            const slices = ctc ? pieSlices([
              { name: "Fully Covered", value: ctc.NPFullyCovered, color: "#10B981" },
              { name: "Partially Covered", value: ctc.partiallyCoveredProjects, color: "#F59E0B" },
              { name: "Not Covered", value: ctc.notCoveredProjects, color: "#EF4444" },
            ]) : [];
            const pctValue = ctc ? ctc.communityTestCoverage : 0;
            const alert = pctValue >= 60
              ? { box: "bg-green-50 border-green-400", text: "text-green-800" }
              : pctValue >= 40
                ? { box: "bg-yellow-50 border-yellow-400", text: "text-yellow-800" }
                : { box: "bg-red-50 border-red-400", text: "text-red-800" };
            const interpretation =
              pctValue >= 80 ? "Excellent! Most dependent projects use only well-tested APIs."
                : pctValue >= 60 ? "Good coverage, but some dependents rely on untested APIs."
                  : pctValue >= 40 ? "Moderate coverage. Many dependents use APIs without complete test coverage."
                    : pctValue >= 20 ? "Low coverage. Most dependents use some untested APIs."
                      : "Critical! Very few dependents use well tested API methods of your library.";
            return (
              <MetricTab
                title="Community Test Coverage (CTC)"
                question="What is CTC?"
                definition={<>Measures the percentage of dependent projects where <strong>ALL</strong> API methods they use from your library are fully covered by your library's tests.</>}
                basis={basis}
              >
                {!ctc && communityTestCoverageError && <CoverageUnavailable coverage={communityTestCoverageError} />}
                {ctc && (
                  <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
                    <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-8 rounded-lg border-2 border-purple-300 text-center">
                      <div className="text-sm text-purple-600 font-semibold mb-2">Community Test Coverage</div>
                      <div className="text-6xl font-bold text-purple-700 mb-4">{ctc.communityTestCoverage}%</div>
                      <div className="text-lg text-purple-600 mb-4">
                        {ctc.NPFullyCovered.toLocaleString()} of {ctc.NPtotal.toLocaleString()} dependents
                      </div>
                      <div className="w-full bg-purple-200 rounded-full h-4 mb-4">
                        <div className="bg-purple-600 h-4 rounded-full" style={{ width: `${ctc.communityTestCoverage}%` }} />
                      </div>
                      <p className="text-sm text-purple-700 italic">
                        {ctc.NPFullyCovered.toLocaleString()} of {ctc.NPtotal.toLocaleString()} projects use only API methods
                        that are fully covered by the library's tests. The
                        other {(ctc.NPtotal - ctc.NPFullyCovered).toLocaleString()} use at least one method that is not
                        fully covered.
                      </p>
                    </div>

                    <div className={`border-l-4 p-4 ${alert.box}`}>
                      <h3 className={`text-sm font-medium ${alert.text}`}>{interpretation}</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                        <div className="text-sm text-green-600 font-semibold mb-2">Fully Covered <InfoIcon text={FULLY_COVERED_INFO} /></div>
                        <div className="text-3xl font-bold text-green-600">{ctc.NPFullyCovered.toLocaleString()}</div>
                        <div className="text-xs text-green-600 mt-1">Dependents use API methods that are fully covered by library's test suite.</div>
                      </div>
                      <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                        <div className="text-sm text-yellow-600 font-semibold mb-2">Partially Covered</div>
                        <div className="text-3xl font-bold text-yellow-600">{ctc.partiallyCoveredProjects.toLocaleString()}</div>
                        <div className="text-xs text-yellow-600 mt-1">Dependents use some API methods that lack tests in your library's test suite.</div>
                      </div>
                      <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                        <div className="text-sm text-red-600 font-semibold mb-2">Not Covered</div>
                        <div className="text-3xl font-bold text-red-600">{ctc.notCoveredProjects.toLocaleString()}</div>
                        <div className="text-xs text-red-600 mt-1">Dependents use API methods that have no test(s) in your library's test suite.</div>
                      </div>
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <div className="text-sm text-blue-600 font-semibold mb-2">Average Coverage</div>
                        <div className="text-3xl font-bold text-blue-600">{ctc.averageProjectCoverage}%</div>
                        <div className="text-xs text-blue-600 mt-1">Across all dependents</div>
                      </div>
                    </div>

                    <div className="bg-white p-6 rounded-lg border border-gray-200">
                      <h3 className="text-lg font-semibold mb-4 text-gray-700">Dependent Projects Breakdown</h3>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={slices}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={100}
                            label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                          >
                            {slices.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="max-w-2xl">
                      <Breakdown
                        title={`The projects use ${ctc.methodsWithCode.toLocaleString()} methods that have code.`}
                        groups={[
                          { label: "fully covered", count: ctc.methodsFullyCovered, bar: "bg-green-500", text: "text-green-700", info: FULLY_COVERED_INFO },
                          { label: "partly covered", count: ctc.methodsPartlyCovered, bar: "bg-yellow-400", text: "text-yellow-700" },
                          { label: "not covered at all", count: ctc.methodsNotCovered, bar: "bg-red-500", text: "text-red-700" },
                        ]}
                      />
                    </div>
                  </div>
                )}
                {ctc && (
                  <TopTable
                    title="Methods that are not fully covered, and how many projects use them"
                    column="Method"
                    rows={(ctc.notFullyCoveredMethods || []).map((m) => ({ name: m.method, count: m.dependents, partly: m.partlyCovered }))}
                    extra={{
                      column: "Coverage",
                      cell: (r) => r.partly
                        ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Partially covered</span>
                        : <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Not covered</span>,
                    }}
                  />
                )}
              </MetricTab>
            );
          })()}


          </>
          );
        })()}

        {/* All card ends before below if the global div*/}

      </div>
    </div>
  );
};

export default MaintainerSummaryPage;