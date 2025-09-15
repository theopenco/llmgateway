#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="llmgateway-unified-test"
IMAGE_NAME="${1:-ghcr.io/terragonlabs/llmgateway-unified:latest}"
STARTUP_TIMEOUT=120

# Array of apps and their expected endpoints
declare -A APP_ENDPOINTS
APP_ENDPOINTS["api"]="http://localhost:4002/"
APP_ENDPOINTS["gateway"]="http://localhost:4001/" 
APP_ENDPOINTS["ui"]="http://localhost:3002"
APP_ENDPOINTS["docs"]="http://localhost:3005"

# Array to store test results
declare -A RESULTS

# Function to clean up container on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
  if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
    echo "Stopping docker compose services"
    docker compose -f "$TEMP_COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
    rm -f "$TEMP_COMPOSE_FILE"
  fi
  # Fallback: direct container cleanup
  if docker ps -q -f name=$CONTAINER_NAME | grep -q .; then
    echo "Stopping and removing container $CONTAINER_NAME"
    docker stop $CONTAINER_NAME >/dev/null 2>&1 || true
    docker rm $CONTAINER_NAME >/dev/null 2>&1 || true
  fi
  echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap to ensure cleanup on script exit
trap cleanup EXIT

# Function to check if container is running
is_container_running() {
  docker ps -q -f name=$CONTAINER_NAME | grep -q .
}

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

echo "=== LLMGateway Unified Docker Image Test ==="
echo "Testing unified Docker image: $IMAGE_NAME"

# Step 1: Create temporary docker compose file
TEMP_COMPOSE_FILE=$(mktemp -t docker-compose-test-XXXX.yml)
echo -e "${YELLOW}Creating temporary docker compose file: $TEMP_COMPOSE_FILE${NC}"

cat > "$TEMP_COMPOSE_FILE" << EOF
name: llmgateway-unified-test

services:
  llmgateway:
    image: $IMAGE_NAME
    container_name: $CONTAINER_NAME
    ports:
      - "3002:3002" # UI
      - "3005:3005" # Docs
      - "4001:4001" # Gateway
      - "4002:4002" # API
      - "5432:5432" # PostgreSQL
      - "6379:6379" # Redis
    environment:
      - NODE_ENV=production
      - UI_URL=http://localhost:3002
      - API_URL=http://localhost:4002
      - ORIGIN_URL=http://localhost:3002
      - DOCS_URL=http://localhost:3005
      - COOKIE_DOMAIN=localhost
      - PASSKEY_RP_ID=localhost
      - PASSKEY_RP_NAME=LLMGateway
      - AUTH_SECRET=test-secret-key-for-docker-testing
EOF

# Step 2: Verify local image exists
echo -e "${YELLOW}Using locally built image: $IMAGE_NAME${NC}"
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo -e "${RED}Local image not found: $IMAGE_NAME${NC}"
  echo -e "${YELLOW}Make sure to build the image first before running this test${NC}"
  exit 1
fi
echo -e "${GREEN}Local image verified${NC}"

# Step 3: Stop any existing compose services
echo -e "${YELLOW}Stopping any existing services...${NC}"
docker compose -f "$TEMP_COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true

# Step 4: Start the services using docker compose
echo -e "${YELLOW}Starting unified Docker services...${NC}"
if ! docker compose -f "$TEMP_COMPOSE_FILE" up -d; then
  echo -e "${RED}Failed to start services${NC}"
  exit 1
fi

echo -e "${GREEN}Services started successfully${NC}"

# Step 5: Wait for container to be running and services to initialize
echo -e "${YELLOW}Waiting for container to be running...${NC}"
timeout_count=0
max_timeout=$((STARTUP_TIMEOUT / 5))

while [ $timeout_count -lt $max_timeout ]; do
  if docker compose -f "$TEMP_COMPOSE_FILE" ps | grep -q "Up"; then
    echo -e "${GREEN}Container is running${NC}"
    break
  fi
  
  echo -e "${YELLOW}Waiting for container to start... (${timeout_count}/${max_timeout})${NC}"
  sleep 5
  timeout_count=$((timeout_count + 1))
  
  if [ $timeout_count -ge $max_timeout ]; then
    echo -e "${RED}Container failed to start within ${STARTUP_TIMEOUT}s${NC}"
    docker compose -f "$TEMP_COMPOSE_FILE" logs --tail 50
    exit 1
  fi
done

# Give additional time for all services to initialize internally
echo -e "${YELLOW}Waiting additional time for all services to initialize...${NC}"
sleep 30

# Step 5: Check container logs for any immediate errors
echo -e "${YELLOW}Checking container logs for errors...${NC}"
if docker logs $CONTAINER_NAME 2>&1 | grep -i "error\|exception\|failed" | head -10; then
  echo -e "${YELLOW}Found some errors in logs (this might be normal during startup)${NC}"
fi

# Step 6: Test each endpoint
echo -e "${YELLOW}Testing application endpoints...${NC}"
for app in "${!APP_ENDPOINTS[@]}"; do
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
  docker logs $CONTAINER_NAME --tail 50
  echo -e "${YELLOW}Retrying individual endpoint checks...${NC}"
  
  # Retry individual checks
  for app in "${!APP_ENDPOINTS[@]}"; do
    endpoint="${APP_ENDPOINTS[$app]}"
    if check_endpoint "$endpoint" "$app"; then
      RESULTS[$app]="SUCCESS"
    else
      RESULTS[$app]="FAILED"
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
  else
    echo -e "${RED}✗ $app: Endpoint $endpoint failed health check${NC}"
    all_success=false
  fi
done

# Show resource usage
echo -e "\n=== Container Resource Usage ==="
docker stats $CONTAINER_NAME --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

# Final result
if $all_success; then
  echo -e "\n${GREEN}🎉 All endpoints are healthy! Unified Docker image test passed.${NC}"
  exit 0
else
  echo -e "\n${RED}❌ Some endpoints failed health checks. Test failed.${NC}"
  echo -e "${YELLOW}Container logs (last 100 lines):${NC}"
  if [ -n "$TEMP_COMPOSE_FILE" ] && [ -f "$TEMP_COMPOSE_FILE" ]; then
    docker compose -f "$TEMP_COMPOSE_FILE" logs --tail 100
  else
    docker logs $CONTAINER_NAME --tail 100
  fi
  exit 1
fi