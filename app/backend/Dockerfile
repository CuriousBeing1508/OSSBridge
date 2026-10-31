# DuckDB's Node package ships glibc builds only, so the image is Debian based
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5050
ENV NODE_ENV=production
CMD ["node", "server.js"]
