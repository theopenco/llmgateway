#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Array of apps to test
APPS=("api" "gateway" "playground" "ui" "docs")

# Ports for each app
declare -A APP_PORTS
APP_PORTS["api"]=4002
APP_PORTS["gateway"]=4001
APP_PORTS["ui"]=3002
APP_PORTS["playground"]=3003
APP_PORTS["docs"]=3005

# Health check routes for each app (optional)
declare -A HEALTH_ROUTES
HEALTH_ROUTES["docs"]="/v1_chat_completions"
# Add more health check routes for other apps as needed
# HEALTH_ROUTES["api"]="/health"
# HEALTH_ROUTES["gateway"]="/health"

rm -rf dist/

# Array to store PIDs of started processes
declare -a PIDS

# Function to clean up processes on exit
cleanup() {
  echo -e "${YELLOW}Cleaning up processes...${NC}"
  for pid in "${PIDS[@]}"; do
    if ps -p $pid > /dev/null; then
      echo "Killing process $pid"
      kill $pid 2>/dev/null || true
    fi
  done
  echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap to ensure cleanup on script exit
trap cleanup EXIT

# Function to check if a port is in use
is_port_in_use() {
  local port=$1
  if command -v curl &> /dev/null; then
    curl -s --fail http://localhost:$port &> /dev/null
    return $?
  elif command -v nc &> /dev/null; then
    nc -z localhost $port &> /dev/null
    return $?
  else
    # Fallback to a basic check using /dev/tcp
    (echo > /dev/tcp/localhost/$port) &> /dev/null
    return $?
  fi
}

# Function to perform health check on a specific route
perform_health_check() {
  local port=$1
  local route=$2
  local app=$3

  if command -v curl &> /dev/null; then
    echo -e "${YELLOW}Performing health check for $app at http://localhost:$port$route...${NC}"
    response_code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$port$route)
    if [ "$response_code" == "200" ]; then
      echo -e "${GREEN}Health check passed for $app (HTTP 200)${NC}"
      return 0
    else
      echo -e "${RED}Health check failed for $app (HTTP $response_code)${NC}"
      return 1
    fi
  else
    echo -e "${YELLOW}curl not available, skipping health check for $app${NC}"
    return 0
  fi
}

# Function to wait for a port to be listening
wait_for_port() {
  local port=$1
  local app=$2
  local timeout=60
  local count=0

  echo -e "${YELLOW}Waiting for $app to start on port $port...${NC}"

  # Wait for the port to become active
  while true; do
    if is_port_in_use $port; then
      echo -e "${GREEN}$app is running on port $port${NC}"

      # Perform health check if a route is defined for this app
      if [ -n "${HEALTH_ROUTES[$app]}" ]; then
        # Give the app a moment to fully initialize
        sleep 2
        if perform_health_check $port "${HEALTH_ROUTES[$app]}" $app; then
          return 0
        else
          return 1
        fi
      else
        return 0
      fi
    fi

    sleep 1
    count=$((count + 1))
    if [ $count -ge $timeout ]; then
      echo -e "${RED}Timeout waiting for $app to start on port $port${NC}"
      return 1
    fi
  done
}

# Results tracking
declare -A RESULTS

echo "=== LLMGateway Apps Smoke Test ==="
echo "This script will test if all apps can be built, deployed, and started."

# Step 1: Build all apps (optional, as it's already done in the GitHub workflow)
if [ "$1" == "--with-build" ]; then
  echo -e "${YELLOW}Building all apps...${NC}"
  pnpm build
  if [ $? -ne 0 ]; then
    echo -e "${RED}Build failed${NC}"
    exit 1
  fi
  echo -e "${GREEN}Build completed successfully${NC}"
fi

# Step 2: Deploy each app to its respective dist directory
echo -e "${YELLOW}Deploying apps to dist directories...${NC}"
for app in "${APPS[@]}"; do
  echo -e "${YELLOW}Deploying $app...${NC}"
  pnpm --filter=$app --prod deploy --legacy dist/$app
  if [ $? -ne 0 ]; then
    echo -e "${RED}Deployment of $app failed${NC}"
    RESULTS[$app]="DEPLOY_FAILED"
    continue
  fi
  echo -e "${GREEN}Deployment of $app completed successfully${NC}"
  RESULTS[$app]="DEPLOY_SUCCESS"
done

# Step 3: Start each app and verify it's running
echo -e "${YELLOW}Starting apps and verifying they're running...${NC}"
for app in "${APPS[@]}"; do
  if [ "${RESULTS[$app]}" != "DEPLOY_SUCCESS" ]; then
    echo -e "${YELLOW}Skipping $app as deployment failed${NC}"
    continue
  fi

  port=${APP_PORTS[$app]}

  # Check if port is already in use
  if is_port_in_use $port; then
    echo -e "${RED}Port $port is already in use. Cannot start $app.${NC}"
    RESULTS[$app]="PORT_IN_USE"
    continue
  fi

  echo -e "${YELLOW}Starting $app on port $port...${NC}"

  # Change to the app's dist directory, build it, and start it
  cd dist/$app
  PORT="${APP_PORTS[$app]}" pnpm start &
  app_pid=$!
  PIDS+=($app_pid)
  cd ../..

  # Wait for the app to start
  if wait_for_port $port $app; then
    RESULTS[$app]="START_SUCCESS"
  else
    RESULTS[$app]="START_FAILED"
  fi
done

# Step 4: Print summary
echo -e "\n=== Summary ==="
all_success=true
for app in "${APPS[@]}"; do
  status="${RESULTS[$app]}"
  if [ "$status" == "START_SUCCESS" ]; then
    echo -e "${GREEN}$app: Successfully deployed and started${NC}"
  elif [ "$status" == "DEPLOY_SUCCESS" ]; then
    echo -e "${YELLOW}$app: Deployed successfully but failed to start${NC}"
    all_success=false
  elif [ "$status" == "PORT_IN_USE" ]; then
    echo -e "${YELLOW}$app: Port ${APP_PORTS[$app]} already in use${NC}"
    all_success=false
  else
    echo -e "${RED}$app: Failed to deploy${NC}"
    all_success=false
  fi
done

# Final result
if $all_success; then
  echo -e "\n${GREEN}All apps were successfully deployed and started!${NC}"
  exit 0
else
  echo -e "\n${RED}Some apps failed to deploy or start. Check the summary above.${NC}"
  exit 1
fi
