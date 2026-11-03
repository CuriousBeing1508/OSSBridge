import React, { useState } from 'react';
import API_BASE_URL from '../services/api';


const MethodSearchModal = ({ isOpen, onClose, library, version }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('search');

  // Search for methods
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/searchMethod/search?library=${library}&version=${version}&query=${searchQuery}`
      );
      const data = await response.json();
      setSearchResults(data);
      setActiveTab('search');
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Get analytics for selected method
  const handleSelectMethod = async (signature) => {
    setSelectedMethod(signature);
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/searchMethod/analytics?library=${library}&version=${version}&signature=${signature}`
      );
      const data = await response.json();
      setAnalytics(data);
      setActiveTab('analytics');
    } catch (error) {
      console.error('Analytics error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Reset to search
  const handleBackToSearch = () => {
    setActiveTab('search');
    setSelectedMethod(null);
    setAnalytics(null);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-30 z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      
      {/* Slide-in Panel */}
      <div className={`fixed right-0 top-0 h-full w-full md:w-2/3 lg:w-1/2 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex justify-between items-center shadow-lg">
            <div>
              <h2 className="text-lg font-bold">API Method Search</h2>
              <p className="text-blue-100 text-xs">{library} v{version}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white text-sm hover:bg-blue-800 px-3 py-1 rounded transition"
            >
              Close
            </button>
          </div>

          {/* Search Bar */}
          <div className="p-4 border-b bg-gray-50">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search methods (e.g., readValue, writeValue)..."
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSearch}
                disabled={loading || !searchQuery.trim()}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition text-sm"
              >
                Search
              </button>
            </div>
            
            {activeTab === 'analytics' && (
              <button
                onClick={handleBackToSearch}
                className="mt-2 text-blue-600 hover:text-blue-800 text-sm"
              >
                Back to results
              </button>
            )}
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading && (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              </div>
            )}

            {/* Search Results */}
            {!loading && activeTab === 'search' && searchResults && (
              <div className="space-y-3">
                <div className="text-xs text-gray-600 mb-3">
                  Found {searchResults.totalMatches} method(s)
                </div>
                
                {searchResults.results.map((method, index) => (
                  <div
                    key={index}
                    onClick={() => handleSelectMethod(method.signature)}
                    className="border border-gray-200 rounded-lg p-3 hover:border-blue-500 hover:shadow-md cursor-pointer transition group"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-gray-800 group-hover:text-blue-600 transition">
                          {method.methodName}
                        </h3>
                        <p className="text-xs text-gray-600 mt-1 truncate">
                          {method.fullClassName}
                        </p>
                      </div>
                      <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full ml-2 flex-shrink-0">
                        {method.overloadCount} {method.overloadCount === 1 ? 'overload' : 'overloads'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Analytics View */}
            {!loading && activeTab === 'analytics' && analytics && (
              <div className="space-y-4">
                {/* Method Info */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-base font-bold text-gray-800 mb-1">
                    {analytics.methodInfo.method}
                  </h3>
                  <p className="text-xs text-gray-600 mb-1">
                    {analytics.methodInfo.fullClassName}
                  </p>
                  {analytics.methodInfo.overloadCount > 1 && (
                    <span className="inline-block mt-1 bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                      {analytics.methodInfo.overloadCount} overloads
                    </span>
                  )}
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Dependents"
                    value={analytics.usageStatistics.dependentsUsingMethod}
                    total={analytics.usageStatistics.totalDependents}
                    color="blue"
                  />
                  <MetricCard
                    label="Total Usage"
                    value={analytics.usageStatistics.totalUsageCount}
                    color="green"
                  />
                  <MetricCard
                    label="Adoption"
                    value={`${analytics.usageStatistics.adoptionRate}%`}
                    color="purple"
                  />
                  <MetricCard
                    label="Coverage"
                    value={`${analytics.testCoverage.coveragePercentage}%`}
                    status={analytics.testCoverage.status}
                    color={getCoverageColor(analytics.testCoverage.status)}
                  />
                </div>

                {/* Summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <h4 className="font-semibold text-sm text-gray-800 mb-2">Summary</h4>
                  <p className="text-xs text-gray-700 mb-1">{analytics.summary.mainMessage}</p>
                  <p className="mt-2 text-xs font-medium">{analytics.summary.recommendation}</p>
                </div>

                {/* Insights */}
                {analytics.insights && analytics.insights.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm text-gray-800 mb-2">
                      Insights
                    </h4>
                    <div className="space-y-2">
                      {analytics.insights.map((insight, idx) => (
                        <InsightCard key={idx} insight={insight} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Parameter Patterns - Collapsible */}
                {analytics.parameterPatterns && analytics.parameterPatterns.top15.length > 0 && (
                  <details className="bg-white border border-gray-200 rounded-lg">
                    <summary className="font-semibold text-sm text-gray-800 p-3 cursor-pointer hover:bg-gray-50">
                      Parameter Patterns ({analytics.parameterPatterns.total})
                    </summary>
                    <div className="p-3 pt-0 space-y-2 max-h-64 overflow-y-auto">
                      {analytics.parameterPatterns.top15.slice(0, 5).map((pattern, idx) => (
                        <div key={idx} className="bg-gray-50 border border-gray-100 rounded p-2">
                          <div className="flex justify-between items-center mb-1">
                            <code className="text-xs text-gray-800 truncate">{pattern.pattern}</code>
                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{pattern.percentage}%</span>
                          </div>
                          <div className="text-xs text-gray-600">
                            {pattern.usageCount} uses, {pattern.dependentCount} deps
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* Top Dependents - Collapsible */}
                {analytics.topDependents && analytics.topDependents.length > 0 && (
                  <details className="bg-white border border-gray-200 rounded-lg">
                    <summary className="font-semibold text-sm text-gray-800 p-3 cursor-pointer hover:bg-gray-50">
                      Top Dependent Users ({analytics.topDependents.length})
                    </summary>
                    <div className="max-h-64 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b sticky top-0">
                          <tr>
                            <th className="text-left p-2 font-semibold">Dependent</th>
                            <th className="text-right p-2 font-semibold">Uses</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.topDependents.slice(0, 10).map((dep, idx) => (
                            <tr key={idx} className="border-b last:border-b-0 hover:bg-gray-50">
                              <td className="p-2 font-mono text-xs truncate">{dep.name}</td>
                              <td className="p-2 text-right">{dep.usageCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Empty State */}
            {!loading && !searchResults && activeTab === 'search' && (
              <div className="text-center py-16 text-gray-400">
                <p className="text-sm">Search for any API method</p>
                <p className="text-xs mt-1">Try: readValue, writeValue</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

// Helper Components
const MetricCard = ({ label, value, total, color, status }) => {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    yellow: 'bg-yellow-50 text-yellow-600 border-yellow-200',
    red: 'bg-red-50 text-red-600 border-red-200',
  };

  return (
    <div className={`border rounded-lg p-3 ${colors[color]}`}>
      <div className="text-xs font-medium mb-1">{label}</div>
      <div className="text-xl font-bold">
        {value}
        {total && <span className="text-sm font-normal">/{total}</span>}
      </div>
      {status && <div className="text-xs mt-0.5 capitalize opacity-75">{status}</div>}
    </div>
  );
};

const InsightCard = ({ insight }) => {
  const styles = {
    positive: 'bg-green-50 border-green-200 text-green-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    critical: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
  };

  return (
    <div className={`border rounded p-2 ${styles[insight.type]}`}>
      <p className="text-xs">{insight.message}</p>
    </div>
  );
};

const getCoverageColor = (status) => {
  if (status === 'excellent') return 'green';
  if (status === 'good') return 'blue';
  if (status === 'needs improvement') return 'yellow';
  return 'red';
};

// Main component with trigger button
const MethodSearchButton = ({ library, version }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition shadow-sm text-sm"
      >
        Search Methods
      </button>
      
      <MethodSearchModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        library={library}
        version={version}
      />
    </>
  );
};

export default MethodSearchButton;