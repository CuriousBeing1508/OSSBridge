// frontend/src/services/api.js
import axios from "axios";


// ====================================================================
// API CONFIGURATION
// Works in both development (localhost) and production (Docker)
// ====================================================================
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5050';

console.log('[INFO] API Base URL:', API_BASE_URL);


// ====================================================================
// API CLIENTS
// ====================================================================


// Base API for dependencies
const DEP_API = axios.create({
  baseURL: `${API_BASE_URL}/api/dependencies`,
  timeout: 10000,
});

// Base API for analysis
const ANALYSIS_API = axios.create({
  baseURL: `${API_BASE_URL}/api/analysisV2`,
  timeout: 10000,
});

// Base API for search methods
const SEARCH_METHOD_API = axios.create({
  baseURL: `${API_BASE_URL}/api/searchMethod`,
  timeout: 10000,
});



// ====================================================================
// DEPENDENCY FUNCTIONS
// ====================================================================

export const searchLibraries = async (query) =>
  DEP_API.get(`/search`, { params: { query } });

export const getVersions = async (library) =>
  DEP_API.get(`/versions`, { params: { library } });

export const getDependents = async (library, version) =>
  DEP_API.get(`/details`, { params: { library, version } });

// ====================================================================
// ANALYSIS FUNCTIONS
// ====================================================================

// Library-level analysis (top dependents, mean, median, etc.)
export const getLibraryUsage = async (library, version, top = 10) =>
  ANALYSIS_API.get(`/usage`, { params: { library, version, top } });

// Specific dependent details
export const getDependentDetails = async (library, version, dependent) =>
  ANALYSIS_API.get(`/dependent-details`, { params: { library, version, dependent } });

// Maintainer summary view
export const getMaintainerSummary = async (library, version) =>
  ANALYSIS_API.get(`/maintainer-summary`, { params: { library, version } });

// ====================================================================
// EXPORT API BASE URL (for components that need direct fetch)
// ====================================================================
export { API_BASE_URL };
export default API_BASE_URL;


