#!/bin/bash
# Combined Performance and Stress Test Runner for DegenDuel
# This script runs all benchmark and stress tests in sequence and
# generates a combined report

# Color helpers
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Check if running as part of npm script
REPORT_DIR="performance_reports/$(date +%Y-%m-%d_%H-%M-%S)"
QUIET=0
QUICK=0

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --quiet)
      QUIET=1
      shift
      ;;
    --quick)
      QUICK=1
      shift
      ;;
    --report-dir=*)
      REPORT_DIR="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Create report directory
mkdir -p "$REPORT_DIR"

# Start time
START_TIME=$(date +%s)

# Print header
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${BLUE}${BOLD}  DEGENDUEL PERFORMANCE TEST SUITE       ${RESET}"
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${CYAN}Started at: $(date)${RESET}"
echo -e "${CYAN}Report directory: ${REPORT_DIR}${RESET}"
echo

# Function to run a test and record output
run_test() {
  local name="$1"
  local command="$2"
  local output_file="${REPORT_DIR}/${name}.log"
  
  echo -e "${YELLOW}${BOLD}Running test: ${name}${RESET}"
  if [ $QUIET -eq 1 ]; then
    eval "$command" > "$output_file" 2>&1
  else
    eval "$command" | tee "$output_file"
  fi
  
  if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo -e "${GREEN}✓ Test completed successfully${RESET}"
  else
    echo -e "${RED}✗ Test failed${RESET}"
  fi
  echo -e "${CYAN}Output saved to: ${output_file}${RESET}"
  echo
}

# Run HTTP RPC benchmark
run_test "solana_rpc_benchmark" "python3 tests/solana_rpc_benchmark_enhanced.py --export=${REPORT_DIR}/rpc_results.json"

# Run WebSocket RPC benchmark
run_test "solana_ws_benchmark" "python3 tests/solana_ws_benchmark.py --simple"

# If not in quick mode, run more extensive stress tests
if [ $QUICK -eq 0 ]; then
  # Run WebSocket stress tests
  run_test "ws_stress_baseline" "node tests/ws-stress-test/ws-stress-test.js --connections 20 --duration 30 --connectRate 2 --logLevel info --logToFile true"
  
  run_test "ws_stress_flood" "node tests/ws-stress-test/ws-stress-test.js --connections 50 --duration 30 --connectRate 10 --disconnectRate 8 --logLevel info --logToFile true"
else
  # Run a single quick stress test in quick mode
  run_test "ws_stress_quick" "node tests/ws-stress-test/ws-stress-test.js --connections 10 --duration 15 --logLevel info --logToFile true"
fi

# Create summary report
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

cat > "${REPORT_DIR}/summary.md" << EOF
# DegenDuel Performance Test Summary
**Date:** $(date)
**Duration:** ${DURATION} seconds

## Tests Executed
- Solana RPC HTTP Benchmark
- Solana WebSocket Benchmark
$([ $QUICK -eq 0 ] && echo "- WebSocket Stress Test - Baseline
- WebSocket Stress Test - Connection Flood" || echo "- WebSocket Stress Test - Quick Mode")

## Results
See individual log files for detailed results.

### RPC Benchmark
The RPC benchmark results are available in JSON format at \`rpc_results.json\`.

### Next Steps
- Review WebSocket stress test logs for connection issues
- Compare RPC provider performance metrics
- Check for any identified bottlenecks
EOF

echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${BLUE}${BOLD}  TEST SUITE COMPLETE                    ${RESET}"
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${CYAN}Total duration: ${DURATION} seconds${RESET}"
echo -e "${CYAN}Summary report: ${REPORT_DIR}/summary.md${RESET}"
echo

# Make suggestions based on test results
echo -e "${YELLOW}${BOLD}Suggestions:${RESET}"
echo -e "${YELLOW}1. Review the RPC benchmark results to identify the fastest provider${RESET}"
echo -e "${YELLOW}2. Check WebSocket stress test logs for any connection failures${RESET}"
echo -e "${YELLOW}3. Consider adding the fastest RPC endpoint to your connection manager${RESET}"
echo