# DuckDB's Node package ships glibc builds only, so the image is Debian based
FROM node:22-bookworm-slim
# CA certificates for DuckDB's HTTPS reads (RESULTS_PATH / INDEX_PATH on Hugging Face)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5050
ENV NODE_ENV=production
CMD ["node", "server.js"]
