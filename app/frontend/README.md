# OSSBridge Frontend

The React app that shows the OSSBridge results. It reads them from the backend in `../backend`.

## Run the app

The frontend and backend run together in one Docker container. The backend serves the built frontend. Run these commands from `app/`.

Create the settings file once. See "Run the app on your computer" in the [main README](../../README.md) for what goes in it.

```bash
cp .env.example .env
```

Start the app.

```bash
docker compose up -d --build
```

Open http://localhost:3000. The data takes up to a minute to load. To follow it, run `docker compose logs -f ossbridge` and wait for `OSSBridge backend running on http://localhost:3000`.

Stop the app.

```bash
docker compose down
```

After changing code, run `docker compose up -d --build` again. After changing only `.env`, `docker compose up -d` is enough.

## Run the frontend and backend separately

Use this when you change the frontend and want it to reload on each save.

Start the backend. It listens on port 5050 and reads the data from `data/results/` and `data/dependents-index/` at the repository root. To read the published dataset instead, set `RESULTS_PATH` and `INDEX_PATH` in `app/backend/.env` as in `app/.env.example`.

```bash
cd app/backend && npm install && node server.js
```

Then start the frontend. It opens on http://localhost:3000.

```bash
cd app/frontend && npm install && npm start
```

The frontend calls the backend at `http://localhost:5050`. Set `REACT_APP_API_URL` to use another address.

## Folders

| Folder | Contents |
|---|---|
| `src/pages/` | One file per page: home, analysis, maintainer summary, dependent detail and about |
| `src/components/` | Shared parts such as the header, search box and version selector |
| `src/services/api.js` | All calls to the backend |
| `src/context/` | The selected library and version, shared between pages |
