#!/bin/bash
# Combined Performance and Stress Test Runner for DegenDuel
# This script runs all benchmark and stress tests in sequence and
# generates a combined report
# Updated 2025-04-05 with improved benchmark methods and Branch RPC support

# Color helpers
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Create a timestamped report directory
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="performance_reports/benchmark_results/${TIMESTAMP}"
BENCHMARK_DIR="benchmark_results"
QUIET=0
QUICK=0
SKIP_STRESS_TESTS=0

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
    --skip-stress)
      SKIP_STRESS_TESTS=1
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

# Create report directories
mkdir -p "$REPORT_DIR"
mkdir -p "$BENCHMARK_DIR"

# Start time
START_TIME=$(date +%s)

# Print fancy header
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${BLUE}${BOLD}  DEGENDUEL PERFORMANCE TEST SUITE       ${RESET}"
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${CYAN}Started at: $(date)${RESET}"
echo -e "${CYAN}Report directory: ${REPORT_DIR}${RESET}"
echo -e "${CYAN}Benchmark directory: ${BENCHMARK_DIR}${RESET}"
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

# Create RPC benchmark filename with timestamp
RPC_RESULTS="${BENCHMARK_DIR}/rpc_benchmark_${TIMESTAMP}.json"
WS_RESULTS="${BENCHMARK_DIR}/ws_benchmark_${TIMESTAMP}.json"

# Run HTTP RPC benchmark (with Branch RPC enabled)
echo -e "${YELLOW}${BOLD}Running HTTP RPC benchmarks with Branch RPC enabled${RESET}"
run_test "solana_rpc_benchmark" "python3 tests/solana_rpc_benchmark_enhanced.py --export=${RPC_RESULTS} --enable-branch"

# Run WebSocket RPC benchmark (with Branch RPC enabled and results export)
echo -e "${YELLOW}${BOLD}Running WebSocket RPC benchmarks with Branch RPC enabled${RESET}"
run_test "solana_ws_benchmark" "python3 tests/solana_ws_benchmark.py --export=${WS_RESULTS} --enable-branch"

# Copy results to report directory for consistency
cp ${RPC_RESULTS} ${REPORT_DIR}/
cp ${WS_RESULTS} ${REPORT_DIR}/

# Skip stress tests if requested
if [ $SKIP_STRESS_TESTS -eq 1 ]; then
  echo -e "${YELLOW}${BOLD}Skipping WebSocket stress tests (--skip-stress flag used)${RESET}"
# If not in quick mode, run more extensive stress tests
elif [ $QUICK -eq 0 ]; then
  echo -e "${YELLOW}${BOLD}Running full WebSocket stress test suite${RESET}"
  # Run WebSocket stress tests
  run_test "ws_stress_baseline" "node tests/ws-stress-test/ws-stress-test.js --connections 20 --duration 30 --connectRate 2 --logLevel info --logToFile true --outputDir=${REPORT_DIR}"
  
  run_test "ws_stress_flood" "node tests/ws-stress-test/ws-stress-test.js --connections 50 --duration 30 --connectRate 10 --disconnectRate 8 --logLevel info --logToFile true --outputDir=${REPORT_DIR}"
  
  # Run authentication stress test
  run_test "ws_auth_stress" "node tests/ws-stress-test/ws-stress-test.js --connections 30 --duration 20 --authPercent 80 --authRate 5 --logLevel info --logToFile true --outputDir=${REPORT_DIR}"
else
  echo -e "${YELLOW}${BOLD}Running quick WebSocket stress test${RESET}"
  # Run a single quick stress test in quick mode
  run_test "ws_stress_quick" "node tests/ws-stress-test/ws-stress-test.js --connections 10 --duration 15 --logLevel info --logToFile true --outputDir=${REPORT_DIR}"
fi

# Create summary report
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

cat > "${REPORT_DIR}/summary.md" << EOF
# DegenDuel Performance Test Summary
**Date:** $(date)
**Duration:** ${DURATION} seconds
**Timestamp:** ${TIMESTAMP}

## Tests Executed
- Solana RPC HTTP Benchmark (with Branch RPC)
- Solana WebSocket Benchmark (with Branch RPC)
$([ $SKIP_STRESS_TESTS -eq 1 ] && echo "- WebSocket Stress Tests skipped" || ([ $QUICK -eq 0 ] && echo "- WebSocket Stress Test - Baseline (20 connections)
- WebSocket Stress Test - Connection Flood (50 connections)
- WebSocket Stress Test - Authentication (30 connections)" || echo "- WebSocket Stress Test - Quick Mode (10 connections)"))

## Results
Benchmark results are saved in two locations:
- Report directory: \`${REPORT_DIR}/\`
- Benchmark directory: \`${BENCHMARK_DIR}/\`

### RPC Benchmark Results
The HTTP RPC benchmark results are available in JSON format:
- \`${RPC_RESULTS}\`
- \`${REPORT_DIR}/$(basename ${RPC_RESULTS})\` (copy)

This benchmark compares Helius, Official Solana, QuikNode, and Branch RPC endpoints using standard RPC methods.

### WebSocket Benchmark Results
The WebSocket RPC benchmark results are available in JSON format:
- \`${WS_RESULTS}\`
- \`${REPORT_DIR}/$(basename ${WS_RESULTS})\` (copy)

This benchmark tests WebSocket performance using:
- getVersion 
- getAccountInfo (SOL token)
- getAccountInfo (Pumpswap AMM)
- getRecentBlockhash

$([ $SKIP_STRESS_TESTS -eq 1 ] || echo "### WebSocket Stress Test Results
WebSocket stress test logs are available in the report directory.")

### Analysis
- Branch RPC was included in all benchmarks for comparison
- Relative performance scaling was used to accurately visualize results
- All results use consistent methodology and can be compared over time

### Next Steps
- Review WebSocket stress test logs for connection issues
- Compare RPC provider performance metrics
- Analyze Branch RPC performance relative to other providers
- Check for any identified bottlenecks
EOF

echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${BLUE}${BOLD}  TEST SUITE COMPLETE                    ${RESET}"
echo -e "${BLUE}${BOLD}==========================================${RESET}"
echo -e "${CYAN}Total duration: ${DURATION} seconds${RESET}"
echo -e "${CYAN}Summary report: ${REPORT_DIR}/summary.md${RESET}"
echo
echo -e "${CYAN}RPC results: ${RPC_RESULTS}${RESET}"
echo -e "${CYAN}WebSocket results: ${WS_RESULTS}${RESET}"
echo

# Make suggestions based on test results
echo -e "${YELLOW}${BOLD}Next Steps:${RESET}"
echo -e "${YELLOW}1. Review the RPC benchmark results to identify the fastest provider${RESET}"
echo -e "${YELLOW}2. Compare HTTP vs WebSocket performance for the same endpoints${RESET}"
echo -e "${YELLOW}3. Analyze Branch RPC performance compared to other providers${RESET}"
echo -e "${YELLOW}4. Check for any connection failures in the stress test logs${RESET}"
echo -e "${YELLOW}5. Run 'npm run benchmarks' option 5 for quick follow-up comparisons${RESET}"
echo

# Display file paths for easier access
echo -e "${BLUE}${BOLD}Quick Access Commands:${RESET}"
echo -e "${CYAN}cat ${REPORT_DIR}/summary.md # View summary report${RESET}"
echo -e "${CYAN}less ${RPC_RESULTS} # View HTTP RPC benchmark results${RESET}"
echo -e "${CYAN}less ${WS_RESULTS} # View WebSocket benchmark results${RESET}"
echo