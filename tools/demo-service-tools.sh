#!/bin/bash

# Demo script to quickly see all service status tools in action
# Run with: ./tools/demo-service-tools.sh

# Define colors for pretty output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Navigate to project root
cd "$(dirname "$0")/.."

clear

echo -e "${BOLD}${BLUE}==================================================${NC}"
echo -e "${BOLD}${BLUE}   DEGENDUEL SERVICE STATUS TOOLS DEMONSTRATION   ${NC}"
echo -e "${BOLD}${BLUE}==================================================${NC}\n"

# Show the simple shell script
echo -e "${BOLD}${CYAN}TOOL #1: SIMPLE SHELL SCRIPT${NC}"
echo -e "${YELLOW}Command: ./tools/show-services.sh${NC}"
echo -e "${YELLOW}Description: Raw PostgreSQL output of service status${NC}\n"
echo -e "${BOLD}Sample output:${NC}"
./tools/show-services.sh | head -6
echo -e "\n${BOLD}Run full version with:${NC} ${GREEN}./tools/show-services.sh${NC}"
echo -e "${BOLD}Show only active:${NC} ${GREEN}./tools/show-services.sh --active${NC}\n"

echo -e "Press Enter to continue..."
read

clear

# Show the fancy shell script
echo -e "${BOLD}${CYAN}TOOL #2: FANCY SHELL SCRIPT${NC}"
echo -e "${YELLOW}Command: ./tools/service-monitor.sh${NC}"
echo -e "${YELLOW}Description: Colorized, formatted service status with more options${NC}\n"
echo -e "${BOLD}Sample output:${NC}"
./tools/service-monitor.sh | head -10
echo -e "\n${BOLD}Available options:${NC}"
echo -e "  ${GREEN}./tools/service-monitor.sh --active${NC}        # Show only active services"
echo -e "  ${GREEN}./tools/service-monitor.sh --sort=name${NC}     # Sort by service name"
echo -e "  ${GREEN}./tools/service-monitor.sh --sort=status${NC}   # Sort by status"
echo -e "  ${GREEN}./tools/service-monitor.sh --json${NC}          # Output as JSON\n"

echo -e "Press Enter to continue..."
read

clear

# Show the JS command-line tool
echo -e "${BOLD}${CYAN}TOOL #3: JAVASCRIPT COMMAND-LINE TOOL${NC}"
echo -e "${YELLOW}Command: node tools/system-status/system-status.js${NC}"
echo -e "${YELLOW}Description: JS-based tool with system health checking${NC}\n"
echo -e "${BOLD}Sample output:${NC}"
node tools/system-status/system-status.js
echo -e "\n${BOLD}Available options:${NC}"
echo -e "  ${GREEN}node tools/system-status/system-status.js --json${NC}             # Output as JSON"
echo -e "  ${GREEN}node tools/system-status/system-status.js --stale-minutes 30${NC} # Set stale threshold"
echo -e "  ${GREEN}node tools/system-status/system-status.js --include-inactive${NC} # Include inactive services\n"

echo -e "Press Enter to continue..."
read

clear

# Explain the JS programmatic usage
echo -e "${BOLD}${CYAN}TOOL #4: JAVASCRIPT PROGRAMMATIC USAGE${NC}"
echo -e "${YELLOW}Usage: Import into your own code${NC}"
echo -e "${YELLOW}Description: For integrating service monitoring into other applications${NC}\n"

echo -e "${BOLD}Example code:${NC}"
echo -e "${GREEN}import { checkSystemStatus } from './tools/system-status/system-status.js';

async function monitorSystem() {
  const status = await checkSystemStatus();
  
  console.log(\`System status: \${status.isHealthy ? 'Healthy' : 'Issues found'}\`);
  console.log(\`Active services: \${status.activeCount}\`);
  console.log(\`Stale services: \${status.staleCount}\`);
  
  if (status.staleServices.length > 0) {
    console.log('Services that need attention:');
    status.staleServices.forEach(service => {
      console.log(\` - \${service.name} (last updated \${Math.round(service.minutes_ago)} minutes ago)\`);
    });
  }
}${NC}\n"

echo -e "${BOLD}${BLUE}==================================================${NC}"
echo -e "${BOLD}${BLUE}             DEMONSTRATION COMPLETE              ${NC}"
echo -e "${BOLD}${BLUE}==================================================${NC}\n"