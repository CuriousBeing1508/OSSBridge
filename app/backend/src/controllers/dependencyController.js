const dependencyService = require("../services/dependencyServices");

exports.searchLibraries = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query required" });

    const results = await dependencyService.searchLibraries(query);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVersions = async (req, res) => {
  try {
    const { library } = req.query;
    if (!library) return res.status(400).json({ error: "Library name required" });

    const versions = await dependencyService.getVersions(library);
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDependents = async (req, res) => {
  try {
    const { library, version } = req.query;
    if (!library || !version)
      return res.status(400).json({ error: "Library and version required" });

    const details = await dependencyService.getDependents(library, version);
    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
