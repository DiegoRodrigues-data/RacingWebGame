# syntax=docker/dockerfile:1.7
# Contexto de build: raiz do repositório (docker build -f apps/web/Dockerfile .)
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/trackgen/package.json packages/trackgen/
COPY packages/sim/package.json packages/sim/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile
COPY . .
# E-mail de contato das páginas de Privacidade e Termos (opcional, embutido no bundle).
ARG VITE_CONTACT_EMAIL=""
ENV VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL
RUN pnpm --filter @tracado/web build

FROM nginx:1.27-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
