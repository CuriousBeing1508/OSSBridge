const express = require("express");
const cors = require("cors");
const dependencyRoutes = require("./routes/dependencyRoutes");
// const analysisRoutes = require("./routes/analysisRoutes"); 
const analysisRoutesV2 = require("./routes/analysisRoutesV2"); 
const searchMethodRoutes = require('./routes/searchMethods');

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/dependencies", dependencyRoutes);
// app.use("/api/analysis", analysisRoutes);
app.use("/api/analysisV2", analysisRoutesV2);
app.use('/api/searchMethod', searchMethodRoutes); 

module.exports = app;
