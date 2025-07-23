FROM node:20.10-alpine AS base

# Build stage
FROM base AS builder
RUN apk add curl

# Create app directory
WORKDIR /app

COPY .tool-versions ./
RUN PNPM_VERSION=$(cat .tool-versions | grep 'pnpm' | cut -d ' ' -f 2) && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-arm64" -o /bin/pnpm; \
    else \
        curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64" -o /bin/pnpm; \
    fi && \
    chmod +x /bin/pnpm;

# Copy package files and install dependencies
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/ui/package.json ./apps/ui/
COPY apps/next/package.json ./apps/next/
COPY apps/docs/package.json ./apps/docs/
COPY packages/auth/package.json ./packages/auth/
COPY packages/db/package.json ./packages/db/
COPY packages/models/package.json ./packages/models/

RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all apps
RUN --mount=type=cache,target=/app/.turbo pnpm build

# Runtime stage with all services
FROM alpine:3.19 AS runtime
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Install required packages
RUN apk add --no-cache \
    nodejs \
    npm \
    postgresql \
    redis \
    supervisor \
    tini \
    curl \
    bash \
    su-exec

# Install pnpm
COPY --from=builder /bin/pnpm /bin/pnpm

# Create directories
RUN mkdir -p /app/services /var/log/supervisor /run/postgresql /var/lib/postgresql/data

# Copy built applications
WORKDIR /app/temp
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/.npmrc /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# Deploy all services with a single command
RUN pnpm --filter=api --prod deploy /app/services/api && \
    pnpm --filter=gateway --prod deploy /app/services/gateway && \
    pnpm --filter=next --prod deploy /app/services/next && \
    pnpm --filter=ui --prod deploy /app/services/ui && \
    pnpm --filter=docs --prod deploy /app/services/docs

# copy migrations files to API service
COPY --from=builder /app/packages/db/migrations /app/services/api/migrations

# Copy database init scripts
COPY --from=builder /app/packages/db/init/ /docker-entrypoint-initdb.d/

# Configure PostgreSQL
RUN mkdir -p /run/postgresql && \
    chown postgres:postgres /run/postgresql && \
    chown -R postgres:postgres /var/lib/postgresql

# Configure Redis
RUN mkdir -p /var/lib/redis && \
    chown redis:redis /var/lib/redis && \
    chmod 755 /var/lib/redis

# Configure Supervisor
COPY --from=builder /app/infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script
COPY --from=builder /app/infra/start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports
EXPOSE 3002 3005 4001 4002 5432 6379

# Set environment variables
ENV NODE_ENV=production
ENV POSTGRES_USER=postgres
ENV POSTGRES_PASSWORD=llmgateway
ENV POSTGRES_DB=llmgateway
ENV DATABASE_URL=postgres://postgres:llmgateway@localhost:5432/llmgateway
ENV REDIS_HOST=localhost
ENV REDIS_PORT=6379
ENV TELEMETRY_ACTIVE=true

ENV RUN_MIGRATIONS=true

# Use tini as init system
ENTRYPOINT ["/sbin/tini", "--"]

# Start all services
CMD ["/start.sh"]
