#!/bin/bash

# Colors for pretty output
PURPLE='\033[0;35m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Timestamp for the output file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_FILE="logs/wss_report_${TIMESTAMP}.log"

echo -e "${PURPLE}${BOLD}DegenDuel WebSocket Log Aggregator${NC}"
echo -e "${BLUE}Gathering logs from the last 5 minutes...${NC}\n"

# Create logs directory if it doesn't exist
mkdir -p logs

# Initialize the output file with a header
cat << EOF > "$OUTPUT_FILE"
==========================================================
DegenDuel WebSocket Activity Report
Generated: $(date)
Timeframe: Last 5 minutes
==========================================================

EOF

# Function to process and extract recent logs
process_log() {
    local file=$1
    local file_name=$(basename "$file")
    
    if [ -f "$file" ]; then
        # Get logs from last 5 minutes
        recent_logs=$(find "$file" -mmin -5 -type f -exec grep -H "." {} \;)
        if [ ! -z "$recent_logs" ]; then
            echo -e "\n--- $file_name ---\n" >> "$OUTPUT_FILE"
            echo "$recent_logs" >> "$OUTPUT_FILE"
            echo -e "${GREEN}✓${NC} Processed $file_name"
            return 0
        else
            echo -e "${BLUE}ℹ${NC} No recent activity in $file_name"
            return 1
        fi
    fi
}

# Process nginx WebSocket logs
echo -e "\n${PURPLE}${BOLD}Processing NGINX WebSocket Logs:${NC}"
for log_file in logs/nginx_logs/websocket-*.log; do
    process_log "$log_file"
done

# Process nginx general logs
echo -e "\n${PURPLE}${BOLD}Processing NGINX General Logs:${NC}"
process_log "logs/nginx_logs/dd-nginx-access.log"
process_log "logs/nginx_logs/dd-nginx-error.log"

# Add summary section
echo -e "\n==========================================================\nSUMMARY\n==========================================================" >> "$OUTPUT_FILE"

# Count WebSocket connections
ws_connections=$(grep -c "GET /api/v69/ws/" "$OUTPUT_FILE" 2>/dev/null || echo "0")
ws_errors=$(grep -c "400\|500\|error" "$OUTPUT_FILE" 2>/dev/null || echo "0")

echo -e "\nTotal WebSocket Connections: $ws_connections" >> "$OUTPUT_FILE"
echo -e "Total WebSocket Errors: $ws_errors" >> "$OUTPUT_FILE"

# Make the script executable
chmod +x "$0"

echo -e "\n${GREEN}${BOLD}Report generated:${NC} $OUTPUT_FILE"
echo -e "${BLUE}Use 'cat $OUTPUT_FILE' to view the report${NC}" 