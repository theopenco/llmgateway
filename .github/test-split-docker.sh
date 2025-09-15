#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_PREFIX="llmgateway-split-test"
IMAGE_PREFIX="${1:-ghcr.io/terragonlabs/llmgateway}"
IMAGE_TAG="${2:-latest}"
LOCAL_IMAGE_FLAG="${3:-}"
STARTUP_TIMEOUT=120
HEALTH_CHECK_TIMEOUT=60

# Array of apps and their configurations
declare -A APP_PORTS
APP_PORTS["api"]=4002
APP_PORTS["gateway"]=4001
APP_PORTS["ui"]=3002
APP_PORTS["docs"]=3005

declare -A APP_ENDPOINTS
APP_ENDPOINTS["api"]="http://localhost:4002/"
APP_ENDPOINTS["gateway"]="http://localhost:4001/"
APP_ENDPOINTS["ui"]="http://localhost:3002"
APP_ENDPOINTS["docs"]="http://localhost:3005"

# Array to store test results and container IDs
declare -A RESULTS
declare -A CONTAINER_IDS

# Function to clean up containers on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up containers...${NC}"
  if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
    echo "Stopping docker compose services"
    docker compose -f "$TEMP_COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
    rm -f "$TEMP_COMPOSE_FILE"
  fi
  # Fallback: direct container cleanup
  for app in "${!APP_PORTS[@]}"; do
    container_name="${CONTAINER_PREFIX}-${app}"
    if docker ps -q -f name=$container_name | grep -q .; then
      echo "Stopping and removing container $container_name"
      docker stop $container_name >/dev/null 2>&1 || true
      docker rm $container_name >/dev/null 2>&1 || true
    fi
  done
  echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap to ensure cleanup on script exit
trap cleanup EXIT

# Function to check if an endpoint is healthy
check_endpoint() {
  local endpoint=$1
  local app=$2
  
  if curl -s --fail --connect-timeout 5 --max-time 10 "$endpoint" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ $app endpoint ($endpoint) is responding${NC}"
    return 0
  else
    echo -e "${RED}✗ $app endpoint ($endpoint) is not responding${NC}"
    return 1
  fi
}

# Function to wait for all endpoints to be healthy
wait_for_endpoints() {
  local timeout=$1
  local count=0
  
  echo -e "${YELLOW}Waiting for all endpoints to become healthy...${NC}"
  
  while [ $count -lt $timeout ]; do
    local all_healthy=true
    
    for app in "${!APP_ENDPOINTS[@]}"; do
      endpoint="${APP_ENDPOINTS[$app]}"
      if ! check_endpoint "$endpoint" "$app" >/dev/null 2>&1; then
        all_healthy=false
        break
      fi
    done
    
    if $all_healthy; then
      echo -e "${GREEN}All endpoints are healthy!${NC}"
      return 0
    fi
    
    echo -e "${YELLOW}Waiting for endpoints to become healthy... (${count}s/${timeout}s)${NC}"
    sleep 5
    count=$((count + 5))
  done
  
  echo -e "${RED}Timeout waiting for endpoints to become healthy${NC}"
  return 1
}

echo "=== LLMGateway Split Docker Images Test ==="
echo "Testing split Docker images with prefix: $IMAGE_PREFIX"

# Step 1: Create temporary docker compose file
TEMP_COMPOSE_FILE=$(mktemp -t docker compose-split-test-XXXX.yml)
echo -e "${YELLOW}Creating temporary docker compose file: $TEMP_COMPOSE_FILE${NC}"

cat > "$TEMP_COMPOSE_FILE" << EOF
name: llmgateway-split-test

services:
  gateway:
    image: ${IMAGE_PREFIX}-gateway:${IMAGE_TAG}
    container_name: ${CONTAINER_PREFIX}-gateway
    ports:
      - "4001:80"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks:
      - test-network
    environment:
      - NODE_ENV=production
      - PORT=80
      - DATABASE_URL=postgres://postgres:test_password@postgres:5432/llmgateway
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - REDIS_PASSWORD=test_password

  api:
    image: ${IMAGE_PREFIX}-api:${IMAGE_TAG}
    container_name: ${CONTAINER_PREFIX}-api
    ports:
      - "4002:80"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks:
      - test-network
    environment:
      - NODE_ENV=production
      - RUN_MIGRATIONS=true
      - PORT=80
      - DATABASE_URL=postgres://postgres:test_password@postgres:5432/llmgateway
      - UI_URL=http://localhost:3002
      - API_URL=http://localhost:4002
      - ORIGIN_URL=http://localhost:3002
      - COOKIE_DOMAIN=localhost
      - PASSKEY_RP_ID=localhost
      - PASSKEY_RP_NAME=LLMGateway

  ui:
    image: ${IMAGE_PREFIX}-ui:${IMAGE_TAG}
    container_name: ${CONTAINER_PREFIX}-ui
    ports:
      - "3002:80"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks:
      - test-network
    environment:
      - API_URL=http://localhost:4002
      - DOCS_URL=http://localhost:3005

  docs:
    image: ${IMAGE_PREFIX}-docs:${IMAGE_TAG}
    container_name: ${CONTAINER_PREFIX}-docs
    ports:
      - "3005:80"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks:
      - test-network
    environment:
      - DOCS_URL=http://localhost:3005

  postgres:
    image: postgres:17-alpine
    container_name: ${CONTAINER_PREFIX}-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: test_password
      POSTGRES_DB: llmgateway
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - test-network

  redis:
    image: redis:8-alpine
    container_name: ${CONTAINER_PREFIX}-redis
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "test_password"]
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - test-network

networks:
  test-network:
    driver: bridge
EOF

# Step 2: Verify images exist (for local builds)
if [ "$LOCAL_IMAGE_FLAG" == "--local" ]; then
  echo -e "${YELLOW}Verifying locally built images...${NC}"
  for app in "${!APP_PORTS[@]}"; do
    image_name="${IMAGE_PREFIX}-${app}:${IMAGE_TAG}"
    if ! docker image inspect "$image_name" >/dev/null 2>&1; then
      echo -e "${RED}Local image not found: $image_name${NC}"
      exit 1
    fi
    echo -e "${GREEN}Local image verified: $app${NC}"
  done
else
  echo -e "${YELLOW}Pulling Docker images...${NC}"
  for app in "${!APP_PORTS[@]}"; do
    image_name="${IMAGE_PREFIX}-${app}:${IMAGE_TAG}"
    if ! docker pull "$image_name"; then
      echo -e "${RED}Failed to pull image: $image_name${NC}"
      exit 1
    fi
    echo -e "${GREEN}Image pulled successfully: $app${NC}"
  done
fi

# Step 3: Stop any existing compose services
echo -e "${YELLOW}Stopping any existing services...${NC}"
docker compose -f "$TEMP_COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true

# Step 4: Start the services using docker compose
echo -e "${YELLOW}Starting split Docker services...${NC}"
if ! docker compose -f "$TEMP_COMPOSE_FILE" up -d; then
  echo -e "${RED}Failed to start services${NC}"
  exit 1
fi

echo -e "${GREEN}Services started successfully${NC}"

# Step 5: Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to become healthy...${NC}"
timeout_count=0
max_timeout=$((STARTUP_TIMEOUT / 5))

while [ $timeout_count -lt $max_timeout ]; do
  healthy_count=0
  total_services=4  # api, gateway, ui, docs (postgres and redis are dependencies)
  
  # Check health status of each service
  if docker compose -f "$TEMP_COMPOSE_FILE" ps api | grep -q "healthy"; then
    healthy_count=$((healthy_count + 1))
  fi
  if docker compose -f "$TEMP_COMPOSE_FILE" ps gateway | grep -q "healthy"; then
    healthy_count=$((healthy_count + 1))
  fi
  if docker compose -f "$TEMP_COMPOSE_FILE" ps ui | grep -q "healthy"; then
    healthy_count=$((healthy_count + 1))
  fi
  if docker compose -f "$TEMP_COMPOSE_FILE" ps docs | grep -q "healthy"; then
    healthy_count=$((healthy_count + 1))
  fi
  
  if [ $healthy_count -eq $total_services ]; then
    echo -e "${GREEN}All services are healthy${NC}"
    break
  fi
  
  echo -e "${YELLOW}Waiting for services to become healthy... ($healthy_count/$total_services healthy, ${timeout_count}/${max_timeout})${NC}"
  sleep 5
  timeout_count=$((timeout_count + 1))
  
  if [ $timeout_count -ge $max_timeout ]; then
    echo -e "${RED}Services failed to become healthy within ${STARTUP_TIMEOUT}s${NC}"
    docker compose -f "$TEMP_COMPOSE_FILE" ps
    docker compose -f "$TEMP_COMPOSE_FILE" logs --tail 50
    exit 1
  fi
done

# Step 5: Check container logs for any immediate errors
echo -e "${YELLOW}Checking container logs for errors...${NC}"
for app in "${!APP_PORTS[@]}"; do
  if [ "${RESULTS[$app]}" != "START_FAILED" ]; then
    container_name="${CONTAINER_PREFIX}-${app}"
    echo -e "${YELLOW}Checking $app logs:${NC}"
    if docker logs $container_name 2>&1 | grep -i "error\|exception\|failed" | head -5; then
      echo -e "${YELLOW}Found some errors in $app logs (this might be normal during startup)${NC}"
    fi
  fi
done

# Step 6: Test each endpoint
echo -e "${YELLOW}Testing application endpoints...${NC}"
for app in "${!APP_ENDPOINTS[@]}"; do
  if [ "${RESULTS[$app]}" == "START_FAILED" ]; then
    continue
  fi
  
  endpoint="${APP_ENDPOINTS[$app]}"
  echo -e "${YELLOW}Testing $app endpoint: $endpoint${NC}"
  
  if check_endpoint "$endpoint" "$app"; then
    RESULTS[$app]="SUCCESS"
  else
    RESULTS[$app]="FAILED"
  fi
done

# Step 7: Wait for all endpoints to be healthy (with retries)
if ! wait_for_endpoints $HEALTH_CHECK_TIMEOUT; then
  echo -e "${YELLOW}Initial health check failed, showing container logs:${NC}"
  for app in "${!APP_PORTS[@]}"; do
    if [ "${RESULTS[$app]}" != "START_FAILED" ]; then
      container_name="${CONTAINER_PREFIX}-${app}"
      echo -e "${YELLOW}=== $app logs (last 20 lines) ===${NC}"
      docker logs $container_name --tail 20
    fi
  done
  
  echo -e "${YELLOW}Retrying individual endpoint checks...${NC}"
  # Retry individual checks
  for app in "${!APP_ENDPOINTS[@]}"; do
    if [ "${RESULTS[$app]}" != "START_FAILED" ]; then
      endpoint="${APP_ENDPOINTS[$app]}"
      if check_endpoint "$endpoint" "$app"; then
        RESULTS[$app]="SUCCESS"
      else
        RESULTS[$app]="FAILED"
      fi
    fi
  done
fi

# Step 8: Print summary
echo -e "\n=== Test Summary ==="
all_success=true
for app in "${!APP_ENDPOINTS[@]}"; do
  status="${RESULTS[$app]}"
  endpoint="${APP_ENDPOINTS[$app]}"
  
  if [ "$status" == "SUCCESS" ]; then
    echo -e "${GREEN}✓ $app: Endpoint $endpoint is healthy${NC}"
  elif [ "$status" == "START_FAILED" ]; then
    echo -e "${RED}✗ $app: Failed to start container${NC}"
    all_success=false
  else
    echo -e "${RED}✗ $app: Endpoint $endpoint failed health check${NC}"
    all_success=false
  fi
done

# Show resource usage
echo -e "\n=== Container Resource Usage ==="
if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
  echo -e "${YELLOW}Container stats from docker compose:${NC}"
  docker compose -f "$TEMP_COMPOSE_FILE" ps
else
  for app in "${!APP_PORTS[@]}"; do
    container_name="${CONTAINER_PREFIX}-${app}"
    if docker ps -q -f name=$container_name | grep -q .; then
      docker stats $container_name --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    fi
  done
fi

# Final result
if $all_success; then
  echo -e "\n${GREEN}🎉 All endpoints are healthy! Split Docker images test passed.${NC}"
  exit 0
else
  echo -e "\n${RED}❌ Some endpoints failed health checks. Test failed.${NC}"
  if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
    echo -e "${YELLOW}Container logs from docker compose:${NC}"
    docker compose -f "$TEMP_COMPOSE_FILE" logs --tail 50
  fi
  exit 1
fi