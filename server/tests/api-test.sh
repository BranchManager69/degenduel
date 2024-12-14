#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Base URL
API_URL="https://beta.branch.bet/api"
TEST_WALLET="0xTestWallet789"

# Helper function for making requests
call_api() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -n "$data" ]; then
        curl -X $method "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -d "$data" \
            -k -s
    else
        curl -X $method "$API_URL$endpoint" -k -s
    fi
}

# Test function
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -n "Testing $name... "
    response=$(call_api "$method" "$endpoint" "$data")
    
    if [ -n "$response" ] && [[ "$response" != *"error"* ]]; then
        echo -e "${GREEN}OK${NC}"
        echo "Response: $response"
    else
        echo -e "${RED}FAILED${NC}"
        echo "Error: $response"
    fi
    echo "----------------------------------------"
}

echo "🚀 Starting API Tests..."
echo "=========================================="

# Auth Tests
test_endpoint "Wallet Connect" "POST" "/auth/connect" "{\"wallet\":\"$TEST_WALLET\"}"
test_endpoint "Verify Wallet" "POST" "/auth/verify-wallet" "{\"wallet\":\"$TEST_WALLET\",\"message\":\"test\",\"signature\":\"test\"}"

# User Tests
test_endpoint "Get User" "GET" "/users/$TEST_WALLET"
test_endpoint "Update Profile" "PUT" "/users/$TEST_WALLET" "{\"nickname\":\"TestUser789\"}"
test_endpoint "Update Settings" "PUT" "/users/$TEST_WALLET/settings" "{\"settings\":{\"theme\":\"dark\",\"notifications\":true}}"

# Contest Tests
test_endpoint "Get Active Contests" "GET" "/contests/active?wallet=$TEST_WALLET"
test_endpoint "Create Test Contest" "POST" "/contests" "{\"name\":\"Test Contest\",\"start_time\":\"2024-12-20T00:00:00Z\",\"end_time\":\"2024-12-27T00:00:00Z\"}"
test_endpoint "Get Contest Details" "GET" "/contests/1"
test_endpoint "Enter Contest" "POST" "/contests/1/enter" "{\"wallet\":\"$TEST_WALLET\"}"
test_endpoint "Get Leaderboard" "GET" "/contests/1/leaderboard"

# Trade Tests
test_endpoint "Submit Trade" "POST" "/trades/1" "{\"wallet\":\"$TEST_WALLET\",\"token_id\":1,\"type\":\"BUY\",\"amount\":100}"
test_endpoint "Get Trades" "GET" "/trades/1?wallet=$TEST_WALLET"

# Stats Tests
test_endpoint "Get User Stats" "GET" "/stats/$TEST_WALLET"
test_endpoint "Get Trading History" "GET" "/stats/$TEST_WALLET/history"
test_endpoint "Get Achievements" "GET" "/stats/$TEST_WALLET/achievements"

echo "=========================================="
echo "🏁 API Tests Complete!"