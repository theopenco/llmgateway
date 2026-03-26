#!/bin/bash
set -euo pipefail

# Run the published unified LLMGateway container with Docker-managed volumes.
# This avoids PostgreSQL permission errors from bind-mounting host directories
# onto /var/lib/postgresql/data.

CONTAINER_NAME="${CONTAINER_NAME:-llmgateway}"
POSTGRES_VOLUME="${POSTGRES_VOLUME:-llmgateway_postgres}"
REDIS_VOLUME="${REDIS_VOLUME:-llmgateway_redis}"

if [ -z "${LLM_GATEWAY_SECRET:-}" ]; then
    echo "LLM_GATEWAY_SECRET is not set." >&2
    echo "Export a strong secret first, for example:" >&2
    echo "  export LLM_GATEWAY_SECRET=\"$(openssl rand -base64 32 | tr -d '\n')\"" >&2
    exit 1
fi

docker volume create "$POSTGRES_VOLUME" >/dev/null
docker volume create "$REDIS_VOLUME" >/dev/null

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "Removing existing container $CONTAINER_NAME..."
    docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting $CONTAINER_NAME..."
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p 3002:3002 \
    -p 3003:3003 \
    -p 3005:3005 \
    -p 3006:3006 \
    -p 4001:4001 \
    -p 4002:4002 \
    -v "$POSTGRES_VOLUME:/var/lib/postgresql/data" \
    -v "$REDIS_VOLUME:/var/lib/redis" \
    -e AUTH_SECRET="$LLM_GATEWAY_SECRET" \
    ghcr.io/theopenco/llmgateway-unified:latest

echo "Container started. Follow logs with:"
echo "  docker logs -f $CONTAINER_NAME"
