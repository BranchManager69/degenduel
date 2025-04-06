#!/bin/bash
# Simple runner script for Pump.fun bundler tests

cd /home/websites/degenduel 
echo "=== Running Pump.fun bundler test ==="

# Default to 'simulate' if no mode provided
MODE=${1:-simulate}

echo "Mode: $MODE"

# Run test with specified mode
node blockchain/pump-bundler/test.js $MODE