# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório (docker build -f apps/api/Dockerfile .)
FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/trackgen/package.json packages/trackgen/
COPY packages/sim/package.json packages/sim/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Bundle único (tsup) + package.json mínimo com as dependências que não podem ser empacotadas (WASM/nativas).
RUN pnpm --filter @tracado/api build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
RUN cp dist/package.json ./package.json && npm install --omit=dev --no-audit --no-fund && npm cache clean --force
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
