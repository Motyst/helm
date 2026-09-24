# syntax=docker/dockerfile:1

# ---- Build: install the workspace, build the web app and bundle the server ----
FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
COPY packages/shared/package.json packages/shared/
# No install scripts: nothing here needs a native build (better-sqlite3 comes from the next stage).
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

# ---- Native: better-sqlite3 is the only dependency the bundle doesn't contain ----
FROM node:22-bookworm-slim AS native
WORKDIR /native
# Normally a prebuilt binary is downloaded; the toolchain is the fallback and stays in this stage.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY apps/server/package.json /tmp/server.json
RUN version=$(node -p "require('/tmp/server.json').dependencies['better-sqlite3']") \
  && npm init -y > /dev/null \
  && npm install --omit=dev --no-audit --no-fund "better-sqlite3@$version"

# ---- Runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HELM_HOST=0.0.0.0 \
    HELM_PORT=8787 \
    HELM_DB_PATH=/data/helm.db \
    HELM_WEB_DIST=/app/web
WORKDIR /app
COPY --from=native /native/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./dist
# The bundle looks for migrations at ../migrations, next to dist/.
COPY --from=build /src/packages/db/migrations ./migrations
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.HELM_PORT + '/api/v1/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.mjs"]
