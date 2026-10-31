# OSSBridge Backend

This is the **backend service** for OSSBridge.  
It is built with **Node.js** and **Express**, following a modular structure for scalability and maintainability.

---

## Tech Stack
- **Node.js** (Runtime)
- **Express.js** (Web Framework)
- **DuckDB** (queries the OSSBridge result tables, Parquet; see `src/results.js`)
- **CORS** (Cross-Origin requests)
- **Dotenv** (Environment configuration)
- (Optional) **MongoDB / PostgreSQL** (for persistence)

---

## Installation & Setup

### 1. Clone the repo
```bash
git clone <repo-url>
cd OSSBridge/backend


### 2. Install dependencies

```bash
npm install