FROM node:22.23.4-bookworm-slim AS build

WORKDIR /app/server-ts
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY server-ts/package*.json ./
RUN npm ci
COPY server-ts/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22.23.4-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DB_PATH=/data/tinyfrens.db

WORKDIR /app/server-ts
RUN groupadd --gid 10001 tinyfrens \
    && useradd --uid 10001 --gid tinyfrens --create-home tinyfrens \
    && mkdir -p /data \
    && chown tinyfrens:tinyfrens /data

COPY --from=build --chown=tinyfrens:tinyfrens /app/server-ts/package*.json ./
COPY --from=build --chown=tinyfrens:tinyfrens /app/server-ts/node_modules ./node_modules
COPY --from=build --chown=tinyfrens:tinyfrens /app/server-ts/dist ./dist
COPY --chown=tinyfrens:tinyfrens server/admin.html /app/server/admin.html
COPY --chown=tinyfrens:tinyfrens web /app/web
COPY --chown=tinyfrens:tinyfrens contracts/config/economy.json /app/contracts/config/economy.json

USER tinyfrens
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
