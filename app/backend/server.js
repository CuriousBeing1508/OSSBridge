require("dotenv").config();

console.log(" Full ENV:", process.env); // temporary debugging line
console.log("Loaded from .env:", process.env.DATASET_PATH);

const app = require("./src/app");
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`OSSBridge backend running on http://localhost:${PORT}`);
});
