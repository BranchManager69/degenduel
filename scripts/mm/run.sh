#!/bin/bash

# DegenDuel Fund Consolidation Script
# This is a simple wrapper script that provides a confirmation step before running the fund consolidation

cd "$(dirname "$0")/../.." || exit 1

echo -e "\033[1;33m=== DegenDuel Fund Consolidation ===\033[0m"
echo -e "\033[1;31mWARNING: This script will transfer funds from all eligible wallets to the treasury!\033[0m"
echo -e "\033[0;36mFirst, let's check eligible wallets:\033[0m"
echo ""
echo -e "\033[1;34mRunning wallet audit...\033[0m"
npm run mm:audit

echo ""
echo -e "\033[1;31m   IMPORTANT: Are you sure you want to proceed with fund consolidation?  \033[0m"
read -p "Type 'YES' to confirm (anything else cancels): " confirm

if [ "$confirm" = "YES" ]; then
    echo ""
    echo -e "\033[1;34mProceeding with fund consolidation...\033[0m"
    npm run mm:consolidate
else
    echo ""
    echo -e "\033[1;33mOperation cancelled. No funds were transferred.\033[0m"
    exit 0
fi