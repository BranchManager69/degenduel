#!/bin/bash

# ✨ DegenDuel Fund Consolidation Script ✨
# This is a wrapper script that provides a confirmation step before running the fund consolidation

# ANSI color codes for enhanced visuals
BOLD="\033[1m"
RESET="\033[0m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
GREEN="\033[1;32m"
BLUE="\033[1;34m"
CYAN="\033[0;36m"
MAGENTA="\033[1;35m"
BG_MAGENTA="\033[45m"
BG_BLUE="\033[44m"
BG_RED="\033[41m"
BG_GREEN="\033[42m"
WHITE="\033[1;37m"
UNDERLINE="\033[4m"

# Unicode symbols
WALLET="💰"
WARNING="⚠️"
CHECK="✅"
CROSS="❌"
MONEY="💸"
STATS="📊"
REFRESH="🔄"
INFO="ℹ️"

# Moving to the project root directory
cd "$(dirname "$0")/../.." || exit 1

# Header with colorful title
echo ""
echo -e "${BG_MAGENTA}${WHITE}                                                        ${RESET}"
echo -e "${BG_MAGENTA}${WHITE}   ${WALLET}  DegenDuel Fund Consolidation Wizard  ${WALLET}   ${RESET}"
echo -e "${BG_MAGENTA}${WHITE}                                                        ${RESET}"
echo ""

# Warning with attention-grabbing colors
echo -e "${BG_RED}${WHITE} ${WARNING}  WARNING  ${WARNING} ${RESET}"
echo -e "${RED}This script will transfer funds from all eligible wallets to the treasury!${RESET}"
echo ""

# Info section with cyan color
echo -e "${CYAN}${INFO} First, let's check eligible wallets:${RESET}"
echo ""

# Running audit with progress indicator
echo -e "${BG_BLUE}${WHITE} ${REFRESH} Running wallet audit... ${RESET}"
npm run mm:audit

# Final confirmation with bright colors and emojis
echo ""
echo -e "${BG_RED}${WHITE} ${WARNING}  IMPORTANT: Are you sure you want to proceed with fund consolidation? ${WARNING} ${RESET}"
read -p "$(echo -e ${BOLD}${YELLOW}"Type 'YES' to confirm (anything else cancels): "${RESET})" confirm

if [ "$confirm" = "YES" ]; then
    echo ""
    echo -e "${BG_GREEN}${WHITE} ${MONEY} Proceeding with fund consolidation... ${RESET}"
    npm run mm:consolidate
else
    echo ""
    echo -e "${BG_BLUE}${WHITE} ${CROSS} Operation cancelled. No funds were transferred. ${RESET}"
    exit 0
fi