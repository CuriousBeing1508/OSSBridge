const path = require("path");
const express = require("express");
const cors = require("cors");
const dependencyRoutes = require("./routes/dependencyRoutes");
// const analysisRoutes = require("./routes/analysisRoutes");
const analysisRoutesV2 = require("./routes/analysisRoutesV2");
const searchMethodRoutes = require('./routes/searchMethods');
const analyzeRoutes = require("./routes/analyzeRoutes");
const results = require("./results");

const app = express();
app.use(cors());
app.use(express.json());

// Until the data has loaded, data requests get a clear message instead of an error.
// The Analyze settings need no data, so they always answer.
app.use("/api", (req, res, next) => {
  if (results.isLoaded() || req.path === "/analyze/config") return next();
  res.status(503).json({ error: "The data is still loading. Please try again in a minute." });
});

app.use("/api/dependencies", dependencyRoutes);
// app.use("/api/analysis", analysisRoutes);
app.use("/api/analysisV2", analysisRoutesV2);
app.use('/api/searchMethod', searchMethodRoutes);
app.use("/api/analyze", analyzeRoutes);

// Serve the built frontend from the same address (the Hugging Face Space);
// other page paths get index.html so the frontend's router handles them.
if (process.env.FRONTEND_DIR) {
  const frontendDir = path.resolve(process.env.FRONTEND_DIR);
  app.use(express.static(frontendDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDir, "index.html"));
  });
}

module.exports = app;
