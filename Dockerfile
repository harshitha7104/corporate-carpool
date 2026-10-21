# Single image: builds the React app, then runs the Node API that serves it.
FROM node:22-alpine AS web
WORKDIR /app/front-end/carpool
COPY front-end/carpool/package*.json ./
RUN npm ci
COPY front-end/carpool/ ./
RUN npm run build

FROM node:22-alpine AS api-deps
WORKDIR /app/backend
COPY backend/package*.json ./
# Production dependencies only (no embedded PostgreSQL).
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /data/uploads && chown app:app /data/uploads
COPY --from=api-deps /app/backend/node_modules backend/node_modules
COPY backend/ backend/
COPY --from=web /app/front-end/carpool/dist front-end/carpool/dist
ENV STORAGE_DIR=/data/uploads
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/ready || exit 1
CMD ["node", "backend/src/server.js"]
