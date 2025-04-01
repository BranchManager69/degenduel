# WebSocket Stress Testing Tools

These tools help identify and reproduce WebSocket connection issues, particularly focused on the "missing clientInfo" problem we've observed in production.

## Quick NPM Commands

Run these commands from the project root:

```bash
# Basic stress test with default settings
npm run stresstest

# Run all predefined test scenarios
npm run stresstest:all

# Specific test scenarios
npm run stresstest:baseline   # Low-intensity baseline test
npm run stresstest:flood      # Connection flood test
npm run stresstest:auth       # Authentication stress test
npm run stresstest:refresh    # Page refresh simulation test
npm run stresstest:chaos      # Chaos test with unpredictable behavior

# Custom test with additional parameters
npm run stresstest -- --connections 100 --duration 90 --forceRefresh true
```

## Overview

The stress testing framework creates multiple WebSocket connections with different patterns to test server robustness:
- Connection floods (many rapid connections)
- Authentication stressing
- Simulated page refreshes
- Subscription overloading
- Chaos testing (unpredictable behavior)

## Scripts Included

1. **ws-stress-test.js** - Main stress testing script
2. **run-ws-tests.sh** - Helper script to run multiple test scenarios

## Quick Start

```bash
# Make sure scripts are executable
chmod +x tests/ws-stress-test/run-ws-tests.sh

# Run all test scenarios
cd tests/ws-stress-test
./run-ws-tests.sh

# Or run a single test with custom parameters
node ws-stress-test.js --connections 100 --duration 60 --forceRefresh true
```

## Configuration Options

| Parameter       | Description                                       | Default |
|-----------------|---------------------------------------------------|---------|
| connections     | Number of concurrent connections to maintain      | 50      |
| duration        | Test duration in seconds                          | 60      |
| connectRate     | New connections per second                        | 5       |
| disconnectRate  | Disconnections per second                         | 5       |
| subscribeRate   | Subscription operations per second                | 10      |
| authRate        | Authentication operations per second              | 3       |
| chaosMode       | Random unpredictable behavior                     | false   |
| logLevel        | Verbosity: 'debug', 'info', 'warn', 'error'       | 'info'  |
| logToFile       | Whether to log to a file                          | true    |
| authPercent     | Percent of connections that will authenticate     | 30      |
| forceRefresh    | Whether to force page "refreshes"                 | false   |
| refreshRate     | "Page refreshes" per second                       | 2       |

## Test Scenarios in run-ws-tests.sh

1. **Baseline Test** - Low-intensity test to establish a baseline
2. **Connection Flood Test** - High rate of connections/disconnections
3. **Auth Stress Test** - High rate of authentication attempts
4. **Page Refresh Test** - Simulates frequent page refreshes (disconnect + reconnect)
5. **Chaos Test** - Unpredictable behavior including invalid messages

## Example Custom Test

```bash
# Custom focused test to reproduce specific issue
cd tests/ws-stress-test
node ws-stress-test.js \
  --connections 25 \
  --duration 120 \
  --connectRate 3 \
  --subscribeRate 2 \
  --forceRefresh true \
  --refreshRate 8 \
  --logLevel debug
```

## Understanding Results

The test produces logs in the `logs/stress-tests/` directory with detailed information about each test run. Review these logs for:

1. Connection success/failure rates
2. Error types and frequency
3. Connection state issues
4. Missing clientInfo occurrences (look for "CRITICAL STATE ERROR" messages)

## Interpreting Connection State Errors

When a `connection_state_invalid` error (code 4050) occurs, it indicates the WebSocket connection lost its state information. The logs will provide details on:

- Timing between connection and error
- Client operations before the error
- Whether a "page refresh" preceded the error

These patterns can help identify the root cause of connection state issues.