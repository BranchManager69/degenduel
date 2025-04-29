#!/bin/bash

# service-monitor.sh - Simple utility to monitor DegenDuel service status
# Usage: ./tools/service-monitor.sh [--json|--active|--minutes|--sort=name]

# Define colors for pretty output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Change to project directory
cd "$(dirname "$0")/.."

# Create temporary SQL script
SQL_FILE=$(mktemp)
cat > "$SQL_FILE" << 'EOF'
SELECT 
  key, 
  value->>'status' as status, 
  CASE 
    WHEN value->>'status' = 'active' THEN '${GREEN}● ACTIVE${NC}'
    WHEN value->>'status' = 'stopped' THEN '${RED}■ STOPPED${NC}'
    WHEN value->>'status' IS NULL THEN '${BLUE}✦ CONFIG${NC}'
    ELSE '${YELLOW}▲ ' || COALESCE(UPPER(value->>'status'), 'UNKNOWN') || '${NC}'
  END as status_formatted,
  updated_at,
  EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_ago
FROM system_settings 
ORDER BY updated_at DESC;
EOF

# Define sort function
sort_by_name() {
  sort -k2
}

sort_by_status() {
  sort -k3
}

# Parse command line arguments
SHOW_JSON=0
SHOW_ACTIVE_ONLY=0
SHOW_MINUTES=1
SORT_BY="time"  # Default sort by time

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    --json)
      SHOW_JSON=1
      shift
      ;;
    --active)
      SHOW_ACTIVE_ONLY=1
      shift
      ;;
    --minutes)
      SHOW_MINUTES=1
      shift
      ;;
    --sort=name)
      SORT_BY="name"
      shift
      ;;
    --sort=status)
      SORT_BY="status"
      shift
      ;;
    --help)
      echo -e "${BOLD}${CYAN}DegenDuel Service Monitor${NC}"
      echo -e "Displays the status of all DegenDuel services from system_settings"
      echo -e ""
      echo -e "${BOLD}Usage:${NC}"
      echo -e "  ./tools/service-monitor.sh [options]"
      echo -e ""
      echo -e "${BOLD}Options:${NC}"
      echo -e "  --json         Output in JSON format"
      echo -e "  --active       Show only active services"
      echo -e "  --minutes      Show time in minutes ago (default)"
      echo -e "  --sort=name    Sort by service name"
      echo -e "  --sort=status  Sort by service status"
      echo -e "  --help         Show this help message"
      echo -e ""
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo -e "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Modify SQL query if showing only active services
if [ $SHOW_ACTIVE_ONLY -eq 1 ]; then
  sed -i "s/FROM system_settings/FROM system_settings WHERE value->>'status' = 'active'/" "$SQL_FILE"
fi

# Run the SQL query
if [ $SHOW_JSON -eq 1 ]; then
  # JSON output mode
  psql -U branchmanager -h localhost -d degenduel -c "
    SELECT 
      key as service, 
      value->>'status' as status,
      value->>'running' as running,
      updated_at,
      EXTRACT(EPOCH FROM (NOW() - updated_at))/60 as minutes_ago
    FROM system_settings
    $([ $SHOW_ACTIVE_ONLY -eq 1 ] && echo "WHERE value->>'status' = 'active'")
    ORDER BY $([ "$SORT_BY" = "name" ] && echo "key" || [ "$SORT_BY" = "status" ] && echo "status" || echo "updated_at DESC")
  " -t -A -F "," | python3 -c '
import sys
import json
from datetime import datetime

lines = [line.strip() for line in sys.stdin if line.strip()]
services = []

for line in lines:
    parts = line.split(",")
    if len(parts) >= 5:
        service, status, running, updated_at, minutes_ago = parts[0:5]
        services.append({
            "service": service,
            "status": status,
            "running": running == "true" if running else None,
            "updated_at": updated_at,
            "minutes_ago": float(minutes_ago) if minutes_ago else 0
        })

print(json.dumps(services, indent=2))
'
else
  # Regular output mode - table format
  echo -e "${BOLD}${CYAN}DegenDuel Service Status${NC}"
  echo -e "${GRAY}Generated: $(date)${NC}\n"
  
  # Create header
  printf "${BOLD}%-3s %-40s %-15s %-25s${NC}\n" "#" "SERVICE" "STATUS" "LAST UPDATE"
  echo "------------------------------------------------------------------------------------------------------"
  
  # Run the query and format output
  RESULTS=$(psql -U branchmanager -h localhost -d degenduel -f "$SQL_FILE" -t | sed 's/|//g')
  
  # Sort if needed
  if [ "$SORT_BY" = "name" ]; then
    RESULTS=$(echo "$RESULTS" | sort_by_name)
  elif [ "$SORT_BY" = "status" ]; then
    RESULTS=$(echo "$RESULTS" | sort_by_status)
  fi
  
  # Display results with numbers
  COUNT=1
  while read -r line; do
    # Extract fields
    SERVICE=$(echo "$line" | awk '{print $1}')
    STATUS=$(echo "$line" | awk '{print $2}')
    STATUS_FORMATTED=$(echo "$line" | awk '{print $3}' | sed "s/\${GREEN}/$GREEN/g; s/\${RED}/$RED/g; s/\${BLUE}/$BLUE/g; s/\${YELLOW}/$YELLOW/g; s/\${NC}/$NC/g")
    UPDATED_AT=$(echo "$line" | awk '{print $4 " " $5}')
    MINUTES_AGO=$(echo "$line" | awk '{print $6}' | sed 's/\..*$//')
    
    # Format time ago
    if [ $SHOW_MINUTES -eq 1 ]; then
      # Make sure MINUTES_AGO is a valid integer
      if [[ "$MINUTES_AGO" =~ ^[0-9]+$ ]]; then
        if [ $MINUTES_AGO -lt 60 ]; then
          TIME_AGO="${MINUTES_AGO} minutes ago"
        elif [ $MINUTES_AGO -lt 1440 ]; then
          HOURS=$(( MINUTES_AGO / 60 ))
          TIME_AGO="${HOURS} hours ago"
        else
          DAYS=$(( MINUTES_AGO / 1440 ))
          TIME_AGO="${DAYS} days ago"
        fi
      else
        # Handle non-integer values
        TIME_AGO="recently"
      fi
    else
      TIME_AGO="$UPDATED_AT"
    fi
    
    # Print formatted line
    printf "${BOLD}%3d${NC} ${CYAN}%-40s${NC} %-30s ${GRAY}%s${NC}\n" "$COUNT" "$SERVICE" "$STATUS_FORMATTED" "$TIME_AGO"
    
    COUNT=$((COUNT+1))
  done <<< "$RESULTS"
  
  echo -e "\n${BOLD}Total:${NC} $((COUNT-1)) services"
  
  if [ $SHOW_ACTIVE_ONLY -eq 1 ]; then
    echo -e "${GRAY}(Showing only active services)${NC}"
  fi
fi

# Clean up
rm "$SQL_FILE"