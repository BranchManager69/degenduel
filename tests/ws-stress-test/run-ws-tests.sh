#!/bin/bash

# Script to run WebSocket stress tests with different configurations

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}DegenDuel WebSocket Stress Test Runner${NC}"
echo "====================================="

# Make sure script is executable
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
chmod +x "${SCRIPT_DIR}/ws-stress-test.js"

# Function to run a test with a specific configuration
run_test() {
  local name=$1
  shift
  
  echo -e "\n${YELLOW}Running test: ${name}${NC}"
  echo "Parameters: $@"
  echo "Starting at $(date)"
  
  node "${SCRIPT_DIR}/ws-stress-test.js" "$@"
  
  echo -e "${GREEN}Test complete: ${name}${NC}"
  echo "Finished at $(date)"
  echo "====================================="
}

# Test 1: Baseline - Low load test
run_test "Baseline Test" \
  --connections 20 \
  --duration 30 \
  --connectRate 2 \
  --disconnectRate 1 \
  --subscribeRate 3 \
  --authRate 1 \
  --chaosMode false \
  --logLevel info

# Test 2: Connection Flood - Rapid connections and disconnections
run_test "Connection Flood Test" \
  --connections 50 \
  --duration 45 \
  --connectRate 10 \
  --disconnectRate 8 \
  --subscribeRate 5 \
  --authRate 2 \
  --chaosMode false \
  --logLevel info

# Test 3: Auth Stress - High authentication rate
run_test "Auth Stress Test" \
  --connections 30 \
  --duration 45 \
  --connectRate 3 \
  --disconnectRate 2 \
  --subscribeRate 5 \
  --authRate 10 \
  --authPercent 70 \
  --chaosMode false \
  --logLevel info

# Test 4: Page Refresh Simulation - Frequent reconnections of same "user"
run_test "Page Refresh Test" \
  --connections 25 \
  --duration 60 \
  --connectRate 3 \
  --disconnectRate 2 \
  --subscribeRate 5 \
  --authRate 3 \
  --forceRefresh true \
  --refreshRate 5 \
  --chaosMode false \
  --logLevel info

# Test 5: Chaos Mode - Unpredictable behavior including invalid messages
run_test "Chaos Test" \
  --connections 40 \
  --duration 60 \
  --connectRate 8 \
  --disconnectRate 7 \
  --subscribeRate 15 \
  --authRate 5 \
  --chaosMode true \
  --logLevel info

echo -e "${GREEN}All tests completed${NC}"
echo "Check the logs directory for detailed results"