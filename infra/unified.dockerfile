# syntax=docker/dockerfile:1-labs
FROM debian:12-slim

# Install base dependencies and runtime requirements
# Add PostgreSQL 17 official repository
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
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
    dpkg-dev \
    gcc \
    g++ \
    libc6-dev \
    libssl-dev \
    make \
    wget \
    git \
    cmake \
    unzip \
    && wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add - \
    && echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    postgresql-17 \
    postgresql-contrib-17 \
    postgresql-client-17 \
    && cd /usr/src \
    && wget -O redis-stable.tar.gz https://github.com/redis/redis/archive/refs/tags/8.2.1.tar.gz \
    && tar xf redis-stable.tar.gz \
    && cd redis-8.2.1 \
    && export BUILD_TLS=yes \
    && make -j "$(nproc)" all \
    && make install \
    && cd / \
    && rm -rf /usr/src/redis* \
    && adduser --system --group --no-create-home redis \
    && \
    # Install asdf version manager before cleanup
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then ARCH="arm64"; fi && \
    if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"; fi && \
    ASDF_VERSION=v0.18.0 && \
    ASDF_DIR=/root/.asdf && \
    wget -q https://github.com/asdf-vm/asdf/releases/download/${ASDF_VERSION}/asdf-${ASDF_VERSION}-linux-${ARCH}.tar.gz -O /tmp/asdf.tar.gz && \
    mkdir -p $ASDF_DIR && \
    tar -xzf /tmp/asdf.tar.gz -C $ASDF_DIR && \
    rm /tmp/asdf.tar.gz && \
    # Clean up after asdf installation
    apt-get remove -y build-essential wget gnupg lsb-release dpkg-dev gcc g++ libc6-dev libssl-dev make cmake \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set asdf environment variables
ENV ASDF_VERSION=v0.18.0
ENV ASDF_DIR=/root/.asdf
ENV ASDF_DATA_DIR=${ASDF_DIR}
ENV PATH="${ASDF_DIR}:${ASDF_DATA_DIR}/shims:$PATH"

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

# Copy package files
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY --parents packages/*/package.json .
COPY --parents apps/*/package.json .

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Install all dependencies, build, then prune to production only
RUN --mount=type=cache,target=/app/.turbo pnpm build

# Copy database init scripts
COPY packages/db/init/ /docker-entrypoint-initdb.d/

# Copy migrations to the API directory where they're expected
RUN cp -r /app/packages/db/migrations /app/apps/api/migrations

# Create directories with correct ownership
RUN mkdir -p /var/log/supervisor /var/log/postgresql /run/postgresql && \
    mkdir -p /var/lib/postgresql/data && \
    chown -R postgres:postgres /var/lib/postgresql && \
    chmod 755 /var/lib/postgresql && \
    chmod 700 /var/lib/postgresql/data && \
    touch /var/log/postgresql.log && \
    chown postgres:postgres /var/log/postgresql.log && \
    chown postgres:postgres /run/postgresql && \
    mkdir -p /var/lib/redis && \
    chown redis:redis /var/lib/redis && \
    chmod 755 /var/lib/redis

# Configure Supervisor
COPY infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create startup script
COPY infra/start.sh /start.sh
RUN chmod +x /start.sh

# Expose ports
EXPOSE 3002 3003 3004 3005 3006 4001 4002 5432 6379

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

ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# Start all services
CMD ["/start.sh"]
