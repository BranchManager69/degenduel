#!/bin/bash

# Config
API_URL="https://degenduel.me/api" # Base URL

# Log detail
LOG_REQUESTS_DURING_APITEST=false;
LOG_JSON_ERRORS_DURING_APITEST=false;
LOG_NON_JSON_ERRORS_DURING_APITEST=false;

# Test wallets
TEST_WALLET="BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
ADMIN_WALLET="BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get auth tokens at start
echo "Getting authentication tokens..."

# Debug auth request
echo "Attempting user auth for wallet: $TEST_WALLET"
AUTH_RESPONSE=$(curl -X POST "$API_URL/auth/connect" \
    -H "Content-Type: application/json" \
    -H "X-Wallet-Address: $TEST_WALLET" \
    -d "{\"wallet_address\":\"$TEST_WALLET\",\"message\":\"test\",\"signature\":\"test\"}" \
    -c /tmp/cookies.txt \
    -k -s)

# Check if auth was successful by looking for wallet_address in response
if [[ "$AUTH_RESPONSE" == *"$TEST_WALLET"* ]]; then
    echo -e "${GREEN}Successfully authenticated${NC}"
    SESSION_COOKIE=$(grep "session" /tmp/cookies.txt | cut -f7)
    echo "Session Cookie: $SESSION_COOKIE"
else
    echo -e "${RED}Failed to authenticate${NC}"
    echo "Response: $AUTH_RESPONSE"
    exit 1
fi

# Do the same for admin
echo "Attempting admin auth for wallet: $ADMIN_WALLET"
ADMIN_RESPONSE=$(curl -X POST "$API_URL/auth/connect" \
    -H "Content-Type: application/json" \
    -H "X-Wallet-Address: $ADMIN_WALLET" \
    -d "{\"wallet_address\":\"$ADMIN_WALLET\",\"message\":\"test\",\"signature\":\"test\"}" \
    -c /tmp/admin_cookies.txt \
    -k -s)

if [[ "$ADMIN_RESPONSE" == *"$ADMIN_WALLET"* ]]; then
    echo -e "${GREEN}Successfully authenticated as admin${NC}"
    ADMIN_COOKIE=$(grep "session" /tmp/admin_cookies.txt | cut -f7)
    echo "Admin Cookie: $ADMIN_COOKIE"
else
    echo -e "${RED}Failed to authenticate as admin${NC}"
    echo "Response: $ADMIN_RESPONSE"
    exit 1
fi

# Create results directory if it doesn't exist
mkdir -p tests/results

# Generate timestamp and filename
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="tests/results/api-test-$TIMESTAMP.log"

# Arrays to store results
declare -a PASSED_TESTS=()
declare -a FAILED_TESTS=()

# Arrays to track endpoint types
declare -a PUBLIC_TESTS=(
    "Health Check"
    "Get All Tokens"
    "Get Token Details"
    "Get Active Contests"
    "Get Contest Summary"
    "Get Global Leaderboard"
    "Get Token Leaderboard"
    "Get Historical Leaderboard"
)

declare -a PROTECTED_TESTS=(
    "Get User Profile"
    "Update Profile"
    "Update Settings"
    "Get User Stats"
    "Get Trading History"
    "Get Achievements"
    "Get Contest Portfolio"
    "Enter Contest"
    "Submit Trade"
    "Get Trades"
)

declare -a ADMIN_TESTS=(
    "Create Contest"
    "Delete Contest"
    "Update Contest"
    "Add Token"
    "Update Token Status"
    "Reset User Rank"
)

# Helper functions for different types of API calls

call_api_public() {
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

# API call functions to use cookies instead of tokens:

call_api_protected() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -n "$data" ]; then
        curl -X $method "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "X-Wallet-Address: $TEST_WALLET" \
            -b "session=$SESSION_COOKIE" \
            -d "$data" \
            -k -s
    else
        curl -X $method "$API_URL$endpoint" \
            -H "X-Wallet-Address: $TEST_WALLET" \
            -b "session=$SESSION_COOKIE" \
            -k -s
    fi
}

call_api_admin() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -n "$data" ]; then
        curl -X $method "$API_URL$endpoint" \
            -H "Content-Type: application/json" \
            -H "X-Wallet-Address: $ADMIN_WALLET" \
            -b "session=$ADMIN_COOKIE" \
            -d "$data" \
            -k -s
    else
        curl -X $method "$API_URL$endpoint" \
            -H "X-Wallet-Address: $ADMIN_WALLET" \
            -b "session=$ADMIN_COOKIE" \
            -k -s
    fi
}

# Create results directories if they don't exist
mkdir -p tests/results/json

# Generate filename for the report
OUTPUT_FILE="tests/results/api-test-report.log"

test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local auth_type=${5:-"protected"}
    
    local safe_name=$(echo "$name" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    local result_file="tests/results/json//$safe_name.json"
    
    # Terminal output
    printf "${YELLOW}%s${NC}\n" "$name"
    printf "  ${BLUE}→ %s ${CYAN}%s${NC}\n" "$method" "$endpoint"
    
    # Log file output
    printf "%s\n" "$name" >> "$OUTPUT_FILE"
    printf "  → %s %s\n" "$method" "$endpoint" >> "$OUTPUT_FILE"
    
    # If there's request data, log it
    if [ -n "$data" ] && [ "$LOG_REQUESTS_DURING_APITEST" = true ]; then
    ####if [ -n "$data" ]; then
        printf "  Request Body:\n" | tee -a "$OUTPUT_FILE"
        echo "$data" | jq '.' | sed 's/^/    /' | tee -a "$OUTPUT_FILE"
    fi
    
    # Capture both response and HTTP code
    local http_code
    local response
    
    case $auth_type in
        "public")
            response=$(curl -X $method "$API_URL$endpoint" \
                ${data:+-H "Content-Type: application/json" -d "$data"} \
                -w "\n%{http_code}" -k -s)
            ;;
        "protected")
            response=$(curl -X $method "$API_URL$endpoint" \
                -H "X-Wallet-Address: $TEST_WALLET" \
                -b "session=$SESSION_COOKIE" \
                ${data:+-H "Content-Type: application/json" -d "$data"} \
                -w "\n%{http_code}" -k -s)
            ;;
        "admin")
            response=$(curl -X $method "$API_URL$endpoint" \
                -H "X-Wallet-Address: $ADMIN_WALLET" \
                -b "session=$ADMIN_COOKIE" \
                ${data:+-H "Content-Type: application/json" -d "$data"} \
                -w "\n%{http_code}" -k -s)
            ;;
    esac
    
    # Split response and http_code
    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')
    
    # Enhanced error checking
    if [ -n "$response" ] && [ "$http_code" -lt 400 ] && [[ "$response" != *"error"* ]]; then
        # Success case
        printf "  ${GREEN}✓ Success${NC} (HTTP $http_code)\n"
        echo "Response:"
        echo "$response" | jq --color-output '.' | sed 's/^/  /'
        
        # Log file output
        printf "  ✓ Success (HTTP $http_code)\n" >> "$OUTPUT_FILE"
        echo "Response:" >> "$OUTPUT_FILE"
        echo "$response" | jq '.' | sed 's/^/  /' >> "$OUTPUT_FILE"
        
        echo "$response" | jq '.' > "$result_file"
        PASSED_TESTS+=("$name")
    else
        # Failure case with enhanced error details
        printf "  ${RED}✗ Failed${NC} (HTTP $http_code)\n"
        echo "  Error Details:"
        
        # Try to parse response as JSON
        if jq -e . >/dev/null 2>&1 <<<"$response"; then
            # Valid JSON response
            if [ "$LOG_JSON_ERRORS_DURING_APITEST" = true ]; then # only log if LOG_JSON_ERRORS_DURING_APITEST is true
                echo "  Type: JSON Error Response"
                echo "$response" | jq --color-output '.' | sed 's/^/    /'
            fi
        else
            # Non-JSON response
            if [ "$LOG_NON_JSON_ERRORS_DURING_APITEST" = true ]; then # only log if LOG_NON_JSON_ERRORS_DURING_APITEST is true
                echo "  Type: Non-JSON Response"
                echo "  Raw Response:"
                echo "$response" | sed 's/^/    /'
            fi
        fi
        
        # Additional error context
        case $http_code in
            400) echo "  Context: Bad Request - The request was malformed or missing required fields" ;;
            401) echo "  Context: Unauthorized - Authentication failed or token expired" ;;
            403) echo "  Context: Forbidden - The authenticated user lacks necessary permissions" ;;
            404) echo "  Context: Not Found - The requested resource doesn't exist" ;;
            405) echo "  Context: Method Not Allowed - The endpoint doesn't support this HTTP method" ;;
            409) echo "  Context: Conflict - The request conflicts with current state" ;;
            422) echo "  Context: Unprocessable Entity - Request was well-formed but has semantic errors" ;;
            500) echo "  Context: Internal Server Error - Something went wrong on the server" ;;
            502) echo "  Context: Bad Gateway - Invalid response from upstream server" ;;
            503) echo "  Context: Service Unavailable - Server is temporarily unavailable" ;;
            504) echo "  Context: Gateway Timeout - Upstream server did not respond in time" ;;
        esac
        
        # Log file output
        {
            printf "  ✗ Failed (HTTP $http_code)\n"
            echo "  Error Details:"
            if jq -e . >/dev/null 2>&1 <<<"$response"; then
                echo "  Type: JSON Error Response"
                echo "$response" | jq '.' | sed 's/^/    /'
            else
                echo "  Type: Non-JSON Response"
                echo "  Raw Response:"
                echo "$response" | sed 's/^/    /'
            fi
        } >> "$OUTPUT_FILE"
        
        # Save error details to JSON
        jq -n \
            --arg http_code "$http_code" \
            --arg raw_response "$response" \
            '{
                "error": true,
                "http_code": $http_code,
                "raw_response": $raw_response,
                "timestamp": (now | todate)
            }' > "$result_file"
        
        FAILED_TESTS+=("$name")
    fi
    
    printf "\n───────────────────────────────────────────────\n" | tee -a "$OUTPUT_FILE"
}

# Pretty header
printf "
🚀 ${CYAN}API Test Suite${NC}
══════════════════════════════════════════════════════════
" | tee "$OUTPUT_FILE"


### NEW: ###

# Public endpoints
test_endpoint "Health Check" "GET" "/test/health" "" "public"
test_endpoint "Get All Tokens" "GET" "/tokens" "" "public"
test_endpoint "Get Token Details" "GET" "/tokens/1" "" "public"
test_endpoint "Get Active Contests" "GET" "/contests/active" "" "public"
####test_endpoint "Get Contest Summary" "GET" "/contests/summary" "" "public"
####test_endpoint "Get Global Leaderboard" "GET" "/leaderboard" "" "public"
##test_endpoint "Get Token Leaderboard" "GET" "/leaderboard/token/1" "" "public"
####test_endpoint "Get Historical Leaderboard" "GET" "/leaderboard/history" "" "public"
sleep 0.5

# Protected endpoints (user)

test_endpoint "Get User Profile" "GET" "/users/$TEST_WALLET" "" "protected"

test_endpoint "Update Profile" "PUT" "/users/$TEST_WALLET" '{
    "nickname": "BranchManager",
    "settings": {
        "theme": "dark",
        "notifications": true
    },
    "kyc_status": "verified"
}' "protected"

test_endpoint "Update Settings" "PUT" "/users/$TEST_WALLET/settings" "{\"settings\":{\"theme\":\"dark\",\"notifications\":true}}" "protected"

test_endpoint "Get User Stats" "GET" "/stats/$TEST_WALLET" "" "protected"

# Trading History should be portfolio history based on your schema
####test_endpoint "Get Portfolio History" "GET" "/contests/3/portfolio/$TEST_WALLET/history" "" "protected"

test_endpoint "Get Achievements" "GET" "/stats/$TEST_WALLET/achievements" "" "protected"

# Portfolio endpoints look correct:
test_endpoint "Get Contest Portfolio" "GET" "/contests/2/portfolio?wallet=$TEST_WALLET" "" "protected"
test_endpoint "Update Portfolio" "PUT" "/contests/2/portfolio" '{
    "wallet": "'$TEST_WALLET'",
    "weights": [
        {"tokenId": 1, "weight": 67},
        {"tokenId": 2, "weight": 33}
    ]
}' "protected"
sleep 0.5

# Admin endpoints
# Create Contest should include all required fields from your schema

# test_endpoint "Create Contest" "POST" "/contests" '{
#     "name": "API Test Contest ID 4",
#     "contest_code": "TEST-004",
#     "description": "API Test Contest ID 4",
#     "start_time": "2024-12-28T00:00:00Z",
#     "end_time": "2024-12-30T00:00:00Z",
#     "entry_fee": 123,
#     "min_participants": 2,
#     "max_participants": 50,
#     "allowed_buckets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
#     "settings": {
#         "prize_distribution": [60, 30, 10]
#     }
# }' "admin"

test_endpoint "Enter Contest" "POST" "/contests/3/enter" '{
    "wallet": "'$TEST_WALLET'",
    "portfolio": {
        "weights": [
            {"tokenId": 1, "weight": 15},
            {"tokenId": 2, "weight": 85}
        ]
    }
}' "protected"
test_endpoint "Update Contest" "PATCH" "/contests/3" '{
    "status": "active",
    "current_prize_pool": 1000,
    "entry_deadline": "2024-12-27T00:00:00Z",
    "settings": {
        "prize_distribution": [60, 30, 10]
    }
}' "admin"  # Changed from "is_active" to "active" to match your contest_status enum and added more fields
####test_endpoint "Delete Contest" "DELETE" "/contests/3" "" "admin"

# Add Token should match your tokens table structure
#test_endpoint "Add Token" "POST" "/tokens" '{
#    "address": "9jaZhJM6nMHTo4hY9DGabQ1HNuUWhJtm7js1fmKMVpkN",
#    "symbol": "DEGENAI",
#    "name": "DegenSpartan AI",
#    "decimals": 8,
#    "is_active": true
#}' "admin"

# test_endpoint "Update Token Status" "PATCH" "/tokens/38" '{
#     "is_active": true,
#     "market_cap": 9999999,
#     "change_24h": 99,
#     "volume_24h": 99999999
# }' "admin"

test_endpoint "Reset User Rank" "POST" "/users/$TEST_WALLET/rank/reset" "" "admin"
sleep 0.5

# Pretty footer with summary
printf "\n══════════════════════════════════════════════\n"
printf "✨ ${YELLOW}API Tests Complete!${NC}\n\n"

# Function to display test result with details
display_test_result() {
    local test=$1
    local type=$2
    local safe_name=$(echo "$test" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
    local json_file="tests/results/json/$safe_name.json"
    
    if [[ " ${PASSED_TESTS[@]} " =~ " ${test} " ]]; then
        response_code=$(jq -r '.http_code // "200"' "$json_file" 2>/dev/null || echo "200")
        printf "\n  ${GREEN}✓ %s${NC} (HTTP ${response_code})" "$test"
        printf "\n    📄 %s" "$json_file"
    else
        response_code=$(jq -r '.http_code // "500"' "$json_file" 2>/dev/null || echo "500")
        error_msg=$(jq -r '.raw_response // empty' "$json_file" 2>/dev/null || echo "Unknown error")
        printf "\n  ${RED}✗ %s${NC} (HTTP ${response_code})" "$test"
        printf "\n    📄 %s" "$json_file"
        printf "\n    ${RED}Error:${NC} %s" "$error_msg"
        
        # For 400 errors, show the request payload if it exists
        if [[ "$response_code" == "400" ]]; then
            case "$test" in
                "Enter Contest")
                    printf "\n    ${YELLOW}Request:${NC}"
                    printf "\n      %s" "{\"wallet\":\"$TEST_WALLET\",\"initialPortfolio\":{\"tokens\":[{\"tokenId\":1,\"amount\":1000}]}}"
                    ;;
                "Submit Trade")
                    printf "\n    ${YELLOW}Request:${NC}"
                    printf "\n      %s" "{\"wallet\":\"$TEST_WALLET\",\"tokenId\":1,\"type\":\"BUY\",\"amount\":100}"
                    ;;
                "Create Contest")
                    printf "\n    ${YELLOW}Request:${NC}"
                    printf "\n      %s" "{\"name\":\"Test Contest\",\"startTime\":\"2024-12-20T00:00:00Z\",\"endTime\":\"2024-12-27T00:00:00Z\",\"entryFee\":100}"
                    ;;
            esac
        fi
        printf "\n"
    fi
}

# Display results by endpoint type
printf "${CYAN}Public Endpoints:${NC}"
for test in "${PUBLIC_TESTS[@]}"; do
    display_test_result "$test" "public"
done

printf "\n\n${CYAN}Protected Endpoints:${NC}"
for test in "${PROTECTED_TESTS[@]}"; do
    display_test_result "$test" "protected"
done

printf "\n\n${CYAN}Admin Endpoints:${NC}"
for test in "${ADMIN_TESTS[@]}"; do
    display_test_result "$test" "admin"
done

printf "

📊 Test Results:
      ${YELLOW}Total Tests:  $((${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}))${NC}
           ${GREEN}Passed:  ${#PASSED_TESTS[@]}${NC}   ${GREEN}$(( ${#PASSED_TESTS[@]} * 100 / (${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}) ))%%${NC}
           ${RED}Failed:  ${#FAILED_TESTS[@]}${NC}   ${RED}$(( ${#FAILED_TESTS[@]} * 100 / (${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}) ))%%${NC}

📝 More Details:
        ${YELLOW}$OUTPUT_FILE${NC}

══════════════════════════════════════════════════════════

" | tee -a "$OUTPUT_FILE"

# Add final statistics to log file
{
    echo "
SUMMARY BY ENDPOINT TYPE
-----------------------
Public Endpoints:    $(echo "${PUBLIC_TESTS[@]}" | wc -w)
Protected Endpoints: $(echo "${PROTECTED_TESTS[@]}" | wc -w)
Admin Endpoints:     $(echo "${ADMIN_TESTS[@]}" | wc -w)

RESULTS
-------
Total Tests: $((${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}))
Passed:      ${#PASSED_TESTS[@]}
Failed:      ${#FAILED_TESTS[@]}
Success Rate: $(( ${#PASSED_TESTS[@]} * 100 / (${#PASSED_TESTS[@]} + ${#FAILED_TESTS[@]}) ))%
"
} >> "$OUTPUT_FILE"