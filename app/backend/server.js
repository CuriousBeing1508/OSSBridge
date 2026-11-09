require("dotenv").config({ quiet: true });

const app = require("./src/app");
const results = require("./src/results");
const PORT = process.env.PORT || 5050;

// The server answers right away. Pages show a loading message until the data is ready.
app.listen(PORT, () => {
  console.log(`OSSBridge backend running on http://localhost:${PORT}`);
});
results.start();
