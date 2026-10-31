require("dotenv").config({ quiet: true });

const app = require("./src/app");
const results = require("./src/results");
const PORT = process.env.PORT || 5050;

results.reload()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`OSSBridge backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error(`Could not load the result tables from ${results.RESULTS_PATH}: ${err.message}`);
    process.exit(1);
  });
