#!/bin/bash

# System Status Report Generator
# ------------------------------
# This script runs both service status and database comparison reports sequentially
# with proper error handling and a clean, consistent output format.

# Define colors for pretty output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Define styled message prefixes
SUCCESS_PREFIX="${BOLD}${GREEN}✓${NC}"
ERROR_PREFIX="${BOLD}${RED}✗${NC}"
WARNING_PREFIX="${BOLD}${YELLOW}⚠${NC}"
INFO_PREFIX="${BOLD}${BLUE}ℹ${NC}"

# Get current date and time for report paths
CURRENT_DATE=$(date +%Y-%m-%d)
CURRENT_TIME=$(date +%H-%M-%S)
SERVICE_REPORT_DIR="reports/service-reports/$CURRENT_DATE/run_$CURRENT_TIME"
DB_REPORT_DIR="reports/db_comparisons/$CURRENT_DATE/run_$CURRENT_TIME"

# Create a trap to handle script interruption
cleanup() {
    echo -e "\n${ERROR_PREFIX} ${RED}Script interrupted by user.${NC}"
    exit 1
}
trap cleanup SIGINT SIGTERM

# Show header
show_header() {
    echo -e "\n${BOLD}${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}             DegenDuel System Status Reports              ${NC}"
    echo -e "${BOLD}${BLUE}════════════════════════════════════════════════════════════${NC}\n"
    echo -e "${INFO_PREFIX} ${BOLD}Started:${NC} $(date)"
    echo -e "${INFO_PREFIX} ${BOLD}Environment:${NC} $([ -f .env ] && grep "NODE_ENV" .env | cut -d= -f2 || echo "Not specified")"
    echo -e ""
}

# Function to run service status report
run_service_report() {
    echo -e "${BOLD}${CYAN}=== Running Service Status Report ===${NC}\n"
    
    # Run the service status report script
    node scripts/service-status-report.js
    
    # Check if the script ran successfully
    if [ $? -eq 0 ]; then
        echo -e "\n${SUCCESS_PREFIX} ${GREEN}Service status report completed successfully${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Reports saved to:${NC} ${WHITE}$SERVICE_REPORT_DIR${NC}"
        return 0
    else
        echo -e "\n${ERROR_PREFIX} ${RED}Service status report failed${NC}"
        return 1
    fi
}

# Function to run database comparison report
run_db_comparison() {
    echo -e "\n${BOLD}${CYAN}=== Running Database Comparison Report ===${NC}\n"
    
    # Run the database comparison script
    ./scripts/db-tools.sh compare
    
    # Check if the script ran successfully
    if [ $? -eq 0 ]; then
        echo -e "\n${SUCCESS_PREFIX} ${GREEN}Database comparison report completed successfully${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Reports saved to:${NC} ${WHITE}$DB_REPORT_DIR${NC}"
        return 0
    else
        echo -e "\n${ERROR_PREFIX} ${RED}Database comparison report failed${NC}"
        return 1
    fi
}

# Function to show summary
show_summary() {
    local service_success=$1
    local db_success=$2
    
    echo -e "\n${BOLD}${BLUE}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${BLUE}                   Summary Report                      ${NC}"
    echo -e "${BOLD}${BLUE}════════════════════════════════════════════════════════════${NC}\n"
    
    echo -e "${BOLD}Service Status Report:${NC} $([ $service_success -eq 0 ] && echo "${GREEN}Success${NC}" || echo "${RED}Failed${NC}")"
    echo -e "${BOLD}Database Comparison:${NC}  $([ $db_success -eq 0 ] && echo "${GREEN}Success${NC}" || echo "${RED}Failed${NC}")"
    
    echo -e "\n${BOLD}Report Locations:${NC}"
    
    if [ $service_success -eq 0 ]; then
        echo -e "  ${SUCCESS_PREFIX} ${CYAN}Service reports:${NC} ${WHITE}$SERVICE_REPORT_DIR/${NC}"
    fi
    
    if [ $db_success -eq 0 ]; then
        echo -e "  ${SUCCESS_PREFIX} ${CYAN}Database reports:${NC} ${WHITE}$DB_REPORT_DIR/${NC}"
    fi
    
    # Show completion time and total duration
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))
    
    echo -e "\n${INFO_PREFIX} ${BOLD}Completed:${NC} $(date)"
    echo -e "${INFO_PREFIX} ${BOLD}Duration:${NC} ${MINUTES}m ${SECONDS}s"
    
    # Overall status
    if [ $service_success -eq 0 ] && [ $db_success -eq 0 ]; then
        echo -e "\n${SUCCESS_PREFIX} ${BOLD}${GREEN}All system status reports completed successfully!${NC}\n"
        return 0
    else
        echo -e "\n${WARNING_PREFIX} ${BOLD}${YELLOW}Some reports failed. Please check the output above for details.${NC}\n"
        return 1
    fi
}

# Function to print clickable report directory paths
print_report_paths() {
    # Get the absolute paths to the report directories
    SERVICE_REPORT_DIR_ABS=$(realpath "$SERVICE_REPORT_DIR")
    DB_REPORT_DIR_ABS=$(realpath "$DB_REPORT_DIR")
    
    echo -e "\n${BOLD}${CYAN}=== Clickable Report Paths ===${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Service reports:${NC} ${BOLD}${WHITE}file://$SERVICE_REPORT_DIR_ABS${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Database reports:${NC} ${BOLD}${WHITE}file://$DB_REPORT_DIR_ABS${NC}"
    echo -e ""
    echo -e "${INFO_PREFIX} ${YELLOW}Click on the paths above to open directly in your file manager/IDE${NC}"
}

# Parse command line arguments
AI_ANALYSIS=false

while [[ $# -gt 0 ]]; do
    key="$1"
    case $key in
        --ai)
            AI_ANALYSIS=true
            shift
            ;;
        --help)
            echo -e "${BOLD}${BLUE}DegenDuel System Status Reports${NC}"
            echo -e "${BOLD}Usage:${NC} $0 [options]"
            echo -e ""
            echo -e "${BOLD}Options:${NC}"
            echo -e "  --ai        Run AI analysis on database comparison report"
            echo -e "  --help      Show this help message"
            exit 0
            ;;
        *)
            # Unknown option
            echo -e "${ERROR_PREFIX} ${RED}Unknown option: $1${NC}"
            echo -e "${INFO_PREFIX} ${YELLOW}Use --help for usage information${NC}"
            exit 1
            ;;
    esac
done

# Record start time
START_TIME=$(date +%s)

# Begin execution
show_header

# Run service status report
run_service_report
SERVICE_SUCCESS=$?

# Run database comparison with optional AI analysis
if [ "$AI_ANALYSIS" = true ]; then
    echo -e "\n${BOLD}${CYAN}=== Running Database Comparison Report with AI Analysis ===${NC}\n"
    ./scripts/db-tools.sh compare --ai-analysis
else
    run_db_comparison
fi
DB_SUCCESS=$?

# Show summary
show_summary $SERVICE_SUCCESS $DB_SUCCESS
OVERALL_SUCCESS=$?

# Always print clickable paths if reports were generated successfully
if [ $OVERALL_SUCCESS -eq 0 ]; then
    print_report_paths
fi

exit $OVERALL_SUCCESS