#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_PREFIX="${1:-ghcr.io/terragonlabs/llmgateway}"
IMAGE_TAG="${2:-latest}"
STARTUP_TIMEOUT=120

# Array of apps and their endpoints for testing
declare -A APP_ENDPOINTS
APP_ENDPOINTS["api"]="http://localhost:4002"
APP_ENDPOINTS["gateway"]="http://localhost:4001"
APP_ENDPOINTS["ui"]="http://localhost:3002"
APP_ENDPOINTS["playground"]="http://localhost:3003"
APP_ENDPOINTS["docs"]="http://localhost:3005"

# Health check routes for each app (optional)
declare -A HEALTH_ROUTES
HEALTH_ROUTES["docs"]="/v1_chat_completions"
# Add more health check routes for other apps as needed
# HEALTH_ROUTES["api"]="/health"
# HEALTH_ROUTES["gateway"]="/health"

# Array to store test results
declare -A RESULTS

# Function to clean up on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
  if [ -n "$TEMP_OVERRIDE_FILE" ] && [ -f "$TEMP_OVERRIDE_FILE" ]; then
    echo "Stopping docker compose services"
    docker compose -f infra/docker-compose.split.local.yml -f "$TEMP_OVERRIDE_FILE" down --remove-orphans >/dev/null 2>&1 || true
    rm -f "$TEMP_OVERRIDE_FILE"
  fi
  echo -e "${GREEN}Cleanup complete${NC}"
}

trap cleanup EXIT

# Function to log container logs
log_container_logs() {
  local service_name="$1"
  local lines="${2:-50}"

  echo -e "${RED}=== Logs for $service_name (last $lines lines) ===${NC}"
  docker compose -f infra/docker-compose.split.local.yml -f "$TEMP_OVERRIDE_FILE" logs --tail="$lines" "$service_name" 2>&1 || echo "Failed to retrieve logs for $service_name"
  echo -e "${RED}=== End logs for $service_name ===${NC}"
  echo
}

# Function to perform health check on a specific route
perform_health_check() {
  local endpoint="$1"
  local route="$2"
  local app="$3"

  local full_url="${endpoint}${route}"
  echo -e "${YELLOW}Performing health check for $app at $full_url...${NC}"

  local response_code=$(curl -s -o /dev/null -w "%{http_code}" "$full_url" || echo "000")

  if [ "$response_code" = "200" ]; then
    echo -e "${GREEN}✓ Health check passed for $app (HTTP 200)${NC}"
    return 0
  else
    echo -e "${RED}✗ Health check failed for $app (HTTP $response_code)${NC}"
    log_container_logs "$app"
    log_container_logs "postgres"
    log_container_logs "redis"
    return 1
  fi
}

# Function to wait for service health
wait_for_service() {
  local service_name="$1"
  local endpoint="$2"
  local timeout="$3"

  echo -e "${YELLOW}Waiting for $service_name to be healthy...${NC}"

  local count=0
  local max_attempts=$((timeout / 5))

  while [ $count -lt $max_attempts ]; do
    if curl -f -s "$endpoint" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ $service_name is healthy${NC}"

      # Perform health check if a route is defined for this app
      if [ -n "${HEALTH_ROUTES[$service_name]}" ]; then
        # Give the app a moment to fully initialize
        sleep 2
        if perform_health_check "$endpoint" "${HEALTH_ROUTES[$service_name]}" "$service_name"; then
          return 0
        else
          return 1
        fi
      else
        return 0
      fi
    fi

    echo "Waiting for $service_name... (attempt $((count + 1))/$max_attempts)"
    sleep 5
    count=$((count + 1))
  done

  echo -e "${RED}✗ $service_name failed to become healthy within $timeout seconds${NC}"
  log_container_logs "$service_name"
  log_container_logs "postgres"
  log_container_logs "redis"
  return 1
}

# Function to test service endpoint
test_service() {
  local app="$1"
  local endpoint="$2"

  echo -e "${YELLOW}Testing $app endpoint: $endpoint${NC}"

  # Test endpoint
  local response_code=$(curl -s -o /dev/null -w "%{http_code}" "$endpoint" || echo "000")

  if [ "$response_code" = "200" ] || [ "$response_code" = "301" ] || [ "$response_code" = "302" ]; then
    echo -e "${GREEN}✓ $app endpoint test passed (HTTP $response_code)${NC}"
    RESULTS["$app"]="PASS"
    return 0
  else
    echo -e "${RED}✗ $app endpoint test failed (HTTP $response_code)${NC}"
    RESULTS["$app"]="FAIL"
    return 1
  fi
}

echo -e "${YELLOW}Starting Split Docker Image Tests${NC}"
echo "Using images with prefix: $IMAGE_PREFIX and tag: $IMAGE_TAG"
echo

# Create temporary override file to use pre-built images instead of building
TEMP_OVERRIDE_FILE=$(mktemp docker-compose-override-XXXX.yml)

cat > "$TEMP_OVERRIDE_FILE" << EOF
services:
  api:
    image: $IMAGE_PREFIX-api:$IMAGE_TAG
    build: null

  gateway:
    image: $IMAGE_PREFIX-gateway:$IMAGE_TAG
    build: null

  ui:
    image: $IMAGE_PREFIX-ui:$IMAGE_TAG
    build: null

  playground:
    image: $IMAGE_PREFIX-playground:$IMAGE_TAG
    build: null

  docs:
    image: $IMAGE_PREFIX-docs:$IMAGE_TAG
    build: null
EOF

echo -e "${YELLOW}Starting services using docker-compose...${NC}"

# Start services using existing compose file with image overrides
docker compose -f infra/docker-compose.split.local.yml -f "$TEMP_OVERRIDE_FILE" up -d

echo -e "${YELLOW}Waiting for all services to be ready...${NC}"

# Wait for each service to be healthy
overall_success=true
for app in "${!APP_ENDPOINTS[@]}"; do
  endpoint="${APP_ENDPOINTS[$app]}"
  if ! wait_for_service "$app" "$endpoint" 60; then
    overall_success=false
  fi
done

echo
echo -e "${YELLOW}Running endpoint tests...${NC}"

# Test each service endpoint
for app in "${!APP_ENDPOINTS[@]}"; do
  endpoint="${APP_ENDPOINTS[$app]}"
  if ! test_service "$app" "$endpoint"; then
    overall_success=false
  fi
done

echo
echo "=== Test Results ==="
total_tests=${#APP_ENDPOINTS[@]}
passed_tests=0

for app in "${!RESULTS[@]}"; do
  status="${RESULTS[$app]}"
  if [ "$status" = "PASS" ]; then
    echo -e "${GREEN}✓ $app: $status${NC}"
    passed_tests=$((passed_tests + 1))
  else
    echo -e "${RED}✗ $app: $status${NC}"
  fi
done

echo
echo "Summary: $passed_tests/$total_tests tests passed"

if [ "$overall_success" = true ]; then
  echo -e "${GREEN}🎉 All split Docker image tests passed!${NC}"
  exit 0
else
  echo -e "${RED}💥 Some split Docker image tests failed${NC}"
  exit 1
fi
