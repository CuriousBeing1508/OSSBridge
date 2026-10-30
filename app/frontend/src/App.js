import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { LibraryProvider } from "./context/LibraryContext";
import HomePage from "./pages/HomePage";
import AnalysisPage from "./pages/AnalysisPage.jsx";
import DependentDetailPage from "./pages/DependentDetailPage";
import MaintainerSummaryPage from "./pages/MaintainerSummaryPage.jsx";
import AboutPage from "./pages/AboutPage";

function App() {
  return (
    <LibraryProvider>
      <Router>
        <Routes>
          {/* Landing Page */}
          <Route path="/" element={<HomePage />} />

          {/* Analysis Routes */}
          <Route path="/analysisV2" element={<AnalysisPage />} />
          <Route path="/analysisV2/dependent" element={<DependentDetailPage />} />
          <Route
            path="/analysisV2/maintainer-summary"
            element={<MaintainerSummaryPage />}
          />

          {/* About Page */}
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </Router>
    </LibraryProvider>
  );
}

export default App;