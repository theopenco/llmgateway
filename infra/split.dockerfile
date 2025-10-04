# syntax=docker/dockerfile:1-labs
FROM debian:12-slim AS base-builder

# Install base dependencies including tini for better caching
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    curl \
    bash \
    tar \
    xz-utils \
    ca-certificates \
    tini \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && /usr/bin/tini --version

# Install asdf version manager
ENV ASDF_VERSION=v0.18.0
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}
ENV PATH="${ASDF_DIR}:${ASDF_DATA_DIR}/shims:$PATH"

RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi && \
    wget -q https://github.com/asdf-vm/asdf/releases/download/${ASDF_VERSION}/asdf-${ASDF_VERSION}-linux-${ARCH}.tar.gz -O /tmp/asdf.tar.gz && \
    mkdir -p $ASDF_DIR && \
    tar -xzf /tmp/asdf.tar.gz -C $ASDF_DIR && \
    rm /tmp/asdf.tar.gz

# Create app directory
WORKDIR /app

COPY .tool-versions ./

# Install asdf plugins and tools
RUN cat .tool-versions | cut -d' ' -f1 | grep "^[^\#]" | xargs -i asdf plugin add  {} && \
    asdf install && \
    asdf reshim && \
    # Verify installations
    echo "Final versions installed:" && \
    node -v && \
    pnpm -v

# verify that pnpm store path
RUN STORE_PATH="/root/.local/share/pnpm/store" && \
    if [ "${STORE_PATH#/root/.local/share/pnpm/store}" = "${STORE_PATH}" ]; then \
        echo "pnpm store path mismatch: ${STORE_PATH}"; \
        exit 1; \
    fi && \
    echo "pnpm store path matches: ${STORE_PATH}"

# Builder for API
FROM base-builder AS api-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=api... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=api

# Builder for Gateway
FROM base-builder AS gateway-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=gateway... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=gateway

# Builder for UI
FROM base-builder AS ui-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=ui... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=ui

# Builder for Playground
FROM base-builder AS playground-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=playground... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=playground

# Builder for Worker
FROM base-builder AS worker-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=worker... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=worker

# Builder for Docs
FROM base-builder AS docs-builder
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --parents packages/**/package.json .
COPY --parents apps/**/package.json .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=docs... install --frozen-lockfile
COPY . .
RUN --mount=type=cache,target=/app/.turbo pnpm run build --filter=docs

FROM debian:12-slim AS runtime

# Install base runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends bash && rm -rf /var/lib/apt/lists/*

# copy asdf, nodejs, pnpm, and tini from base-builder stage
COPY --from=base-builder /root/.asdf /root/.asdf
COPY --from=base-builder /usr/bin/tini /tini
COPY --from=base-builder /app/.tool-versions ./.tool-versions
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}

# Set working directory and configure PATH to include tool directories
WORKDIR /app

# Configure PATH to use asdf shims
ENV PATH="${ASDF_DIR}:${ASDF_DIR}/shims:$PATH"

ENTRYPOINT ["/tini", "--"]

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# API preparation stage
FROM api-builder AS api-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=api --prod deploy --legacy /app/api-dist

# API runtime stage
FROM runtime AS api
WORKDIR /app
COPY --from=api-prep /app/api-dist ./
# copy migrations files for API service to run migrations at runtime
COPY --from=api-builder /app/packages/db/migrations ./migrations
COPY --from=base-builder /app/.tool-versions ./
EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
ENV TELEMETRY_ACTIVE=true
CMD ["node", "--enable-source-maps", "dist/serve.js"]

# Gateway preparation stage
FROM gateway-builder AS gateway-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=gateway --prod deploy --legacy /app/gateway-dist

# Gateway runtime stage
FROM runtime AS gateway
WORKDIR /app
COPY --from=gateway-prep /app/gateway-dist ./
COPY --from=base-builder /app/.tool-versions ./
EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/serve.js"]

# UI runtime stage
FROM runtime AS ui
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=ui-builder /app/apps/ui/.next/standalone/ ./

EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/ui
CMD ["node", "server.js"]

# Playground runtime stage
FROM runtime AS playground
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=playground-builder /app/apps/playground/.next/standalone/ ./

EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/playground
CMD ["node", "server.js"]

# Worker preparation stage
FROM worker-builder AS worker-prep
WORKDIR /app
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm --filter=worker --prod deploy --legacy /app/worker-dist

# Worker runtime stage
FROM runtime AS worker
WORKDIR /app
COPY --from=worker-prep /app/worker-dist ./
COPY --from=base-builder /app/.tool-versions ./
ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/index.js"]

# Docs runtime stage
FROM runtime AS docs
WORKDIR /app
COPY --from=base-builder /app/.tool-versions ./

# Copy the ENTIRE standalone output - this is self-contained
COPY --from=docs-builder /app/apps/docs/.next/standalone/ ./

EXPOSE 80
ENV PORT=80
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"

# Set working directory to where server.js is located in Docker build
WORKDIR /app/apps/docs
CMD ["node", "server.js"]
