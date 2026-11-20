# syntax=docker/dockerfile:1
# One build for all CommuCal images (ADR-0002). Targets:
#   dev     – dependencies only; source is synced by `docker compose watch` (compose.dev.yaml)
#   test    – lint, typecheck and tests
#   web     – Next.js standalone server
#   mcp     – MCP server, TypeScript run directly by Node
#   worker  – background jobs, TypeScript run directly by Node
#   migrate – applies database migrations and enables the runtime roles, then exits

ARG NODE_IMAGE=node:26.13.1-alpine

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=12.21.0
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    npm_config_store_dir=/home/node/.pnpm-store
RUN npm install --global "pnpm@${PNPM_VERSION}" && npm cache clean --force \
    && mkdir /app && chown node:node /app
WORKDIR /app
USER node

# Manifests only, so dependency layers stay cached until a manifest or the lockfile changes.
FROM base AS manifests
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/web/package.json apps/web/
COPY --chown=node:node apps/mcp/package.json apps/mcp/
COPY --chown=node:node apps/worker/package.json apps/worker/
COPY --chown=node:node packages/core/package.json packages/core/
COPY --chown=node:node packages/db/package.json packages/db/
COPY --chown=node:node packages/config/package.json packages/config/

FROM manifests AS deps
RUN --mount=type=cache,id=commucal-pnpm,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile

FROM deps AS dev
COPY --chown=node:node . .
# Owned by node, so the tmpfs for .next/cache does not leave a root-owned .next behind.
RUN mkdir -p apps/web/.next

FROM deps AS test
COPY --chown=node:node . .
CMD ["sh", "-c", "pnpm lint && pnpm typecheck && pnpm test"]

FROM deps AS build
COPY --chown=node:node . .
RUN pnpm --filter @commucal/web build

# Production dependencies of the Node services only (no Next.js, no dev tooling).
FROM manifests AS services-deps
RUN --mount=type=cache,id=commucal-pnpm,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    pnpm install --frozen-lockfile --prod \
      --filter "@commucal/mcp..." --filter "@commucal/worker..." --filter "@commucal/db..."

FROM ${NODE_IMAGE} AS services
ENV NODE_ENV=production
WORKDIR /app
COPY --from=services-deps --chown=node:node /app ./
COPY --chown=node:node packages/core/src packages/core/src
COPY --chown=node:node packages/db/src packages/db/src
COPY --chown=node:node packages/db/drizzle packages/db/drizzle
COPY --chown=node:node apps/mcp/src apps/mcp/src
COPY --chown=node:node apps/worker/src apps/worker/src
USER node

FROM services AS mcp
WORKDIR /app/apps/mcp
ENV PORT=3001
EXPOSE 3001
CMD ["node", "src/main.ts"]

FROM services AS worker
WORKDIR /app/apps/worker
CMD ["node", "src/main.ts"]

FROM services AS migrate
WORKDIR /app/packages/db
CMD ["node", "src/migrate.ts"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
