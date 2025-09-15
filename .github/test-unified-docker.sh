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
HEALTH_CHECK_TIMEOUT=60

# Array of apps and their expected endpoints
declare -A APP_ENDPOINTS
APP_ENDPOINTS["api"]="http://localhost:4002/health"
APP_ENDPOINTS["gateway"]="http://localhost:4001/health" 
APP_ENDPOINTS["ui"]="http://localhost:3002"
APP_ENDPOINTS["docs"]="http://localhost:3005"

# Array to store test results
declare -A RESULTS

# Function to clean up container on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
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

# Step 1: Pull the image
echo -e "${YELLOW}Pulling Docker image...${NC}"
if ! docker pull "$IMAGE_NAME"; then
  echo -e "${RED}Failed to pull image: $IMAGE_NAME${NC}"
  exit 1
fi
echo -e "${GREEN}Image pulled successfully${NC}"

# Step 2: Stop and remove any existing container
if docker ps -a -q -f name=$CONTAINER_NAME | grep -q .; then
  echo -e "${YELLOW}Removing existing container...${NC}"
  docker stop $CONTAINER_NAME >/dev/null 2>&1 || true
  docker rm $CONTAINER_NAME >/dev/null 2>&1 || true
fi

# Step 3: Start the container
echo -e "${YELLOW}Starting unified Docker container...${NC}"
if ! docker run -d \
  --name $CONTAINER_NAME \
  -p 3002:3002 \
  -p 3005:3005 \
  -p 4001:4001 \
  -p 4002:4002 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://postgres:password@host.docker.internal:5432/llmgateway" \
  -e REDIS_URL="redis://host.docker.internal:6379" \
  -e NEXTAUTH_SECRET="test-secret-key-for-docker-testing" \
  -e NEXTAUTH_URL="http://localhost:3002" \
  "$IMAGE_NAME"; then
  echo -e "${RED}Failed to start container${NC}"
  exit 1
fi

echo -e "${GREEN}Container started successfully${NC}"

# Step 4: Wait for container to be running
echo -e "${YELLOW}Waiting for container to be fully running...${NC}"
sleep_count=0
while [ $sleep_count -lt $STARTUP_TIMEOUT ]; do
  if is_container_running; then
    echo -e "${GREEN}Container is running${NC}"
    break
  fi
  
  if [ $sleep_count -ge $STARTUP_TIMEOUT ]; then
    echo -e "${RED}Container failed to start within ${STARTUP_TIMEOUT}s${NC}"
    docker logs $CONTAINER_NAME
    exit 1
  fi
  
  sleep 2
  sleep_count=$((sleep_count + 2))
done

# Give additional time for services to initialize
echo -e "${YELLOW}Waiting additional time for services to initialize...${NC}"
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
  docker logs $CONTAINER_NAME --tail 100
  exit 1
fi