#!/bin/bash

# DegenDuel Database Quick Summary
# A simple shell script for generating a quick database overview

# Configuration
DB_URL=${DATABASE_URL:-"postgresql://branchmanager:servN!ck1003@localhost:5432/degenduel"}
REPORT_DATE=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_FILE="./reports/db-summary-$REPORT_DATE.txt"

# Create reports directory if it doesn't exist
mkdir -p ./reports

# Start report
echo "# DegenDuel Database Quick Summary - $REPORT_DATE" > $REPORT_FILE
echo "===================================================" >> $REPORT_FILE

# Database overview section
echo -e "\n## DATABASE OVERVIEW" >> $REPORT_FILE
echo "Table count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'" >> $REPORT_FILE

# Users section
echo -e "\n## USERS" >> $REPORT_FILE
echo "User count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM users" >> $REPORT_FILE
echo "User roles:" >> $REPORT_FILE
psql $DB_URL -c "SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY COUNT(*) DESC" >> $REPORT_FILE

# Tokens section
echo -e "\n## TOKENS" >> $REPORT_FILE
echo "Token count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM tokens" >> $REPORT_FILE
echo "Active tokens:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM tokens WHERE is_active = true" >> $REPORT_FILE
echo "Token refresh priority tiers:" >> $REPORT_FILE
psql $DB_URL -c "SELECT name, priority_score, refresh_interval_seconds FROM token_refresh_priority_tiers ORDER BY priority_score DESC" >> $REPORT_FILE

# Contests section
echo -e "\n## CONTESTS" >> $REPORT_FILE
echo "Contest count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM contests" >> $REPORT_FILE
echo "Contests by status:" >> $REPORT_FILE
psql $DB_URL -c "SELECT status, COUNT(*) FROM contests GROUP BY status" >> $REPORT_FILE
echo "Recent contests:" >> $REPORT_FILE
psql $DB_URL -c "SELECT contest_code, name, status, start_time, end_time FROM contests ORDER BY created_at DESC LIMIT 5" >> $REPORT_FILE

# Services section
echo -e "\n## SERVICES" >> $REPORT_FILE
echo "Service logs count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM service_logs" >> $REPORT_FILE
echo "Top services by log count:" >> $REPORT_FILE
psql $DB_URL -c "SELECT service, COUNT(*) FROM service_logs GROUP BY service ORDER BY COUNT(*) DESC LIMIT 10" >> $REPORT_FILE
echo "Recent service logs:" >> $REPORT_FILE
psql $DB_URL -c "SELECT service, level, substring(message, 1, 50) as message_preview, created_at FROM service_logs ORDER BY created_at DESC LIMIT 5" >> $REPORT_FILE

# WebSocket section
echo -e "\n## WEBSOCKET SYSTEM" >> $REPORT_FILE
echo "WebSocket connections:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM websocket_connections" >> $REPORT_FILE
echo "WebSocket messages:" >> $REPORT_FILE
psql $DB_URL -c "SELECT COUNT(*) FROM websocket_messages" >> $REPORT_FILE

# Database size
echo -e "\n## DATABASE SIZE" >> $REPORT_FILE
psql $DB_URL -c "SELECT pg_size_pretty(pg_database_size(current_database())) as db_size" >> $REPORT_FILE

# Largest tables
echo -e "\n## LARGEST TABLES" >> $REPORT_FILE
psql $DB_URL -c "SELECT relname as table_name, n_live_tup as row_count FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10" >> $REPORT_FILE

# Recent migrations
echo -e "\n## RECENT MIGRATIONS" >> $REPORT_FILE
psql $DB_URL -c "SELECT migration_name, applied_at FROM _prisma_migrations ORDER BY applied_at DESC LIMIT 5" >> $REPORT_FILE

echo -e "\nReport saved to $REPORT_FILE"
echo "Done!"