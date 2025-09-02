FROM debian:12-slim

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Install base dependencies and runtime requirements
# Add PostgreSQL 17 official repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    ca-certificates \
    gnupg \
    lsb-release \
    build-essential \
    curl \
    bash \
    tar \
    xz-utils \
    supervisor \
    tini \
    gosu \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-17 \
    postgresql-contrib-17 \
    postgresql-client-17 \
    redis-server \
    && apt-get remove -y build-essential wget gnupg lsb-release \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Create app directory and copy .tool-versions
WORKDIR /app
COPY .tool-versions ./

# Install Node.js and pnpm based on .tool-versions
RUN NODE_VERSION=$(cat .tool-versions | grep 'nodejs' | cut -d ' ' -f 2) && \
    PNPM_VERSION=$(cat .tool-versions | grep 'pnpm' | cut -d ' ' -f 2) && \
    ARCH=$(uname -m) && \
    echo "Installing Node.js v${NODE_VERSION} and pnpm v${PNPM_VERSION} for ${ARCH}" && \
    \
    # Map architecture names for Node.js official builds
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        NODE_ARCH="arm64"; \
    elif [ "$ARCH" = "x86_64" ]; then \
        NODE_ARCH="x64"; \
    else \
        echo "Unsupported architecture: ${ARCH}" && exit 1; \
    fi && \
    \
    # Download and install official Node.js glibc build
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o node-official.tar.xz && \
    tar -xJf node-official.tar.xz --strip-components=1 -C /usr/local && \
    rm node-official.tar.xz && \
    \
    # Install pnpm
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-arm64" -o /usr/local/bin/pnpm; \
    else \
        curl -fsSL "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linuxstatic-x64" -o /usr/local/bin/pnpm; \
    fi && \
    chmod +x /usr/local/bin/pnpm && \
    \
    # Verify installations
    echo "Final versions installed:" && \
    node -v && \
    pnpm -v && \
    \
    # verify that node -v matches .tool-versions nodejs version
    if [ "$(node -v)" != "v${NODE_VERSION}" ]; then \
        echo "Node.js version mismatch"; \
        exit 1; \
    fi && \
    # verify that pnpm -v matches .tool-versions pnpm version
    if [ "$(pnpm -v)" != "${PNPM_VERSION}" ]; then \
        echo "pnpm version mismatch"; \
        exit 1; \
    fi

# Copy package files and install dependencies
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/gateway/package.json ./apps/gateway/
COPY apps/ui/package.json ./apps/ui/
COPY apps/docs/package.json ./apps/docs/
COPY packages/auth/package.json ./packages/auth/
COPY packages/db/package.json ./packages/db/
COPY packages/models/package.json ./packages/models/
COPY packages/logger/package.json ./packages/logger/

RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all apps
RUN --mount=type=cache,target=/app/.turbo pnpm build

# Create directories
RUN mkdir -p /app/services /var/log/supervisor /run/postgresql /var/lib/postgresql/data && \
    chown -R postgres:postgres /var/lib/postgresql

# Deploy all services with a single command
RUN pnpm --filter=api --prod deploy /app/services/api && \
    pnpm --filter=gateway --prod deploy /app/services/gateway && \
    pnpm --filter=ui --prod deploy /app/services/ui && \
    pnpm --filter=docs --prod deploy /app/services/docs

# Copy migrations files to API service
COPY packages/db/migrations /app/services/api/migrations

# Copy database init scripts
COPY packages/db/init/ /docker-entrypoint-initdb.d/

# Configure PostgreSQL
RUN mkdir -p /run/postgresql && \
    chown postgres:postgres /run/postgresql

# Configure Redis
RUN mkdir -p /var/lib/redis && \
    chown redis:redis /var/lib/redis && \
    chmod 755 /var/lib/redis

# Configure Supervisor
COPY infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script
COPY infra/start.sh /start.sh
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
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start all services
CMD ["/start.sh"]
