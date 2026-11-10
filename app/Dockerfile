# The frontend and backend in one container.
# Hugging Face Spaces and docker-compose.yml both use it.

FROM node:22-bookworm-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Empty: the page requests /api from its own address, which the backend serves
ENV REACT_APP_API_URL=""
RUN npm run build

# DuckDB's Node package ships glibc builds only, so the image is Debian based
FROM node:22-bookworm-slim
# CA certificates for DuckDB's HTTPS reads from Hugging Face
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /frontend/build /app/frontend

# Spaces run the container as user 1000 (the image's node user); DuckDB keeps
# its extensions in the home directory
USER node
ENV HOME=/home/node \
    NODE_ENV=production \
    PORT=7860 \
    FRONTEND_DIR=/app/frontend \
    RESULTS_PATH=hf://datasets/rachna1508/ossbridge-results/results \
    INDEX_PATH=hf://datasets/rachna1508/ossbridge-results/dependents-index
EXPOSE 7860
CMD ["node", "server.js"]
