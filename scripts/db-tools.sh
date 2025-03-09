#!/bin/bash

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    # Use a safer method to load variables that handles special characters
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        if [[ ! $key =~ ^# && -n $key ]]; then
            # Remove leading/trailing whitespace and quotes
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs)
            # Export the variable
            export "$key=$value"
        fi
    done < .env
    echo -e "Loaded environment variables from .env file"
fi

## DATABASE CONFIGURATION:

# Environment
PROD_DB="degenduel"         # My PRODUCTION DB's name
TEST_DB="degenduel_test"    # My TEST DB's name
# Config
DB_USER="branchmanager"     # My server user (branchmanager)
DB_HOST="localhost"         # My host (localhost PostgreSQL server)
API_URL="https://dev.degenduel.me" # Development API endpoint
BRANCH_MANAGER_LOGIN_SECRET="bonkfa"   # Authentication secret for dev login

# Detect environment - default to production
NODE_ENV="production"
if [ -f .env ] && grep -q "NODE_ENV=development" .env; then
    NODE_ENV="development"
fi


## FUNCTIONS:

# (0) Show help
show_help() {
    echo -e "\n${BOLD}${GREEN}=== DegenDuel Database Management Tools ===${NC}\n"
    echo -e "${INFO_PREFIX} ${BOLD}Usage:${NC} ./scripts/db-tools.sh [command] [options]"
    echo -e "\n${BOLD}${CYAN}=== Available Commands ===${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}status${NC}      # Show database sizes and row counts"
    echo -e "${INFO_PREFIX} ${BOLD}backup${NC}      # Create a backup of the production database"
    echo -e "${INFO_PREFIX} ${BOLD}reset-test${NC}  # Reset the test database to match production"
    echo -e "${INFO_PREFIX} ${BOLD}restore${NC}     # Restore production from the latest backup"
    echo -e "${INFO_PREFIX} ${BOLD}bonkfa${NC}      # Generate session tokens"
    echo -e "${INFO_PREFIX} ${BOLD}compliment${NC}  # Give a compliment to the Branch Manager"
    echo -e "${INFO_PREFIX} ${BOLD}money${NC}       # Give money to the Branch Manager"
    echo -e "${INFO_PREFIX} ${BOLD}compare${NC}     # Compare production and test databases"
    echo -e "${INFO_PREFIX} ${BOLD}reconcile${NC}   # Compare Prisma schema with actual database structure"
    echo -e "${INFO_PREFIX} ${BOLD}create-ai-config${NC} # Create database comparison AI analysis configuration file"
    echo -e "${INFO_PREFIX} ${BOLD}create-reconcile-ai-config${NC} # Create Prisma reconciliation AI analysis configuration file"
    echo -e "${INFO_PREFIX} ${BOLD}help${NC}        # Show this help menu"
    
    echo -e "\n${BOLD}${CYAN}=== Command Options ===${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}compare --ai-analysis${NC}  # Compare databases and analyze differences with AI"
    echo -e "${INFO_PREFIX} ${BOLD}reconcile --ai-analysis${NC}  # Compare Prisma schema with DB and analyze with AI"
    echo -e "${INFO_PREFIX} ${BOLD}reconcile --generate-migration${NC}  # Generate migration scripts to fix schema differences"
    echo -e "${INFO_PREFIX} ${YELLOW}Note:${NC} AI analysis requires the OPENAI_API_KEY environment variable to be set"
    
    echo -e "\n${BOLD}${CYAN}=== Database Comparison AI Analysis Configuration ===${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_MODEL${NC}         # Set the OpenAI model (default: gpt-4o)"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_TEMPERATURE${NC}   # Set the temperature (default: 0.7)"
    echo -e "${INFO_PREFIX} ${YELLOW}Note:${NC} Temperature is not supported for o3-mini model and will be omitted"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_MAX_TOKENS${NC}    # Set the max tokens (default: 2000)"
    echo -e "${INFO_PREFIX} ${YELLOW}Note:${NC} For o1 and o3 models, max_tokens is automatically converted to max_completion_tokens"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_SYSTEM_PROMPT${NC} # Set the system prompt"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_CONTEXT${NC}       # Set the context section of the prompt"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_FOCUS${NC}         # Set the focus section of the prompt"
    echo -e "${INFO_PREFIX} ${BOLD}OPENAI_INSTRUCTIONS${NC}  # Set the instructions section of the prompt"
    echo -e "${INFO_PREFIX} ${YELLOW}Example:${NC} OPENAI_MODEL=gpt-4o OPENAI_MAX_TOKENS=4000 ./scripts/db-tools.sh compare --ai-analysis"
    echo -e "${INFO_PREFIX} ${YELLOW}Tip:${NC} Run ${WHITE}./scripts/db-tools.sh create-ai-config${YELLOW} to create a configuration file"
    
    echo -e "\n${BOLD}${CYAN}=== Examples ===${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh status${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh backup${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh money 100${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh compare${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh compare --ai-analysis${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh reconcile${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh reconcile --ai-analysis${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh reconcile --generate-migration${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh create-ai-config${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}./scripts/db-tools.sh create-reconcile-ai-config${NC}"
    echo -e ""
}

# (1) Function to reset the test database
reset_test_db() {
    echo -e "\n${BOLD}${YELLOW}=== RESETTING TEST DATABASE ===${NC}\n"
    
    # First terminate connections
    echo -e "${INFO_PREFIX} ${BOLD}Terminating existing connections...${NC}"
    sudo -u postgres psql -c "
        SELECT pg_terminate_backend(pid) 
        FROM pg_stat_activity 
        WHERE datname IN ('$TEST_DB', '$PROD_DB')
        AND pid <> pg_backend_pid();" >/dev/null 2>&1
    
    # Drop test database if it exists
    echo -e "${INFO_PREFIX} ${BOLD}Dropping test database...${NC}"
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1
    
    # Recreate test database from production template
    echo -e "${INFO_PREFIX} ${BOLD}Recreating test database from production template...${NC}"
    sudo -u postgres psql -c "CREATE DATABASE $TEST_DB WITH TEMPLATE $PROD_DB;" >/dev/null 2>&1
    
    if [ $? -eq 0 ]; then
        # Restore full permissions to your
        sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $TEST_DB TO $DB_USER;" >/dev/null 2>&1
        echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Test database reset successfully!${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Test database is now an exact copy of production.${NC}"
        echo -e "\n${BOLD}${YELLOW}=== RESET COMPLETE ===${NC}\n"
    else
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}Failed to reset test database${NC}"
        echo -e "${ERROR_PREFIX} ${RED}Error: Could not create test database from template${NC}"
        exit 1
    fi
}

# (2) Create a backup of production database 
#     includes all tables, functions, triggers, and views
create_backup() {
    echo -e "\n${BOLD}${GREEN}=== CREATING DATABASE BACKUP ===${NC}\n"
    
    BACKUP_DIR="backups"
    mkdir -p $BACKUP_DIR

    # Give the production database backup a well-timestamped filename
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/degenduel_backup_$TIMESTAMP.sql"
    
    # Create dump of production database
    echo -e "${INFO_PREFIX} ${BOLD}Creating backup of production database...${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Target: ${WHITE}$BACKUP_FILE${NC}"
    pg_dump -U $DB_USER -h $DB_HOST $PROD_DB > $BACKUP_FILE
    
    # If the dump was created successfully, keep only the last 5 backups
    if [ $? -eq 0 ]; then
        echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Backup created successfully!${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Location: ${WHITE}$BACKUP_FILE${NC}"
        
        # Keep only last 5 backups
        REMOVED_COUNT=$(ls -t $BACKUP_DIR/degenduel_backup_* | tail -n +6 | wc -l)
        if [ $REMOVED_COUNT -gt 0 ]; then
        ls -t $BACKUP_DIR/degenduel_backup_* | tail -n +6 | xargs rm -f 2>/dev/null
            echo -e "${INFO_PREFIX} ${YELLOW}Removed $REMOVED_COUNT older backup(s) to save space${NC}"
        fi
        
        echo -e "\n${BOLD}${GREEN}=== BACKUP COMPLETE ===${NC}\n"
    else
        ## If the dump failed, remove the partial backup file  //  
        #rm -f $BACKUP_FILE
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}Failed to create backup${NC}"
        echo -e "${ERROR_PREFIX} ${RED}Check PostgreSQL logs for details${NC}"
        exit 1
    fi
}

# (3) Restore from latest backup
restore_from_backup() {
    echo -e "\n${BOLD}${BG_RED}${WHITE} !!! DATABASE RESTORE OPERATION !!! ${NC}\n"
    
    LATEST_BACKUP=$(ls -t backups/degenduel_backup_* 2>/dev/null | head -n1)
    
    if [ -z "$LATEST_BACKUP" ]; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}No backup files found${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Run ${WHITE}./db-tools.sh backup${YELLOW} first to create a backup${NC}"
        exit 1
    fi
    
    echo -e "${WARNING_PREFIX} ${BOLD}${RED}WARNING: This will OVERWRITE the PRODUCTION database!${NC}"
    echo -e "${WARNING_PREFIX} ${BOLD}${RED}All current data will be replaced with data from:${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Backup file: ${WHITE}$LATEST_BACKUP${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Backup date: ${WHITE}$(date -r $LATEST_BACKUP)${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Backup size: ${WHITE}$(du -h $LATEST_BACKUP | cut -f1)${NC}"
    echo
    echo -e "${BOLD}${BG_RED}${WHITE} THIS OPERATION CANNOT BE UNDONE! ${NC}"
    read -p "$(echo -e ${BOLD}${YELLOW}"Are you ABSOLUTELY sure you want to proceed? (y/N) "${NC})" -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\n${BOLD}${RED}=== RESTORING DATABASE FROM BACKUP ===${NC}\n"
        echo -e "${INFO_PREFIX} ${BOLD}Restoring from backup...${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}This may take several minutes for large databases${NC}"
        psql -U $DB_USER -h $DB_HOST $PROD_DB < $LATEST_BACKUP
        
        if [ $? -eq 0 ]; then
            echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Database restored successfully!${NC}"
            echo -e "\n${BOLD}${GREEN}=== RESTORE COMPLETE ===${NC}\n"
        else
            echo -e "${ERROR_PREFIX} ${BOLD}${RED}Failed to restore database${NC}"
            echo -e "${ERROR_PREFIX} ${RED}Check PostgreSQL logs for details${NC}"
            exit 1
        fi
    else
        echo -e "${INFO_PREFIX} ${YELLOW}Restore cancelled by user${NC}"
    fi
}

# (4) Show database status
show_status() {
    echo -e "\n${BOLD}${GREEN}=== DATABASE STATUS REPORT ===${NC}\n"
    
    echo -e "${INFO_PREFIX} ${BOLD}Checking database sizes...${NC}"
    
    # Get database sizes
    PROD_SIZE=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_size_pretty(pg_database_size('$PROD_DB'));" postgres)
    TEST_SIZE=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_size_pretty(pg_database_size('$TEST_DB'));" postgres)
    
    echo -e "\n${BOLD}${CYAN}=== Database Sizes ===${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}Production ${WHITE}($PROD_DB):${NC} ${GREEN}$PROD_SIZE${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}Test ${WHITE}($TEST_DB):${NC}       ${GREEN}$TEST_SIZE${NC}"
    
    # Show row counts for main tables in production
    echo -e "\n${BOLD}${CYAN}=== Row Counts (Production) ===${NC}"
    # Use a temporary file to store the results
    TEMP_FILE=$(mktemp)
    psql -U $DB_USER -h $DB_HOST -t -c "
        SELECT 
            (SELECT COUNT(*) FROM users) as users,
            (SELECT COUNT(*) FROM contests) as contests,
            (SELECT COUNT(*) FROM transactions) as transactions;" $PROD_DB > $TEMP_FILE
    
    # Read from the temporary file
    read users contests transactions < $TEMP_FILE
    rm $TEMP_FILE
    
    echo -e "${INFO_PREFIX} ${BOLD}Users:${NC}        ${GREEN}$users${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}Contests:${NC}     ${GREEN}$contests${NC}"
    echo -e "${INFO_PREFIX} ${BOLD}Transactions:${NC} ${GREEN}$transactions${NC}"
    
    echo -e "\n${BOLD}${GREEN}=== STATUS REPORT COMPLETE ===${NC}\n"
}

# Helper function to format difference output
diff_output() {
    local diff=$1
    if [ $diff -eq 0 ]; then
        echo -e "${GREEN}None${NC}"
    elif [ $diff -gt 0 ]; then
        echo -e "${YELLOW}+$diff in Prod${NC}"
    else
        echo -e "${YELLOW}+$((-diff)) in Test${NC}"
    fi
}

# (4.5) Compare production and test databases
compare_databases() {
    # Check if AI analysis is requested
    AI_ANALYSIS=false
    if [ "$1" == "--ai-analysis" ]; then
        AI_ANALYSIS=true
    fi

    echo -e "\n${BOLD}${BLUE}=== DATABASE COMPARISON REPORT ===${NC}\n"
    
    # Create main reports directory if it doesn't exist
    REPORTS_DIR="reports"
    mkdir -p $REPORTS_DIR
    
    # Create db_comparisons subdirectory if it doesn't exist
    DB_REPORTS_DIR="$REPORTS_DIR/db_comparisons"
    mkdir -p $DB_REPORTS_DIR
    
    # Create date-based directory (YYYY-MM-DD)
    TODAY=$(date +%Y-%m-%d)
    DATE_DIR="$DB_REPORTS_DIR/$TODAY"
    mkdir -p $DATE_DIR
    
    # Generate timestamp for run subfolder (HH-MM-SS)
    TIMESTAMP=$(date +%H-%M-%S)
    
    # Create a subfolder for this specific run
    RUN_DIR="$DATE_DIR/run_$TIMESTAMP"
    mkdir -p $RUN_DIR
    
    # Set report file path in the run subfolder
    REPORT_FILE="$RUN_DIR/db_comparison.txt"
    
    # Start capturing output to both terminal and file
    # We'll use a function to handle dual output
    dual_output() {
        echo -e "$1" | tee -a $REPORT_FILE
    }
    
    dual_output "${INFO_PREFIX} ${BOLD}Comparing production and test databases...${NC}"
    
    # Get database sizes
    PROD_SIZE=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_database_size('$PROD_DB');" postgres | tr -d ' ')
    TEST_SIZE=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_database_size('$TEST_DB');" postgres | tr -d ' ')
    
    # Calculate size difference
    SIZE_DIFF=$((PROD_SIZE - TEST_SIZE))
    SIZE_DIFF_PERCENT=$(echo "scale=2; ($SIZE_DIFF * 100) / $PROD_SIZE" | bc)
    
    # Format sizes for display
    PROD_SIZE_PRETTY=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_size_pretty(pg_database_size('$PROD_DB'));" postgres | tr -d ' ')
    TEST_SIZE_PRETTY=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_size_pretty(pg_database_size('$TEST_DB'));" postgres | tr -d ' ')
    SIZE_DIFF_PRETTY=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT pg_size_pretty(abs($SIZE_DIFF::bigint));" postgres | tr -d ' ')
    
    dual_output "\n${BOLD}${CYAN}=== Size Comparison ===${NC}"
    dual_output "${INFO_PREFIX} ${BOLD}Production:${NC}  ${GREEN}$PROD_SIZE_PRETTY${NC}"
    dual_output "${INFO_PREFIX} ${BOLD}Test:${NC}        ${GREEN}$TEST_SIZE_PRETTY${NC}"
    
    if [ $SIZE_DIFF -gt 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Difference:${NC}  ${YELLOW}$SIZE_DIFF_PRETTY smaller${NC} (Test is ${YELLOW}$SIZE_DIFF_PERCENT%${NC} smaller than Production)"
    elif [ $SIZE_DIFF -lt 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Difference:${NC}  ${YELLOW}$SIZE_DIFF_PRETTY larger${NC} (Test is ${YELLOW}$SIZE_DIFF_PERCENT%${NC} larger than Production)"
    else
        dual_output "${INFO_PREFIX} ${BOLD}Difference:${NC}  ${GREEN}None${NC} (Both databases are the same size)"
    fi
    
    # Compare row counts for main tables
    dual_output "\n${BOLD}${CYAN}=== Row Count Comparison ===${NC}"
    
    # Get row counts directly and store in variables
    prod_users=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM users;" $PROD_DB | tr -d ' ')
    prod_contests=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM contests;" $PROD_DB | tr -d ' ')
    prod_transactions=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM transactions;" $PROD_DB | tr -d ' ')
    
    test_users=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM users;" $TEST_DB | tr -d ' ')
    test_contests=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM contests;" $TEST_DB | tr -d ' ')
    test_transactions=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT COUNT(*) FROM transactions;" $TEST_DB | tr -d ' ')
    
    # Calculate differences
    users_diff=$((prod_users - test_users))
    contests_diff=$((prod_contests - test_contests))
    transactions_diff=$((prod_transactions - test_transactions))
    
    # Display comparison
    dual_output "${INFO_PREFIX} ${BOLD}Table${NC}         ${BOLD}Production${NC}    ${BOLD}Test${NC}         ${BOLD}Difference${NC}"
    dual_output "${INFO_PREFIX} ${BOLD}------${NC}        ${BOLD}----------${NC}    ${BOLD}----${NC}         ${BOLD}----------${NC}"
    
    # Users comparison
    if [ $users_diff -eq 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Users:${NC}        $prod_users         $test_users         ${GREEN}None${NC}"
    elif [ $users_diff -gt 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Users:${NC}        $prod_users         $test_users         ${YELLOW}+$users_diff in Prod${NC}"
    else
        dual_output "${INFO_PREFIX} ${BOLD}Users:${NC}        $prod_users         $test_users         ${YELLOW}+$((-users_diff)) in Test${NC}"
    fi
    
    # Contests comparison
    if [ $contests_diff -eq 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Contests:${NC}     $prod_contests         $test_contests         ${GREEN}None${NC}"
    elif [ $contests_diff -gt 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Contests:${NC}     $prod_contests         $test_contests         ${YELLOW}+$contests_diff in Prod${NC}"
    else
        dual_output "${INFO_PREFIX} ${BOLD}Contests:${NC}     $prod_contests         $test_contests         ${YELLOW}+$((-contests_diff)) in Test${NC}"
    fi
    
    # Transactions comparison
    if [ $transactions_diff -eq 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Transactions:${NC} $prod_transactions         $test_transactions         ${GREEN}None${NC}"
    elif [ $transactions_diff -gt 0 ]; then
        dual_output "${INFO_PREFIX} ${BOLD}Transactions:${NC} $prod_transactions         $test_transactions         ${YELLOW}+$transactions_diff in Prod${NC}"
    else
        dual_output "${INFO_PREFIX} ${BOLD}Transactions:${NC} $prod_transactions         $test_transactions         ${YELLOW}+$((-transactions_diff)) in Test${NC}"
    fi
    
    # Check for schema differences
    dual_output "\n${BOLD}${CYAN}=== Schema Comparison ===${NC}"
    dual_output "${INFO_PREFIX} ${BOLD}Checking for schema differences...${NC}"
    
    # Create temporary files for schema dumps
    PROD_SCHEMA=$(mktemp)
    TEST_SCHEMA=$(mktemp)
    SCHEMA_DIFF=$(mktemp)
    
    # Dump schemas (tables, columns, constraints, but not data)
    pg_dump -U $DB_USER -h $DB_HOST -s $PROD_DB > $PROD_SCHEMA
    pg_dump -U $DB_USER -h $DB_HOST -s $TEST_DB > $TEST_SCHEMA
    
    # Compare schemas
    diff -u $PROD_SCHEMA $TEST_SCHEMA > $SCHEMA_DIFF
    
    # Check if there are differences
    if [ -s $SCHEMA_DIFF ]; then
        DIFF_COUNT=$(wc -l < $SCHEMA_DIFF)
        dual_output "${WARNING_PREFIX} ${YELLOW}Found $DIFF_COUNT schema differences between production and test${NC}"
        
        # Analyze the differences to provide a more intelligent summary
        dual_output "\n${BOLD}${CYAN}=== Schema Difference Summary ===${NC}"
        
        # Extract missing tables (in prod but not in test)
        MISSING_TABLES=$(grep -A 1 "^-- Name:" $PROD_SCHEMA | grep "Type: TABLE" | grep -v -f <(grep -A 1 "^-- Name:" $TEST_SCHEMA | grep "Type: TABLE") | sed -n 's/^-- Name: \([^;]*\);.*/\1/p' | sort)
        MISSING_TABLE_COUNT=$(echo "$MISSING_TABLES" | grep -v "^$" | wc -l)
        
        # Extract extra tables (in test but not in prod)
        EXTRA_TABLES=$(grep -A 1 "^-- Name:" $TEST_SCHEMA | grep "Type: TABLE" | grep -v -f <(grep -A 1 "^-- Name:" $PROD_SCHEMA | grep "Type: TABLE") | sed -n 's/^-- Name: \([^;]*\);.*/\1/p' | sort)
        EXTRA_TABLE_COUNT=$(echo "$EXTRA_TABLES" | grep -v "^$" | wc -l)
        
        # Extract tables with different column definitions
        TABLES_WITH_COLUMN_DIFFS=$(grep -E "^[-+][[:space:]]+[a-zA-Z_]+ " $SCHEMA_DIFF | 
                                  grep -v "^[-+]--" | 
                                  grep -B 5 -A 0 "CREATE TABLE" | 
                                  grep "CREATE TABLE" | 
                                  sed -n 's/^[-+]CREATE TABLE public\.\([^ ]*\).*/\1/p' | 
                                  sort | uniq)
        
        # Count different column definitions
        COLUMN_DIFFS=$(grep -E "^[-+][[:space:]]+[a-zA-Z_]+ " $SCHEMA_DIFF | grep -v "^[-+]--" | wc -l)
        
        # Count constraint differences
        CONSTRAINT_DIFFS=$(grep -E "^[-+][[:space:]]+CONSTRAINT" $SCHEMA_DIFF | wc -l)
        
        # Count index differences
        INDEX_DIFFS=$(grep -A 1 "^[-+]-- Name:" $SCHEMA_DIFF | grep "Type: INDEX" | wc -l)
        
        # Count sequence differences
        SEQUENCE_DIFFS=$(grep -A 1 "^[-+]-- Name:" $SCHEMA_DIFF | grep "Type: SEQUENCE" | wc -l)
        
        # Count foreign key differences
        FK_DIFFS=$(grep -A 1 "^[-+]-- Name:" $SCHEMA_DIFF | grep "Type: FK" | wc -l)
        
        # Display summary
        dual_output "${INFO_PREFIX} ${BOLD}Tables:${NC}       ${YELLOW}$MISSING_TABLE_COUNT missing in test, $EXTRA_TABLE_COUNT extra in test${NC}"
        dual_output "${INFO_PREFIX} ${BOLD}Columns:${NC}      ${YELLOW}$COLUMN_DIFFS differences${NC}"
        dual_output "${INFO_PREFIX} ${BOLD}Constraints:${NC}  ${YELLOW}$CONSTRAINT_DIFFS differences${NC}"
        dual_output "${INFO_PREFIX} ${BOLD}Indexes:${NC}      ${YELLOW}$INDEX_DIFFS differences${NC}"
        dual_output "${INFO_PREFIX} ${BOLD}Sequences:${NC}    ${YELLOW}$SEQUENCE_DIFFS differences${NC}"
        dual_output "${INFO_PREFIX} ${BOLD}Foreign Keys:${NC} ${YELLOW}$FK_DIFFS differences${NC}"
        
        # List missing tables if any
        if [ $MISSING_TABLE_COUNT -gt 0 ]; then
            dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Tables missing in test database:${NC}"
            echo "$MISSING_TABLES" | grep -v "^$" | while read table; do
                dual_output "${INFO_PREFIX} - ${YELLOW}$table${NC}"
            done
        fi
        
        # List extra tables if any
        if [ $EXTRA_TABLE_COUNT -gt 0 ]; then
            dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Extra tables in test database:${NC}"
            echo "$EXTRA_TABLES" | grep -v "^$" | while read table; do
                dual_output "${INFO_PREFIX} - ${YELLOW}$table${NC}"
            done
        fi
        
        # List tables with column differences
        if [ -n "$TABLES_WITH_COLUMN_DIFFS" ]; then
            dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Tables with structural differences:${NC}"
            echo "$TABLES_WITH_COLUMN_DIFFS" | while read table; do
                if [ ! -z "$table" ]; then
                    # Count columns that differ for this table
                    COL_DIFF_COUNT=$(grep -A 50 "CREATE TABLE public.$table" $SCHEMA_DIFF | 
                                    grep -E "^[-+][[:space:]]+[a-zA-Z_]+ " | 
                                    grep -v "^[-+]--" | 
                                    wc -l)
                    dual_output "${INFO_PREFIX} - ${YELLOW}$table${NC} (${CYAN}$COL_DIFF_COUNT column differences${NC})"
                fi
            done
        fi
        
        # Extract specific schema elements with differences
        dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Key schema differences:${NC}"
        
        # Check for wallet_balance_history table
        if grep -q "wallet_balance_history" $SCHEMA_DIFF; then
            dual_output "${INFO_PREFIX} - ${YELLOW}wallet_balance_history table${NC} has differences or is missing"
        fi
        
        # Check for experience_points column in users table
        if grep -q "experience_points" $SCHEMA_DIFF; then
            dual_output "${INFO_PREFIX} - ${YELLOW}users.experience_points${NC} column has differences or is missing"
        fi
        
        # Check for achievement tiers
        if grep -q "tier.*CONSTRAINT" $SCHEMA_DIFF; then
            dual_output "${INFO_PREFIX} - ${YELLOW}Achievement tier constraints${NC} have differences or are missing"
        fi
        
        # Analyze specific tables with known differences
        dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Detailed column differences:${NC}"
        
        # Check user_achievements table differences
        if grep -q "user_achievements" $SCHEMA_DIFF; then
            MISSING_COLS=$(grep -A 20 "CREATE TABLE public.user_achievements" $PROD_SCHEMA | 
                          grep -E "^[[:space:]]+[a-zA-Z_]+ " | 
                          grep -v -f <(grep -A 20 "CREATE TABLE public.user_achievements" $TEST_SCHEMA | 
                                      grep -E "^[[:space:]]+[a-zA-Z_]+ ") | 
                          sed -n 's/^[[:space:]]*\([a-zA-Z_]*\).*/\1/p')
            
            if [ -n "$MISSING_COLS" ]; then
                dual_output "${INFO_PREFIX} - ${YELLOW}user_achievements${NC} table is missing columns in test:"
                echo "$MISSING_COLS" | while read col; do
                    if [ ! -z "$col" ]; then
                        dual_output "${INFO_PREFIX}   * ${CYAN}$col${NC}"
                    fi
                done
            fi
        fi
        
        # Check users table differences
        if grep -q "CREATE TABLE public.users" $SCHEMA_DIFF; then
            MISSING_USER_COLS=$(grep -A 30 "CREATE TABLE public.users" $PROD_SCHEMA | 
                               grep -E "^[[:space:]]+[a-zA-Z_]+ " | 
                               grep -v -f <(grep -A 30 "CREATE TABLE public.users" $TEST_SCHEMA | 
                                           grep -E "^[[:space:]]+[a-zA-Z_]+ ") | 
                               sed -n 's/^[[:space:]]*\([a-zA-Z_]*\).*/\1/p')
            
            if [ -n "$MISSING_USER_COLS" ]; then
                dual_output "${INFO_PREFIX} - ${YELLOW}users${NC} table is missing columns in test:"
                echo "$MISSING_USER_COLS" | while read col; do
                    if [ ! -z "$col" ]; then
                        dual_output "${INFO_PREFIX}   * ${CYAN}$col${NC}"
                    fi
                done
            fi
        fi
        
        # Check for missing indexes
        MISSING_INDEXES=$(grep -A 1 "^-- Name:" $PROD_SCHEMA | 
                         grep "Type: INDEX" | 
                         grep -v -f <(grep -A 1 "^-- Name:" $TEST_SCHEMA | grep "Type: INDEX") | 
                         sed -n 's/^-- Name: \([^;]*\);.*/\1/p')
        
        if [ -n "$MISSING_INDEXES" ]; then
            dual_output "${INFO_PREFIX} - ${YELLOW}Missing indexes in test:${NC}"
            echo "$MISSING_INDEXES" | while read idx; do
                if [ ! -z "$idx" ]; then
                    dual_output "${INFO_PREFIX}   * ${CYAN}$idx${NC}"
                fi
            done
        fi
        
        # Check for missing foreign keys
        MISSING_FKS=$(grep -A 1 "^-- Name:" $PROD_SCHEMA | 
                     grep "Type: FK CONSTRAINT" | 
                     grep -v -f <(grep -A 1 "^-- Name:" $TEST_SCHEMA | grep "Type: FK CONSTRAINT") | 
                     sed -n 's/^-- Name: \([^;]*\);.*/\1/p')
        
        if [ -n "$MISSING_FKS" ]; then
            dual_output "${INFO_PREFIX} - ${YELLOW}Missing foreign keys in test:${NC}"
            echo "$MISSING_FKS" | while read fk; do
                if [ ! -z "$fk" ]; then
                    dual_output "${INFO_PREFIX}   * ${CYAN}$fk${NC}"
                fi
            done
        fi
        
        # Provide a summary recommendation
        dual_output "\n${INFO_PREFIX} ${BOLD}${YELLOW}Recommendation:${NC}"
        if [ $MISSING_TABLE_COUNT -gt 0 ] || [ $COLUMN_DIFFS -gt 10 ]; then
            dual_output "${INFO_PREFIX} ${YELLOW}Your test database schema is significantly different from production.${NC}"
            dual_output "${INFO_PREFIX} ${YELLOW}Consider running ${WHITE}./scripts/db-tools.sh reset-test${YELLOW} to synchronize schemas.${NC}"
        else
            dual_output "${INFO_PREFIX} ${GREEN}Minor schema differences detected. You may continue using the test database.${NC}"
        fi
        
        # Provide instructions for detailed diff
        dual_output "\n${INFO_PREFIX} ${CYAN}For detailed schema differences, run:${NC}"
        dual_output "${INFO_PREFIX} ${WHITE}pg_dump -U $DB_USER -h $DB_HOST -s $PROD_DB > prod_schema.sql${NC}"
        dual_output "${INFO_PREFIX} ${WHITE}pg_dump -U $DB_USER -h $DB_HOST -s $TEST_DB > test_schema.sql${NC}"
        dual_output "${INFO_PREFIX} ${WHITE}diff -u prod_schema.sql test_schema.sql${NC}"
    else
        dual_output "${SUCCESS_PREFIX} ${GREEN}No schema differences found between production and test${NC}"
    fi
    
    # Clean up schema files
    rm $PROD_SCHEMA $TEST_SCHEMA $SCHEMA_DIFF
    
    # Create a plain text version without color codes for easier reading in text editors
    sed 's/\x1b\[[0-9;]*m//g' $REPORT_FILE > "$RUN_DIR/db_comparison_plain.txt"
    
    dual_output "\n${BOLD}${BLUE}=== COMPARISON COMPLETE ===${NC}"
    echo -e "${SUCCESS_PREFIX} ${GREEN}Reports saved to:${NC} ${CYAN}$RUN_DIR/${NC}"
    echo -e "${INFO_PREFIX} ${GREEN}Files:${NC} ${CYAN}db_comparison.txt, db_comparison_plain.txt${NC}\n"
    
    # If AI analysis is requested, run it
    if [ "$AI_ANALYSIS" = true ]; then
        analyze_with_ai "$RUN_DIR/db_comparison_plain.txt" "$RUN_DIR"
    fi
}

# (4.6) Analyze database differences with AI
analyze_with_ai() {
    REPORT_FILE=$1
    RUN_DIR=$2
    AI_ANALYSIS_FILE="$RUN_DIR/db_comparison_ai_analysis.txt"
    
    # Check for configuration file and load it if it exists
    CONFIG_FILE="config/db_comparison_ai_config.sh"
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${INFO_PREFIX} ${GREEN}Loading AI analysis configuration from ${WHITE}$CONFIG_FILE${NC}"
        source "$CONFIG_FILE"
    fi
    
    # Configuration for OpenAI API
    AI_MODEL=${OPENAI_MODEL:-"gpt-4o"}
    AI_TEMPERATURE=${OPENAI_TEMPERATURE:-0.7}
    AI_MAX_TOKENS=${OPENAI_MAX_TOKENS:-2000}
    AI_SYSTEM_PROMPT=${OPENAI_SYSTEM_PROMPT:-"You are a PostgreSQL and Prisma ORM expert who provides clear, actionable advice for reconciling database differences."}
    
    # Configuration for prompt content
    AI_CONTEXT=${OPENAI_CONTEXT:-"
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management, NOT direct SQL commands
2. All database changes should be implemented via Prisma migrations
3. The application is a gaming platform for cryptocurrency trading contests"}

    AI_FOCUS=${OPENAI_FOCUS:-"
Focus on:
1. Critical differences that would affect application functionality
2. Concise Prisma migration steps to fix each critical difference, grouped by priority
3. A step-by-step action plan with no more than 5 key steps"}

    AI_INSTRUCTIONS=${OPENAI_INSTRUCTIONS:-"Keep your response concise and actionable, with clear section headings and bullet points where appropriate."}
    
    echo -e "\n${BOLD}${CYAN}=== AI ANALYSIS OF DATABASE DIFFERENCES ===${NC}\n"
    echo -e "${INFO_PREFIX} ${BOLD}Preparing data for AI analysis...${NC}"
    
    # Check if OpenAI API key is set
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}OpenAI API key not found${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Please set the OPENAI_API_KEY environment variable:${NC}"
        echo -e "${INFO_PREFIX} ${WHITE}export OPENAI_API_KEY='your-api-key'${NC}"
        return 1
    fi
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}jq is not installed${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Please install jq to use AI analysis:${NC}"
        echo -e "${INFO_PREFIX} ${WHITE}sudo apt-get install jq${NC} (Debian/Ubuntu)"
        echo -e "${INFO_PREFIX} ${WHITE}brew install jq${NC} (macOS)"
        return 1
    fi
    
    # Get Prisma schema if it exists
    PRISMA_SCHEMA=""
    if [ -f "prisma/schema.prisma" ]; then
        PRISMA_SCHEMA=$(cat prisma/schema.prisma)
        echo -e "${INFO_PREFIX} ${GREEN}Found Prisma schema, including in analysis${NC}"
    else
        echo -e "${WARNING_PREFIX} ${YELLOW}Prisma schema not found, proceeding without it${NC}"
    fi
    
    # Prepare the prompt for OpenAI
    PROMPT_FILE=$(mktemp)
    cat > $PROMPT_FILE << EOL
You are a database expert specializing in PostgreSQL and Prisma ORM. Analyze the following database comparison report between DegenDuel's production and test databases, and provide recommendations on how to reconcile the differences using Prisma migrations.
$AI_CONTEXT

$(if [ ! -z "$PRISMA_SCHEMA" ]; then echo "PRISMA SCHEMA:"; echo "$PRISMA_SCHEMA"; fi)
$AI_FOCUS

$AI_INSTRUCTIONS

Database Comparison Report:
$(cat $REPORT_FILE)

Provide a detailed analysis and actionable recommendations:
EOL
    
    echo -e "${INFO_PREFIX} ${BOLD}Sending data to OpenAI for analysis...${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Using model:${NC} ${WHITE}$AI_MODEL${NC}"
    
    # Determine which token parameter to use based on the model
    TOKEN_PARAM="max_tokens"
    TEMP_PARAM="temperature"
    
    # For o1 and o3 models, use different parameter names
    if [[ "$AI_MODEL" == *"o1"* || "$AI_MODEL" == *"o3"* ]]; then
        echo -e "${INFO_PREFIX} ${CYAN}Using o1/o3 model parameters for ${WHITE}$AI_MODEL${NC}"
        TOKEN_PARAM="max_completion_tokens"
        
        # For o3-mini, temperature is not supported at all
        if [[ "$AI_MODEL" == "o3-mini" ]]; then
            echo -e "${INFO_PREFIX} ${YELLOW}Note: temperature parameter is not supported for ${WHITE}$AI_MODEL${NC}, will be omitted"
            # Create JSON payload without temperature
            PAYLOAD="{
                \"model\": \"$AI_MODEL\",
                \"messages\": [
                  {
                    \"role\": \"system\",
                    \"content\": \"$AI_SYSTEM_PROMPT\"
                  },
                  {
                    \"role\": \"user\",
                    \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
                  }
                ],
                \"$TOKEN_PARAM\": $AI_MAX_TOKENS
            }"
        else
            # For other o1/o3 models that support temperature
            PAYLOAD="{
                \"model\": \"$AI_MODEL\",
                \"messages\": [
                  {
                    \"role\": \"system\",
                    \"content\": \"$AI_SYSTEM_PROMPT\"
                  },
                  {
                    \"role\": \"user\",
                    \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
                  }
                ],
                \"$TEMP_PARAM\": $AI_TEMPERATURE,
                \"$TOKEN_PARAM\": $AI_MAX_TOKENS
            }"
        fi
    else
        echo -e "${INFO_PREFIX} ${CYAN}Using standard parameters for ${WHITE}$AI_MODEL${NC} model"
        # For standard models like gpt-4o
        PAYLOAD="{
            \"model\": \"$AI_MODEL\",
            \"messages\": [
              {
                \"role\": \"system\",
                \"content\": \"$AI_SYSTEM_PROMPT\"
              },
              {
                \"role\": \"user\",
                \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
              }
            ],
            \"$TEMP_PARAM\": $AI_TEMPERATURE,
            \"$TOKEN_PARAM\": $AI_MAX_TOKENS
        }"
    fi
    
    # Call OpenAI API with the appropriate parameters
    RESPONSE=$(curl -s https://api.openai.com/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -d @"$PAYLOAD_FILE")
    
    # Check if the API call was successful
    if echo "$RESPONSE" | grep -q "error"; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}Error calling OpenAI API${NC}"
        echo -e "${ERROR_PREFIX} ${RED}$(echo $RESPONSE | jq -r '.error.message')${NC}"
        rm $PROMPT_FILE
        return 1
    fi
    
    # Extract and save the AI analysis
    echo "$RESPONSE" | jq -r '.choices[0].message.content' > $AI_ANALYSIS_FILE
    
    echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}AI analysis complete!${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Analysis saved to:${NC} ${WHITE}$RUN_DIR/db_comparison_ai_analysis.txt${NC}"
    
    # Display the AI analysis
    echo -e "\n${BOLD}${CYAN}=== AI RECOMMENDATIONS ===${NC}\n"
    cat $AI_ANALYSIS_FILE
    echo -e "\n${BOLD}${CYAN}=== END OF AI ANALYSIS ===${NC}\n"
    
    # Clean up
    rm $PROMPT_FILE
}

# (4.7) Create AI analysis configuration file
create_ai_config() {
    CONFIG_DIR="config"
    CONFIG_FILE="$CONFIG_DIR/db_comparison_ai_config.sh"
    
    echo -e "\n${BOLD}${CYAN}=== CREATING AI ANALYSIS CONFIGURATION ===${NC}\n"
    
    # Create config directory if it doesn't exist
    mkdir -p $CONFIG_DIR
    
    # Create or overwrite the configuration file
    cat > $CONFIG_FILE << EOL
#!/bin/bash

# Database Comparison AI Analysis Configuration
# --------------------------------------------
# This file contains configuration settings ONLY for the database comparison AI analysis feature
# in the db-tools.sh script. These settings DO NOT affect any other AI features in the application.
# 
# IMPORTANT: These environment variables are only active during the execution of the db-tools.sh script
# and do not persist beyond that or affect other parts of the application.

# API Settings for Database Comparison Analysis
export OPENAI_MODEL="gpt-4o"        # Model to use for database comparison analysis
export OPENAI_TEMPERATURE="0.7"      # Temperature (0.0-1.0, lower = more deterministic)
                                    # Note: Temperature is not supported for o3-mini model
export OPENAI_MAX_TOKENS="2000"      # Maximum tokens in the response
                                    # Note: For o1 and o3 models, this will be used as max_completion_tokens

# Prompt Settings for Database Schema Comparison
export OPENAI_SYSTEM_PROMPT="You are a PostgreSQL and Prisma ORM expert who provides clear, actionable advice for reconciling database differences."

export OPENAI_CONTEXT="
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management, NOT direct SQL commands
2. All database changes should be implemented via Prisma migrations
3. The application is a gaming platform for cryptocurrency trading contests"

export OPENAI_FOCUS="
Focus on:
1. Critical differences that would affect application functionality
2. Concise Prisma migration steps to fix each critical difference, grouped by priority
3. A step-by-step action plan with no more than 5 key steps"

export OPENAI_INSTRUCTIONS="Keep your response concise and actionable, with clear section headings and bullet points where appropriate."

# End of database comparison AI analysis configuration
EOL
    
    # Make the file executable
    chmod +x $CONFIG_FILE
    
    echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}AI analysis configuration created!${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Configuration file:${NC} ${WHITE}$CONFIG_FILE${NC}"
    echo -e "${INFO_PREFIX} ${YELLOW}You can edit this file to customize the AI analysis settings.${NC}"
    echo -e "${INFO_PREFIX} ${YELLOW}To use the configuration, run:${NC} ${WHITE}source $CONFIG_FILE && ./scripts/db-tools.sh compare --ai-analysis${NC}"
    
    echo -e "\n${BOLD}${CYAN}=== CONFIGURATION COMPLETE ===${NC}\n"
}

# (4.8) Create Prisma reconcile AI analysis configuration file
create_reconcile_ai_config() {
    CONFIG_DIR="config"
    CONFIG_FILE="$CONFIG_DIR/prisma_reconcile_ai_config.sh"
    
    echo -e "\n${BOLD}${CYAN}=== CREATING PRISMA RECONCILE AI ANALYSIS CONFIGURATION ===${NC}\n"
    
    # Create config directory if it doesn't exist
    mkdir -p $CONFIG_DIR
    
    # Create or overwrite the configuration file
    cat > $CONFIG_FILE << EOL
#!/bin/bash

# Prisma Schema Reconciliation AI Analysis Configuration
# --------------------------------------------
# This file contains configuration settings ONLY for the Prisma schema reconciliation AI analysis feature
# in the db-tools.sh script. These settings DO NOT affect any other AI features in the application.
# 
# IMPORTANT: These environment variables are only active during the execution of the db-tools.sh script
# and do not persist beyond that or affect other parts of the application.

# API Settings for Prisma Reconciliation Analysis
export PRISMA_OPENAI_MODEL="gpt-4o"        # Model to use for Prisma schema reconciliation analysis
export PRISMA_OPENAI_TEMPERATURE="0.5"      # Temperature (0.0-1.0, lower = more deterministic)
                                           # Note: Temperature is not supported for o3-mini model
export PRISMA_OPENAI_MAX_TOKENS="4000"      # Maximum tokens in the response
                                           # Note: For o1 and o3 models, this will be used as max_completion_tokens

# Prompt Settings for Prisma Schema Reconciliation
export PRISMA_OPENAI_SYSTEM_PROMPT="You are a Prisma ORM and PostgreSQL schema expert who specializes in detecting and resolving discrepancies between Prisma schema definitions and actual database structures."

export PRISMA_OPENAI_CONTEXT="
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management
2. We need to identify all discrepancies between the Prisma schema definitions and the actual PostgreSQL database structure
3. The goal is to reconcile these differences to maintain schema integrity
4. Migration issues may have caused these discrepancies"

export PRISMA_OPENAI_FOCUS="
Focus on:
1. Identifying ALL differences between the Prisma schema and the actual database (using [+] for additions and [-] for removals)
2. Categorizing differences by type: tables, columns, types, constraints, indexes, and relationships
3. Cross-checking _prisma_migrations with the prisma/migrations/ folder
4. Providing precise Prisma migration commands to fix each issue"

export PRISMA_OPENAI_INSTRUCTIONS="Document all differences thoroughly using [+] and [-] notation. Be extremely comprehensive and detailed, as these insights will be used to fix critical schema management issues. Structure your response with clear headings and organize issues by priority level."

# End of Prisma reconciliation AI analysis configuration
EOL
    
    # Make the file executable
    chmod +x $CONFIG_FILE
    
    echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Prisma reconcile AI analysis configuration created!${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Configuration file:${NC} ${WHITE}$CONFIG_FILE${NC}"
    echo -e "${INFO_PREFIX} ${YELLOW}You can edit this file to customize the AI analysis settings.${NC}"
    echo -e "${INFO_PREFIX} ${YELLOW}To use the configuration, run:${NC} ${WHITE}source $CONFIG_FILE && ./scripts/db-tools.sh reconcile --ai-analysis${NC}"
    
    echo -e "\n${BOLD}${CYAN}=== CONFIGURATION COMPLETE ===${NC}\n"
}

# (4.9) Compare Prisma schema with actual database structure
reconcile_prisma_schema() {
    # Check for command line options
    AI_ANALYSIS=false
    GENERATE_MIGRATION=false
    
    for arg in "$@"; do
        case $arg in
            --ai-analysis)
                AI_ANALYSIS=true
                ;;
            --generate-migration)
                GENERATE_MIGRATION=true
                ;;
        esac
    done

    echo -e "\n${BOLD}${BLUE}=== PRISMA SCHEMA RECONCILIATION REPORT ===${NC}\n"
    
    # Create main reports directory if it doesn't exist
    REPORTS_DIR="reports"
    mkdir -p $REPORTS_DIR
    
    # Create prisma_reconcile subdirectory if it doesn't exist
    PRISMA_REPORTS_DIR="$REPORTS_DIR/prisma_reconcile"
    mkdir -p $PRISMA_REPORTS_DIR
    
    # Create date-based directory (YYYY-MM-DD)
    TODAY=$(date +%Y-%m-%d)
    DATE_DIR="$PRISMA_REPORTS_DIR/$TODAY"
    mkdir -p $DATE_DIR
    
    # Generate timestamp for run subfolder (HH-MM-SS)
    TIMESTAMP=$(date +%H-%M-%S)
    
    # Create a subfolder for this specific run
    RUN_DIR="$DATE_DIR/run_$TIMESTAMP"
    mkdir -p $RUN_DIR
    
    # Set report file path in the run subfolder
    REPORT_FILE="$RUN_DIR/prisma_reconcile.txt"
    
    # Start capturing output to both terminal and file
    # We'll use a function to handle dual output
    dual_output() {
        echo -e "$1" | tee -a $REPORT_FILE
    }
    
    dual_output "${INFO_PREFIX} ${BOLD}Comparing Prisma schema with actual database structure...${NC}"
    
    # Get Prisma schema file
    PRISMA_SCHEMA_FILE="prisma/schema.prisma"
    
    if [ ! -f "$PRISMA_SCHEMA_FILE" ]; then
        dual_output "${ERROR_PREFIX} ${RED}Prisma schema file not found at $PRISMA_SCHEMA_FILE${NC}"
        exit 1
    fi
    
    # Create temporary files for database schema dump
    DB_SCHEMA=$(mktemp)
    
    # Dump database schema (tables, columns, constraints, etc.)
    pg_dump -U $DB_USER -h $DB_HOST -s $PROD_DB > $DB_SCHEMA
    
    # 1. First, let's extract all tables defined in Prisma schema
    dual_output "\n${BOLD}${CYAN}=== Extracting Prisma Schema Data ===${NC}"
    
    # Extract all model names from the Prisma schema
    PRISMA_MODELS=$(grep -E "^model [a-zA-Z0-9_]+ {" $PRISMA_SCHEMA_FILE | sed -E 's/^model ([a-zA-Z0-9_]+) \{/\1/g')
    PRISMA_MODEL_COUNT=$(echo "$PRISMA_MODELS" | wc -l)
    
    dual_output "${INFO_PREFIX} ${BOLD}Found $PRISMA_MODEL_COUNT models in Prisma schema${NC}"
    
    # 2. Extract tables from the database
    dual_output "\n${BOLD}${CYAN}=== Extracting Database Tables ===${NC}"
    
    # Get all tables from the database schema
    DB_TABLES=$(grep -E "^CREATE TABLE public\.[a-zA-Z0-9_]+" $DB_SCHEMA | sed -E 's/^CREATE TABLE public\.([a-zA-Z0-9_]+).*/\1/g' | sort)
    DB_TABLE_COUNT=$(echo "$DB_TABLES" | wc -l)
    
    dual_output "${INFO_PREFIX} ${BOLD}Found $DB_TABLE_COUNT tables in the database${NC}"
    
    # 3. Compare models with tables
    dual_output "\n${BOLD}${CYAN}=== Comparing Prisma Models with Database Tables ===${NC}"
    
    # Find tables in database but not in Prisma
    dual_output "${INFO_PREFIX} ${BOLD}Tables in database but not in Prisma schema:${NC}"
    TABLES_NOT_IN_PRISMA=0
    
    echo "$DB_TABLES" | while read table; do
        if ! echo "$PRISMA_MODELS" | grep -q "^$table$"; then
            dual_output "${WARNING_PREFIX} ${YELLOW}[+] Table exists in DB but not in Prisma: ${CYAN}$table${NC}"
            TABLES_NOT_IN_PRISMA=$((TABLES_NOT_IN_PRISMA + 1))
        fi
    done
    
    if [ $TABLES_NOT_IN_PRISMA -eq 0 ]; then
        dual_output "${SUCCESS_PREFIX} ${GREEN}None${NC}"
    fi
    
    # Find models in Prisma but not in database
    dual_output "\n${INFO_PREFIX} ${BOLD}Models in Prisma schema but not in database:${NC}"
    MODELS_NOT_IN_DB=0
    
    echo "$PRISMA_MODELS" | while read model; do
        if ! echo "$DB_TABLES" | grep -q "^$model$"; then
            dual_output "${WARNING_PREFIX} ${YELLOW}[-] Model exists in Prisma but not in DB: ${CYAN}$model${NC}"
            MODELS_NOT_IN_DB=$((MODELS_NOT_IN_DB + 1))
        fi
    done
    
    if [ $MODELS_NOT_IN_DB -eq 0 ]; then
        dual_output "${SUCCESS_PREFIX} ${GREEN}None${NC}"
    fi
    
    # 4. Now do a detailed analysis of each table/model that exists in both
    dual_output "\n${BOLD}${CYAN}=== Detailed Column Comparison ===${NC}"
    dual_output "${INFO_PREFIX} ${BOLD}Analyzing tables that exist in both Prisma and database...${NC}"
    
    # Create a temporary directory to store column info for each table
    TEMP_DIR=$(mktemp -d)
    
    # For each table that exists in both Prisma and the database, compare columns
    echo "$DB_TABLES" | while read table; do
        if echo "$PRISMA_MODELS" | grep -q "^$table$"; then
            # Extract columns from database for this table
            DB_COLUMNS_FILE="$TEMP_DIR/${table}_db_columns.txt"
            grep -A 100 "CREATE TABLE public.$table" $DB_SCHEMA | 
                grep -B 100 -m 1 ");" | 
                grep -v "CREATE TABLE" | 
                grep -v ");" | 
                grep -E "^    [a-zA-Z0-9_]+ " | 
                sed -E 's/^    ([a-zA-Z0-9_]+) .*/\1/g' > $DB_COLUMNS_FILE
            
            # Extract columns from Prisma schema for this model
            PRISMA_COLUMNS_FILE="$TEMP_DIR/${table}_prisma_columns.txt"
            awk -v model="$table" '
                BEGIN { found=0; }
                $0 ~ "^model " model " {" { found=1; next; }
                found && $0 ~ /^}/ { found=0; }
                found && $0 ~ /^  [a-zA-Z0-9_]+/ { print $1; }
            ' $PRISMA_SCHEMA_FILE > $PRISMA_COLUMNS_FILE
            
            # Compare columns
            dual_output "\n${BOLD}${CYAN}Table: $table${NC}"
            
            # Find columns in database but not in Prisma
            DB_ONLY_COLUMNS=$(comm -23 <(sort $DB_COLUMNS_FILE) <(sort $PRISMA_COLUMNS_FILE))
            if [ ! -z "$DB_ONLY_COLUMNS" ]; then
                dual_output "${INFO_PREFIX} ${YELLOW}Columns in database but not in Prisma:${NC}"
                echo "$DB_ONLY_COLUMNS" | while read col; do
                    # Get column definition from database
                    COL_DEF=$(grep -E "^    $col " $DB_SCHEMA | grep -A 1 "CREATE TABLE public.$table" | head -1)
                    dual_output "${WARNING_PREFIX} ${YELLOW}[+] $col${NC} - ${CYAN}$COL_DEF${NC}"
                done
            fi
            
            # Find columns in Prisma but not in database
            PRISMA_ONLY_COLUMNS=$(comm -13 <(sort $DB_COLUMNS_FILE) <(sort $PRISMA_COLUMNS_FILE))
            if [ ! -z "$PRISMA_ONLY_COLUMNS" ]; then
                dual_output "${INFO_PREFIX} ${YELLOW}Columns in Prisma but not in database:${NC}"
                echo "$PRISMA_ONLY_COLUMNS" | while read col; do
                    # Get column definition from Prisma
                    COL_DEF=$(grep -A 1 "  $col " $PRISMA_SCHEMA_FILE | grep -B 1 "model $table {" | head -1)
                    dual_output "${WARNING_PREFIX} ${YELLOW}[-] $col${NC} - ${CYAN}$COL_DEF${NC}"
                done
            fi
            
            if [ -z "$DB_ONLY_COLUMNS" ] && [ -z "$PRISMA_ONLY_COLUMNS" ]; then
                dual_output "${SUCCESS_PREFIX} ${GREEN}Column names match perfectly!${NC}"
            fi
            
            # Compare column types and constraints
            if [ -z "$DB_ONLY_COLUMNS" ] && [ -z "$PRISMA_ONLY_COLUMNS" ]; then
                dual_output "${INFO_PREFIX} ${BOLD}Comparing column types for matching columns...${NC}"
                
                # Get matching columns
                MATCHING_COLUMNS=$(comm -12 <(sort $DB_COLUMNS_FILE) <(sort $PRISMA_COLUMNS_FILE))
                
                # For each matching column, compare the type information
                echo "$MATCHING_COLUMNS" | while read col; do
                    if [ ! -z "$col" ]; then
                        # Get column definition from database
                        DB_COL_DEF=$(grep -E "^    $col " $DB_SCHEMA | grep -A 100 "CREATE TABLE public.$table" | head -1)
                        DB_COL_TYPE=$(echo "$DB_COL_DEF" | sed -E 's/^[[:space:]]*[a-zA-Z0-9_]+ ([^,]*).*/\1/' | xargs)
                        
                        # Get column definition from Prisma
                        PRISMA_COL_DEF=$(awk -v model="$table" -v column="$col" '
                            BEGIN { found=0; }
                            $0 ~ "^model " model " {" { found=1; next; }
                            found && $0 ~ /^}/ { found=0; }
                            found && $0 ~ "^  " column " " { 
                                gsub(/^[[:space:]]*[a-zA-Z0-9_]+ /, "");
                                print $0;
                                exit;
                            }
                        ' $PRISMA_SCHEMA_FILE | sed 's/[[:space:]]*$//')
                        
                        # Extract type information
                        PRISMA_COL_TYPE=$(echo "$PRISMA_COL_DEF" | awk '{print $1}')
                        
                        # Map Prisma types to PostgreSQL types for comparison
                        EXPECTED_PG_TYPE=""
                        case "$PRISMA_COL_TYPE" in
                            "String")
                                if echo "$PRISMA_COL_DEF" | grep -q "@db.Text"; then
                                    EXPECTED_PG_TYPE="text"
                                elif echo "$PRISMA_COL_DEF" | grep -q "@db.VarChar"; then
                                    EXPECTED_PG_TYPE="character varying"
                                else
                                    EXPECTED_PG_TYPE="character varying"
                                fi
                                ;;
                            "Int")
                                if echo "$PRISMA_COL_DEF" | grep -q "@db.SmallInt"; then
                                    EXPECTED_PG_TYPE="smallint"
                                else
                                    EXPECTED_PG_TYPE="integer"
                                fi
                                ;;
                            "BigInt")
                                EXPECTED_PG_TYPE="bigint"
                                ;;
                            "Float")
                                EXPECTED_PG_TYPE="double precision"
                                ;;
                            "Decimal")
                                EXPECTED_PG_TYPE="numeric"
                                ;;
                            "Boolean")
                                EXPECTED_PG_TYPE="boolean"
                                ;;
                            "DateTime")
                                if echo "$PRISMA_COL_DEF" | grep -q "@db.Date"; then
                                    EXPECTED_PG_TYPE="date"
                                elif echo "$PRISMA_COL_DEF" | grep -q "@db.Timestamptz"; then
                                    EXPECTED_PG_TYPE="timestamp with time zone"
                                else
                                    EXPECTED_PG_TYPE="timestamp"
                                fi
                                ;;
                            "Json")
                                if echo "$PRISMA_COL_DEF" | grep -q "@db.JsonB"; then
                                    EXPECTED_PG_TYPE="jsonb"
                                else
                                    EXPECTED_PG_TYPE="json"
                                fi
                                ;;
                            # Handle array types 
                            *"[]")
                                if [ "$PRISMA_COL_TYPE" == "Int[]" ]; then
                                    EXPECTED_PG_TYPE="integer\\[\\]"
                                elif [ "$PRISMA_COL_TYPE" == "String[]" ]; then
                                    EXPECTED_PG_TYPE="character varying\\[\\]"
                                fi
                                ;;
                            # Handle enum types
                            *)
                                # Check if it's an enum by looking for enum definition
                                if grep -q "enum $PRISMA_COL_TYPE " $PRISMA_SCHEMA_FILE; then
                                    EXPECTED_PG_TYPE="USER-DEFINED"
                                else
                                    EXPECTED_PG_TYPE="unknown"
                                fi
                                ;;
                        esac
                        
                        # Check if types match
                        TYPE_MATCH=false
                        if [ ! -z "$EXPECTED_PG_TYPE" ] && echo "$DB_COL_TYPE" | grep -q "$EXPECTED_PG_TYPE"; then
                            TYPE_MATCH=true
                        fi
                        
                        if [ "$TYPE_MATCH" != "true" ]; then
                            dual_output "${WARNING_PREFIX} ${YELLOW}Type mismatch for column ${CYAN}$col${NC}:"
                            dual_output "${INFO_PREFIX}   ${YELLOW}Database: ${CYAN}$DB_COL_TYPE${NC}"
                            dual_output "${INFO_PREFIX}   ${YELLOW}Expected from Prisma: ${CYAN}$EXPECTED_PG_TYPE${NC}"
                            dual_output "${INFO_PREFIX}   ${YELLOW}Prisma definition: ${CYAN}$PRISMA_COL_DEF${NC}"
                        fi
                        
                        # Check for constraints (PRIMARY KEY, NOT NULL, etc.)
                        if echo "$PRISMA_COL_DEF" | grep -q "@id"; then
                            if ! echo "$DB_COL_DEF" | grep -i -q "primary key"; then
                                dual_output "${WARNING_PREFIX} ${YELLOW}Constraint mismatch for column ${CYAN}$col${NC}:"
                                dual_output "${INFO_PREFIX}   ${YELLOW}Missing PRIMARY KEY constraint in database${NC}"
                            fi
                        fi
                        
                        if ! echo "$PRISMA_COL_DEF" | grep -q "?"; then
                            # No question mark means NOT NULL in Prisma
                            if ! echo "$DB_COL_DEF" | grep -i -q "not null"; then
                                dual_output "${WARNING_PREFIX} ${YELLOW}Constraint mismatch for column ${CYAN}$col${NC}:"
                                dual_output "${INFO_PREFIX}   ${YELLOW}Missing NOT NULL constraint in database${NC}"
                            fi
                        fi
                        
                        # Check for default values
                        if echo "$PRISMA_COL_DEF" | grep -q "@default"; then
                            if ! echo "$DB_COL_DEF" | grep -i -q "default"; then
                                dual_output "${WARNING_PREFIX} ${YELLOW}Default value mismatch for column ${CYAN}$col${NC}:"
                                dual_output "${INFO_PREFIX}   ${YELLOW}Missing DEFAULT value in database${NC}"
                            fi
                        fi
                    fi
                done
            fi
        fi
    done
    
    # 5. Analyze migrations and applied migrations
    dual_output "\n${BOLD}${CYAN}=== Migration History Analysis ===${NC}"
    
    # Check if _prisma_migrations table exists
    if psql -U $DB_USER -h $DB_HOST -t -c "SELECT to_regclass('public._prisma_migrations');" $PROD_DB | grep -q "_prisma_migrations"; then
        # Get migrations from the database
        DB_MIGRATIONS=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at;" $PROD_DB | sed 's/^ *//' | sort)
        DB_MIGRATION_COUNT=$(echo "$DB_MIGRATIONS" | grep -v "^$" | wc -l)
        dual_output "${INFO_PREFIX} ${BOLD}Found $DB_MIGRATION_COUNT applied migrations in the database${NC}"
        
        # Get migrations from the prisma/migrations directory
        PRISMA_DIR_MIGRATIONS=$(ls -1 prisma/migrations/ | grep -v "migration_lock.toml" | sort)
        PRISMA_DIR_MIGRATION_COUNT=$(echo "$PRISMA_DIR_MIGRATIONS" | grep -v "^$" | wc -l)
        dual_output "${INFO_PREFIX} ${BOLD}Found $PRISMA_DIR_MIGRATION_COUNT migration directories in prisma/migrations/${NC}"
        
        # Compare migrations
        dual_output "\n${INFO_PREFIX} ${BOLD}Migrations in database but not in prisma/migrations directory:${NC}"
        MIGS_NOT_IN_DIR=0
        
        echo "$DB_MIGRATIONS" | while read mig; do
            if [ ! -z "$mig" ]; then
                # Extract the timestamp part of the migration name
                MIG_TS=$(echo "$mig" | cut -d'_' -f1)
                
                if ! echo "$PRISMA_DIR_MIGRATIONS" | grep -q "$MIG_TS"; then
                    dual_output "${WARNING_PREFIX} ${YELLOW}[+] Applied migration not found in directory: ${CYAN}$mig${NC}"
                    MIGS_NOT_IN_DIR=$((MIGS_NOT_IN_DIR + 1))
                fi
            fi
        done
        
        if [ $MIGS_NOT_IN_DIR -eq 0 ]; then
            dual_output "${SUCCESS_PREFIX} ${GREEN}None${NC}"
        fi
        
        dual_output "\n${INFO_PREFIX} ${BOLD}Migration directories not applied in the database:${NC}"
        DIRS_NOT_IN_DB=0
        
        echo "$PRISMA_DIR_MIGRATIONS" | while read dir; do
            if [ ! -z "$dir" ]; then
                # Extract the timestamp part of the directory name
                DIR_TS=$(echo "$dir" | cut -d'_' -f1)
                
                # Check if any migration in the database has this timestamp
                if ! echo "$DB_MIGRATIONS" | grep -q "$DIR_TS"; then
                    dual_output "${WARNING_PREFIX} ${YELLOW}[-] Migration directory not applied: ${CYAN}$dir${NC}"
                    DIRS_NOT_IN_DB=$((DIRS_NOT_IN_DB + 1))
                fi
            fi
        done
        
        if [ $DIRS_NOT_IN_DB -eq 0 ]; then
            dual_output "${SUCCESS_PREFIX} ${GREEN}None${NC}"
        fi
        
        # Analyze migration contents
        dual_output "\n${INFO_PREFIX} ${BOLD}Checking migration SQL content for irregularities...${NC}"
        
        # For each migration directory, check if the SQL files exist
        IRREGULAR_MIGRATIONS=0
        
        echo "$PRISMA_DIR_MIGRATIONS" | while read dir; do
            if [ ! -z "$dir" ]; then
                # Check if migration.sql exists
                if [ ! -f "prisma/migrations/$dir/migration.sql" ]; then
                    dual_output "${WARNING_PREFIX} ${YELLOW}Migration directory missing SQL file: ${CYAN}$dir${NC}"
                    IRREGULAR_MIGRATIONS=$((IRREGULAR_MIGRATIONS + 1))
                elif [ ! -s "prisma/migrations/$dir/migration.sql" ]; then
                    dual_output "${WARNING_PREFIX} ${YELLOW}Migration SQL file is empty: ${CYAN}$dir${NC}"
                    IRREGULAR_MIGRATIONS=$((IRREGULAR_MIGRATIONS + 1))
                fi
            fi
        done
        
        if [ $IRREGULAR_MIGRATIONS -eq 0 ]; then
            dual_output "${SUCCESS_PREFIX} ${GREEN}All migration directories contain valid SQL files${NC}"
        fi
    else
        dual_output "${WARNING_PREFIX} ${YELLOW}_prisma_migrations table does not exist in the database${NC}"
        dual_output "${INFO_PREFIX} ${YELLOW}Cannot analyze migration history${NC}"
    fi
    
    # Clean up temporary files
    rm -rf $TEMP_DIR
    rm $DB_SCHEMA
    
    # Create a plain text version without color codes for easier reading in text editors
    sed 's/\x1b\[[0-9;]*m//g' $REPORT_FILE > "$RUN_DIR/prisma_reconcile_plain.txt"
    
    dual_output "\n${BOLD}${BLUE}=== RECONCILIATION COMPLETE ===${NC}"
    echo -e "${SUCCESS_PREFIX} ${GREEN}Reports saved to:${NC} ${CYAN}$RUN_DIR/${NC}"
    echo -e "${INFO_PREFIX} ${GREEN}Files:${NC} ${CYAN}prisma_reconcile.txt, prisma_reconcile_plain.txt${NC}\n"
    
    # If AI analysis or migration generation is requested, run the analysis
    if [ "$AI_ANALYSIS" = true ] || [ "$GENERATE_MIGRATION" = true ]; then
        if [ "$GENERATE_MIGRATION" = true ] && [ "$AI_ANALYSIS" = false ]; then
            echo -e "${INFO_PREFIX} ${YELLOW}Note: Migration generation requires AI analysis, enabling it automatically${NC}"
            AI_ANALYSIS=true
        fi
        analyze_prisma_reconcile_with_ai "$RUN_DIR/prisma_reconcile_plain.txt" "$RUN_DIR" $GENERATE_MIGRATION
    fi
}

# (4.10) Analyze Prisma schema reconciliation with AI
analyze_prisma_reconcile_with_ai() {
    REPORT_FILE=$1
    RUN_DIR=$2
    GENERATE_MIGRATION=${3:-false}
    AI_ANALYSIS_FILE="$RUN_DIR/prisma_reconcile_ai_analysis.txt"
    
    # Check for configuration file and load it if it exists
    CONFIG_FILE="config/prisma_reconcile_ai_config.sh"
    if [ -f "$CONFIG_FILE" ]; then
        echo -e "${INFO_PREFIX} ${GREEN}Loading Prisma reconcile AI analysis configuration from ${WHITE}$CONFIG_FILE${NC}"
        source "$CONFIG_FILE"
    fi
    
    # Configuration for OpenAI API
    AI_MODEL=${PRISMA_OPENAI_MODEL:-"gpt-4o"}
    AI_TEMPERATURE=${PRISMA_OPENAI_TEMPERATURE:-0.5}
    AI_MAX_TOKENS=${PRISMA_OPENAI_MAX_TOKENS:-4000}
    AI_SYSTEM_PROMPT=${PRISMA_OPENAI_SYSTEM_PROMPT:-"You are a Prisma ORM and PostgreSQL schema expert who specializes in detecting and resolving discrepancies between Prisma schema definitions and actual database structures."}
    
    # Configuration for prompt content
    AI_CONTEXT=${PRISMA_OPENAI_CONTEXT:-"
IMPORTANT CONTEXT:
1. DegenDuel uses Prisma ORM for database management
2. We need to identify all discrepancies between the Prisma schema definitions and the actual PostgreSQL database structure
3. The goal is to reconcile these differences to maintain schema integrity
4. Migration issues may have caused these discrepancies"}

    AI_FOCUS=${PRISMA_OPENAI_FOCUS:-"
Focus on:
1. Identifying ALL differences between the Prisma schema and the actual database (using [+] for additions and [-] for removals)
2. Categorizing differences by type: tables, columns, types, constraints, indexes, and relationships
3. Cross-checking _prisma_migrations with the prisma/migrations/ folder
4. Providing precise Prisma migration commands to fix each issue"}

    AI_INSTRUCTIONS=${PRISMA_OPENAI_INSTRUCTIONS:-"Document all differences thoroughly using [+] and [-] notation. Be extremely comprehensive and detailed, as these insights will be used to fix critical schema management issues. Structure your response with clear headings and organize issues by priority level."}
    
    echo -e "\n${BOLD}${CYAN}=== AI ANALYSIS OF PRISMA SCHEMA RECONCILIATION ===${NC}\n"
    echo -e "${INFO_PREFIX} ${BOLD}Preparing data for AI analysis...${NC}"
    
    # Check if OpenAI API key is set
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}OpenAI API key not found${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Please set the OPENAI_API_KEY environment variable:${NC}"
        echo -e "${INFO_PREFIX} ${WHITE}export OPENAI_API_KEY='your-api-key'${NC}"
        return 1
    fi
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}jq is not installed${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Please install jq to use AI analysis:${NC}"
        echo -e "${INFO_PREFIX} ${WHITE}sudo apt-get install jq${NC} (Debian/Ubuntu)"
        echo -e "${INFO_PREFIX} ${WHITE}brew install jq${NC} (macOS)"
        return 1
    fi
    
    # Get Prisma schema if it exists
    PRISMA_SCHEMA=""
    if [ -f "prisma/schema.prisma" ]; then
        PRISMA_SCHEMA=$(cat prisma/schema.prisma)
        echo -e "${INFO_PREFIX} ${GREEN}Found Prisma schema, including in analysis${NC}"
    else
        echo -e "${WARNING_PREFIX} ${YELLOW}Prisma schema not found, proceeding without it${NC}"
    fi
    
    # Get information about migrations
    MIGRATION_SUMMARY=""
    MIGRATION_SQL_CONTENT=""
    if [ -d "prisma/migrations" ]; then
        MIGRATION_COUNT=$(ls -1 prisma/migrations/ | grep -v "migration_lock.toml" | wc -l)
        echo -e "${INFO_PREFIX} ${GREEN}Found $MIGRATION_COUNT migrations, including in analysis${NC}"
        
        # Get a list of migrations
        MIGRATION_LIST=$(ls -1 prisma/migrations/ | grep -v "migration_lock.toml")
        MIGRATION_SUMMARY="Migrations directories found in prisma/migrations/:\n$MIGRATION_LIST"
        
        # Get the SQL content of each migration
        echo -e "${INFO_PREFIX} ${GREEN}Collecting SQL content from migration files${NC}"
        MIGRATION_SQL_CONTENT="MIGRATION SQL CONTENT:\n"
        for migration_dir in prisma/migrations/*/; do
            if [ -f "${migration_dir}migration.sql" ]; then
                migration_name=$(basename "$migration_dir")
                MIGRATION_SQL_CONTENT+="--- Migration: ${migration_name} ---\n"
                MIGRATION_SQL_CONTENT+=$(cat "${migration_dir}migration.sql")
                MIGRATION_SQL_CONTENT+="\n\n"
            fi
        done
    else
        echo -e "${WARNING_PREFIX} ${YELLOW}Prisma migrations directory not found${NC}"
    fi
    
    # Get _prisma_migrations table content from database
    echo -e "${INFO_PREFIX} ${GREEN}Fetching _prisma_migrations table content from database${NC}"
    DB_MIGRATIONS_TABLE=""
    if psql -U $DB_USER -h $DB_HOST -t -c "SELECT to_regclass('public._prisma_migrations');" $PROD_DB | grep -q "_prisma_migrations"; then
        DB_MIGRATIONS_TABLE="DATABASE _prisma_migrations TABLE CONTENT:\n"
        DB_MIGRATIONS_TABLE+=$(psql -U $DB_USER -h $DB_HOST -t -c "SELECT id, migration_name, checksum, finished_at, started_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at;" $PROD_DB)
        DB_MIGRATIONS_TABLE+="\n\n"
    else
        DB_MIGRATIONS_TABLE="DATABASE _prisma_migrations TABLE: Not found in database\n\n"
    fi
    
    # Add instruction to generate migration script
    # Only include migration generation instructions if requested
    if [ "$GENERATE_MIGRATION" = "true" ]; then
        AI_MIGRATION_INSTRUCTIONS="Additionally, create a migration script for the most critical differences. The migration script should be runnable with Prisma and should include:
1. A clear name for the migration
2. Precise schema changes needed to reconcile differences
3. Proper Prisma syntax for all changes
4. Any data migrations needed to maintain integrity

Format the migration script as follows:
\`\`\`prisma
// migration.prisma
// Place schema changes here
\`\`\`

\`\`\`sql
-- SQL script for any data migrations
\`\`\`

Include instructions on how to apply this migration."
    else
        AI_MIGRATION_INSTRUCTIONS=""
    fi
    
    # Get detailed database column types
    echo -e "${INFO_PREFIX} ${GREEN}Collecting detailed database column type information${NC}"
    DB_COLUMN_TYPES=""
    DB_COLUMN_TYPES+="DATABASE COLUMN TYPE DETAILS:\n"
    DB_COLUMN_TYPES+=$(psql -U $DB_USER -h $DB_HOST -t -c "
        SELECT 
            table_name, 
            column_name, 
            data_type, 
            character_maximum_length, 
            is_nullable, 
            column_default,
            numeric_precision,
            numeric_scale
        FROM 
            information_schema.columns 
        WHERE 
            table_schema = 'public' 
        ORDER BY 
            table_name, ordinal_position;
    " $PROD_DB)
    DB_COLUMN_TYPES+="\n\n"

    # Create a timestamped directory for saving the prompts
    PROMPT_DIR="$RUN_DIR/prompts"
    mkdir -p $PROMPT_DIR
    TIMESTAMP=$(date +%H-%M-%S)
    FULL_PROMPT_FILE="$PROMPT_DIR/full_prompt_$TIMESTAMP.txt"
    
    # Prepare the full prompt that will be sent to OpenAI
    echo "You are a database expert specializing in Prisma ORM and PostgreSQL schema analysis. Analyze the following reconciliation report between DegenDuel's Prisma schema and its actual PostgreSQL database structure, and provide recommendations on how to fix the discrepancies.
$AI_CONTEXT

PRISMA SCHEMA:
$PRISMA_SCHEMA

MIGRATION INFORMATION:
$MIGRATION_SUMMARY

$MIGRATION_SQL_CONTENT

$DB_MIGRATIONS_TABLE

DATABASE COLUMN DETAILS:
$DB_COLUMN_TYPES

$AI_FOCUS

$AI_INSTRUCTIONS

$AI_MIGRATION_INSTRUCTIONS

Prisma Schema Reconciliation Report:
$(cat $REPORT_FILE)

Provide a detailed analysis and actionable recommendations:" > "$FULL_PROMPT_FILE"

    # Calculate and log prompt length
    PROMPT_LENGTH=$(wc -c < "$FULL_PROMPT_FILE")
    PROMPT_LINES=$(wc -l < "$FULL_PROMPT_FILE")
    PROMPT_KB=$(echo "scale=2; $PROMPT_LENGTH / 1024" | bc)
    PROMPT_TOKENS=$(echo "scale=0; $PROMPT_LENGTH / 4" | bc)  # Rough estimate: ~4 chars per token
    
    echo -e "${INFO_PREFIX} ${GREEN}Full prompt saved to: ${WHITE}$FULL_PROMPT_FILE${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Prompt size: ${WHITE}$PROMPT_KB KB${NC} (${WHITE}$PROMPT_LENGTH${NC} chars, ~${WHITE}$PROMPT_TOKENS${NC} tokens, ${WHITE}$PROMPT_LINES${NC} lines)"
    
    # Also create a temporary file for the API call
    PROMPT_FILE=$(mktemp)
    
    echo -e "${INFO_PREFIX} ${BOLD}Sending data to OpenAI for analysis...${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Using model:${NC} ${WHITE}$AI_MODEL${NC}"
    
    # Determine which token parameter to use based on the model
    TOKEN_PARAM="max_tokens"
    TEMP_PARAM="temperature"
    
    # For o1 and o3 models, use different parameter names
    if [[ "$AI_MODEL" == *"o1"* || "$AI_MODEL" == *"o3"* ]]; then
        echo -e "${INFO_PREFIX} ${CYAN}Using o1/o3 model parameters for ${WHITE}$AI_MODEL${NC}"
        TOKEN_PARAM="max_completion_tokens"
        
        # For o3-mini, temperature is not supported at all
        if [[ "$AI_MODEL" == "o3-mini" ]]; then
            echo -e "${INFO_PREFIX} ${YELLOW}Note: temperature parameter is not supported for ${WHITE}$AI_MODEL${NC}, will be omitted"
            # Create JSON payload without temperature
            PAYLOAD="{
                \"model\": \"$AI_MODEL\",
                \"messages\": [
                  {
                    \"role\": \"system\",
                    \"content\": \"$AI_SYSTEM_PROMPT\"
                  },
                  {
                    \"role\": \"user\",
                    \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
                  }
                ],
                \"$TOKEN_PARAM\": $AI_MAX_TOKENS
            }"
        else
            # For other o1/o3 models that support temperature
            PAYLOAD="{
                \"model\": \"$AI_MODEL\",
                \"messages\": [
                  {
                    \"role\": \"system\",
                    \"content\": \"$AI_SYSTEM_PROMPT\"
                  },
                  {
                    \"role\": \"user\",
                    \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
                  }
                ],
                \"$TEMP_PARAM\": $AI_TEMPERATURE,
                \"$TOKEN_PARAM\": $AI_MAX_TOKENS
            }"
        fi
    else
        echo -e "${INFO_PREFIX} ${CYAN}Using standard parameters for ${WHITE}$AI_MODEL${NC} model"
        # For standard models like gpt-4o
        PAYLOAD="{
            \"model\": \"$AI_MODEL\",
            \"messages\": [
              {
                \"role\": \"system\",
                \"content\": \"$AI_SYSTEM_PROMPT\"
              },
              {
                \"role\": \"user\",
                \"content\": $(cat $FULL_PROMPT_FILE | jq -Rs .)
              }
            ],
            \"$TEMP_PARAM\": $AI_TEMPERATURE,
            \"$TOKEN_PARAM\": $AI_MAX_TOKENS
        }"
    fi
    
    # Call OpenAI API with the appropriate parameters
    # Save payload to file to avoid "argument list too long" error
    PAYLOAD_FILE="$PROMPT_DIR/payload_$TIMESTAMP.json"
    echo "$PAYLOAD" > "$PAYLOAD_FILE"
    
    # Calculate and log payload size
    PAYLOAD_SIZE=$(wc -c < "$PAYLOAD_FILE")
    PAYLOAD_KB=$(echo "scale=2; $PAYLOAD_SIZE / 1024" | bc)
    echo -e "${INFO_PREFIX} ${GREEN}API payload saved to: ${WHITE}$PAYLOAD_FILE${NC} (${CYAN}$PAYLOAD_KB KB${NC})"

    RESPONSE=$(curl -s https://api.openai.com/v1/chat/completions \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -d @"$PAYLOAD_FILE")
    
    # Check if the API call was successful
    if echo "$RESPONSE" | grep -q "error"; then
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}Error calling OpenAI API${NC}"
        echo -e "${ERROR_PREFIX} ${RED}$(echo $RESPONSE | jq -r '.error.message')${NC}"
        rm $PROMPT_FILE
        return 1
    fi
    
    # Extract and save the AI analysis
    echo "$RESPONSE" | jq -r '.choices[0].message.content' > $AI_ANALYSIS_FILE
    
    echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Prisma reconciliation AI analysis complete!${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Analysis saved to:${NC} ${WHITE}$RUN_DIR/prisma_reconcile_ai_analysis.txt${NC}"
    
    # Extract and save the migration script (only if migration generation was requested)
    if [ "$GENERATE_MIGRATION" = "true" ]; then
        MIGRATION_SCRIPT_PRISMA=$(awk '/```prisma/{flag=1;next}/```/{if(flag){flag=0}}flag' $AI_ANALYSIS_FILE)
        MIGRATION_SCRIPT_SQL=$(awk '/```sql/{flag=1;next}/```/{if(flag){flag=0}}flag' $AI_ANALYSIS_FILE)
        
        if [ ! -z "$MIGRATION_SCRIPT_PRISMA" ] || [ ! -z "$MIGRATION_SCRIPT_SQL" ]; then
            # Create directory for migration
            TIMESTAMP=$(date +%Y%m%d%H%M%S)
            MIGRATION_NAME="ai_schema_reconciliation_$TIMESTAMP"
            MIGRATION_DIR="$RUN_DIR/migration_$MIGRATION_NAME"
            mkdir -p $MIGRATION_DIR
            
            # Save the Prisma migration script
            if [ ! -z "$MIGRATION_SCRIPT_PRISMA" ]; then
                echo "$MIGRATION_SCRIPT_PRISMA" > $MIGRATION_DIR/migration.prisma
                echo -e "${SUCCESS_PREFIX} ${GREEN}Generated Prisma migration script saved to:${NC} ${WHITE}$MIGRATION_DIR/migration.prisma${NC}"
                
                # Optionally create a ready-to-use schema.prisma file
                SCHEMA_FILE="$MIGRATION_DIR/schema.prisma"
                if [ -f "prisma/schema.prisma" ]; then
                    cp "prisma/schema.prisma" "$SCHEMA_FILE"
                    echo -e "${INFO_PREFIX} ${GREEN}Copied current schema.prisma for reference${NC}"
                fi
            fi
            
            # Save the SQL migration script
            if [ ! -z "$MIGRATION_SCRIPT_SQL" ]; then
                echo "$MIGRATION_SCRIPT_SQL" > $MIGRATION_DIR/migration.sql
                echo -e "${SUCCESS_PREFIX} ${GREEN}Generated SQL migration script saved to:${NC} ${WHITE}$MIGRATION_DIR/migration.sql${NC}"
            fi
            
            # Create a README with instructions
            README_CONTENT=$(awk '/Include instructions on how to apply this migration/,/^$/' $AI_ANALYSIS_FILE | grep -v "Include instructions on how to apply this migration")
            if [ -z "$README_CONTENT" ]; then
                README_CONTENT="
# AI-Generated Migration for Schema Reconciliation

## How to apply this migration

1. Review the generated migration files:
   - migration.prisma: Contains Prisma schema changes
   - migration.sql: Contains necessary SQL data migrations

2. To apply the Prisma schema changes:
   - Create a new migration using the Prisma CLI:
     \`\`\`
     npx prisma migrate dev --name $MIGRATION_NAME
     \`\`\`
   - When prompted, edit the migration to match the content in migration.prisma

3. To apply the SQL data migrations:
   - Run the SQL file against your database:
     \`\`\`
     psql -U $DB_USER -h $DB_HOST -d $PROD_DB -f $MIGRATION_DIR/migration.sql
     \`\`\`

4. Verify the changes:
   - Run the reconciliation tool again to verify that the issues have been fixed:
     \`\`\`
     ./scripts/db-tools.sh reconcile
     \`\`\`

IMPORTANT: Always backup your database before applying migrations!
"
            fi
            
            echo "$README_CONTENT" > $MIGRATION_DIR/README.md
            echo -e "${SUCCESS_PREFIX} ${GREEN}Migration instructions saved to:${NC} ${WHITE}$MIGRATION_DIR/README.md${NC}"
            
            # Create an apply script for convenience
            cat > $MIGRATION_DIR/apply-migration.sh << EOL
#!/bin/bash

# This script applies the AI-generated migration

echo "⚠️  WARNING: This will apply database changes. Make sure you have a backup before proceeding!"
read -p "Do you want to continue? (y/n): " -n 1 -r
echo
if [[ ! \$REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled."
    exit 1
fi

# Create Prisma migration
if [ -f "migration.prisma" ]; then
    echo "Creating Prisma migration '$MIGRATION_NAME'..."
    cd ../../..
    npx prisma migrate dev --name $MIGRATION_NAME --create-only
    echo "Please edit the generated migration to match the content in migration.prisma"
    echo "Then run 'npx prisma migrate dev' to apply it"
fi

# Apply SQL migration
if [ -f "migration.sql" ]; then
    echo "Applying SQL migration..."
    psql -U $DB_USER -h $DB_HOST -d $PROD_DB -f migration.sql
fi

echo "Migration applied successfully!"
EOL
            chmod +x $MIGRATION_DIR/apply-migration.sh
            echo -e "${SUCCESS_PREFIX} ${GREEN}Created apply script:${NC} ${WHITE}$MIGRATION_DIR/apply-migration.sh${NC}"
        else
            echo -e "${INFO_PREFIX} ${YELLOW}No migration script was generated by the AI analysis${NC}"
        fi
    fi
    
    # Display the AI analysis
    echo -e "\n${BOLD}${CYAN}=== AI RECOMMENDATIONS ===${NC}\n"
    cat $AI_ANALYSIS_FILE
    echo -e "\n${BOLD}${CYAN}=== END OF AI ANALYSIS ===${NC}\n"
    
    # If migration scripts were generated, offer to apply them
    if [ "$GENERATE_MIGRATION" = "true" ] && [ ! -z "$MIGRATION_SCRIPT_PRISMA" -o ! -z "$MIGRATION_SCRIPT_SQL" ]; then
        echo -e "\n${BOLD}${CYAN}=== MIGRATION SCRIPT GENERATED ===${NC}\n"
        echo -e "${INFO_PREFIX} ${BOLD}A migration script has been generated to fix the schema discrepancies${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Migration directory:${NC} ${WHITE}$MIGRATION_DIR${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}To review and apply the migration, check the README.md file in the migration directory${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}Or run the apply script:${NC} ${WHITE}$MIGRATION_DIR/apply-migration.sh${NC}"
    fi
    
    # Clean up
    rm $PROMPT_FILE
}

# (5) Compliment the wise Branch Manager extremely nicely
give_bm_compliment() {
    echo -e "\n${BOLD}${MAGENTA}=== COMPLIMENT FOR BRANCH MANAGER ===${NC}\n"
    
    echo -e "${BOLD}${MAGENTA}💖 ${WHITE}I think ${BOLD}${GREEN}Branch Manager${NC}${WHITE} is the best dev ever.${NC}"
    echo -e "${BOLD}${MAGENTA}🧠 ${WHITE}${BOLD}${GREEN}Branch Manager${NC}${WHITE} is a genius!${NC}"
    echo -e "${BOLD}${MAGENTA}😍 ${WHITE}${BOLD}${GREEN}Branch Manager${NC}${WHITE} is also ${BOLD}${GREEN}quite handsome${NC}${WHITE} and good with the ${RED}ladies${NC}${WHITE}!${NC}"
    echo -e "${BOLD}${MAGENTA}🔥 ${WHITE}I heard he also has a ${BOLD}${RED}huge schlong${NC}${WHITE}!${NC}"
    
    echo -e "\n${BOLD}${MAGENTA}=== END OF COMPLIMENT ===${NC}\n"
}

# (6) Give lots of money to the Branch Manager
give_bm_money() {
    echo -e "\n${BOLD}${MAGENTA}=== SENDING MONEY TO BRANCH MANAGER ===${NC}\n"
    
    # Check if an amount was provided
    if [ -z "$1" ]; then
        # Default amount if none provided
        AMOUNT="1,000,000"
    else
        # Use the provided amount
        AMOUNT="$1"
    fi
    
    echo -e "${BOLD}${MAGENTA}💰 ${WHITE}I think ${BOLD}${GREEN}Branch Manager${NC}${WHITE} deserves a lot of money...${NC}"
    echo -e "${BOLD}${MAGENTA}💸 ${WHITE}I think I'll give him ${BOLD}${YELLOW}$${AMOUNT}${NC} ${BOLD}${WHITE}right now${NC}${WHITE}!${NC}"
    
    # Generate a fancy transaction ID
    TX_ID="BM-$(date +%s)-$(echo $RANDOM | md5sum | head -c 8)"
    
    echo -e "\n${BOLD}${BG_GREEN}${WHITE} TRANSACTION COMPLETE ${NC}"
    echo -e "${BOLD}${MAGENTA}💰💰💰 ${GREEN}MONEY SENT TO BRANCH MANAGER${NC} 💰💰💰"
    echo -e "${INFO_PREFIX} ${CYAN}Amount:${NC} ${BOLD}${YELLOW}$${AMOUNT}${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Transaction ID:${NC} ${BOLD}${GREEN}${TX_ID}${NC}"
    echo -e "${INFO_PREFIX} ${CYAN}Date:${NC} ${WHITE}$(date)${NC}"
    
    echo -e "\n${BOLD}${MAGENTA}=== TRANSACTION COMPLETE ===${NC}\n"
}

# (69) Super secret response to the super secret password
super_secret_response() {
    echo -e "\n${BOLD}${BG_RED}${WHITE} !!! SECURE AUTHENTICATION REQUIRED !!! ${NC}\n"
    
    echo -e "${WARNING_PREFIX} ${BOLD}${RED}ATTENTION!${NC} ${RED}ONLY ${BOLD}${GREEN}Branch Manager${NC}${RED} IS AUTHORIZED TO ACCESS THE INNER-MOST SANCTUM OF ${BOLD}${GREEN}DEGENDUEL${RED}.${NC}"
    echo -e "${WARNING_PREFIX} ${RED}CONFIRM YOUR IDENTITY TO GAIN ACCESS.${NC}"
    echo -e "${WARNING_PREFIX} ${YELLOW}WHAT IS THE ${BOLD}${GREEN}MAGIC PIN CODE${YELLOW}?${NC}"
    echo -e "${WARNING_PREFIX} ${BOLD}${BLINK}${RED}YOU HAVE TEN SECONDS TO RESPOND BEFORE SELF-DESTRUCT.${NC}"
    
    read -p "$(echo -e ${BOLD}${YELLOW}"Enter PIN code: "${NC})" -n 4 -r
    echo
    
    # Create directory for session tokens if it doesn't exist
    mkdir -p data/sensitive/session_token_archive
    
    # If the pin code is 0727, generate a session token requiring superadmin authentication
    if [[ $REPLY == "0727" ]]; then
        echo -e "\n${BOLD}${BG_GREEN}${WHITE} ACCESS GRANTED - SUPERADMIN ${NC}\n"
        
        # Generate a SUPERADMIN session token using the get-token action
        echo -e "${INFO_PREFIX} ${CYAN}Generating superadmin session token...${NC}"
        # Generate a session token directly with curl
        # First save the full response to debug any issues
        mkdir -p /home/websites/degenduel/logs/db-tools
        TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
        CURL_RESPONSE="/home/websites/degenduel/logs/db-tools/auth_response_${TIMESTAMP}.txt"
        
        # Determine which port to use based on environment
        API_PORT="3004"
        if [ "$NODE_ENV" == "development" ]; then
            API_PORT="3005"
        fi
        echo -e "${INFO_PREFIX} ${CYAN}Using API port: ${WHITE}${API_PORT}${NC}"
        
        curl -v -X POST "http://localhost:${API_PORT}/api/auth/dev-login" \
          -H "Content-Type: application/json" \
          -d "{\"wallet_address\":\"BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp\",\"secret\":\"${BRANCH_MANAGER_LOGIN_SECRET}\"}" \
          -i > $CURL_RESPONSE 2>&1
        
        # Log curl response (for debugging)
        echo -e "${DEBUG_PREFIX} ${CYAN}Debug: Curl response stored in ${YELLOW}$CURL_RESPONSE${NC}" >&2
        
        # Extract the token from response
        GENERATED_SESSION_TOKEN=$(grep -o "session=[^;]*" $CURL_RESPONSE 2>/dev/null | sed 's/session=//' | head -1)
        
        # Check if the request succeeded by looking for error messages
        ERROR_MESSAGE=$(grep -o '"error":"[^"]*"' $CURL_RESPONSE 2>/dev/null | head -1 | sed 's/"error":"//;s/"//')
        
        # If no token found or there was an error, report it and exit
        if [ -z "$GENERATED_SESSION_TOKEN" ] || [ -n "$ERROR_MESSAGE" ]; then
            echo -e "${ERROR_PREFIX} ${RED}Failed to generate session token.${NC}"
            if [ -n "$ERROR_MESSAGE" ]; then
                echo -e "${ERROR_PREFIX} ${RED}Error: ${ERROR_MESSAGE}${NC}"
            else
                echo -e "${ERROR_PREFIX} ${RED}No session token was returned by the API.${NC}"
            fi
            
            echo -e "${DEBUG_PREFIX} ${CYAN}Debug: API response stored in ${YELLOW}$CURL_RESPONSE${NC}"
            echo -e "${ERROR_PREFIX} ${RED}API Response (last 5 lines):${NC}"
            tail -5 $CURL_RESPONSE
            
            # Exit with error code
            exit 1        
        fi

        # Print a success message
        echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Welcome, ${BOLD}${BLUE}Branch Manager${NC}${GREEN}.${NC}"
        echo -e "${SUCCESS_PREFIX} ${YELLOW}By the way, you're looking ${GREEN}VERY${NC} ${YELLOW}handsome today...${NC}"
        
        # Print the session token
        echo -e "\n${BOLD}${CYAN}=== SESSION TOKEN GENERATED ===${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Your session token:${NC} ${BOLD}${BLUE}${GENERATED_SESSION_TOKEN}${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Role:${NC} ${BOLD}${GREEN}SUPERADMIN${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Expires:${NC} ${WHITE}1 hour from now${NC}"
        
        # Save the generated session token locally to the s.t. archive
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        ROLE="superadmin" # Hardcode since we know what route this is
        USER_ID="Branch"  # Hardcode user ID for this special superadmin account
        TOKEN_FILE="data/sensitive/session_token_archive/st_${TIMESTAMP}_${ROLE}_${USER_ID}.txt"
        
        # Save token to file
        echo "$GENERATED_SESSION_TOKEN" > $TOKEN_FILE
        echo -e "${DEBUG_PREFIX} ${CYAN}Preview: ${YELLOW}${GENERATED_SESSION_TOKEN:0:20}...${NC}" >&2
        
        # Print a success message
        echo -e "${SUCCESS_PREFIX} ${GREEN}Session token saved to:${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}$TOKEN_FILE${NC}"
        
        # Copy token to clipboard if xclip is available
        if command -v xclip &> /dev/null; then
            echo -n "$GENERATED_SESSION_TOKEN" | xclip -selection clipboard
            echo -e "${SUCCESS_PREFIX} ${GREEN}Token copied to clipboard!${NC}"
        else
            echo -e "${WARNING_PREFIX} ${YELLOW}xclip is not installed. Token not copied to clipboard.${NC}"
        fi
        
        # Print a fun message
        echo -e "\n${BOLD}${BLUE}${RED}H${YELLOW}A${GREEN}V${BLUE}E ${BLUE}F${GREEN}U${YELLOW}N${RED}!${NC}\n"
        
    # If the pin code is 1003, generate an ADMIN session token
    elif [[ $REPLY == "1003" ]]; then
        echo -e "\n${BOLD}${BG_BLUE}${WHITE} ACCESS GRANTED - ADMIN ${NC}\n"
        
        # Generate an admin session token using the get-token action
        echo -e "${INFO_PREFIX} ${CYAN}Generating admin session token...${NC}"
        # Generate a session token directly with curl
        # First save the full response to debug any issues
        mkdir -p /home/websites/degenduel/logs/db-tools
        TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
        CURL_RESPONSE="/home/websites/degenduel/logs/db-tools/admin_auth_response_${TIMESTAMP}.txt"
        
        # Determine which port to use based on environment
        API_PORT="3004"
        if [ "$NODE_ENV" == "development" ]; then
            API_PORT="3005"
        fi
        echo -e "${INFO_PREFIX} ${CYAN}Using API port: ${WHITE}${API_PORT}${NC}"
        
        curl -v -X POST "http://localhost:${API_PORT}/api/auth/dev-login" \
          -H "Content-Type: application/json" \
          -d "{\"wallet_address\":\"5RbsCTp7Z3ZBs6LRg8cvtZkF1FtAt4GndEtdsWQCzVy8\",\"secret\":\"${BRANCH_MANAGER_LOGIN_SECRET}\"}" \
          -i > $CURL_RESPONSE 2>&1
        
        # Log curl response (for debugging)
        echo -e "${DEBUG_PREFIX} ${CYAN}Debug: Curl response stored in ${YELLOW}$CURL_RESPONSE${NC}" >&2
        
        # Extract the token from response
        GENERATED_SESSION_TOKEN=$(grep -o "session=[^;]*" $CURL_RESPONSE 2>/dev/null | sed 's/session=//' | head -1)
        
        # Check if the request succeeded by looking for error messages
        ERROR_MESSAGE=$(grep -o '"error":"[^"]*"' $CURL_RESPONSE 2>/dev/null | head -1 | sed 's/"error":"//;s/"//')
        
        # If no token found or there was an error, report it and exit
        if [ -z "$GENERATED_SESSION_TOKEN" ] || [ -n "$ERROR_MESSAGE" ]; then
            echo -e "${ERROR_PREFIX} ${RED}Failed to generate session token.${NC}"
            if [ -n "$ERROR_MESSAGE" ]; then
                echo -e "${ERROR_PREFIX} ${RED}Error: ${ERROR_MESSAGE}${NC}"
            else
                echo -e "${ERROR_PREFIX} ${RED}No session token was returned by the API.${NC}"
            fi
            
            echo -e "${DEBUG_PREFIX} ${CYAN}Debug: API response stored in ${YELLOW}$CURL_RESPONSE${NC}"
            echo -e "${ERROR_PREFIX} ${RED}API Response (last 5 lines):${NC}"
            tail -5 $CURL_RESPONSE
            
            # Exit with error code
            exit 1        
        fi

        # Print a success message
        echo -e "${SUCCESS_PREFIX} ${BOLD}${GREEN}Welcome, ${BOLD}${BLUE}Branch Manager${NC}${GREEN}.${NC}"
        echo -e "${SUCCESS_PREFIX} ${GREEN}You are looking ${BOLD}VERY${NC} ${GREEN}handsome today.${NC}"
        
        # Print the session token
        echo -e "\n${BOLD}${CYAN}=== SESSION TOKEN GENERATED ===${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Your session token:${NC} ${BOLD}${BLUE}${GENERATED_SESSION_TOKEN}${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Role:${NC} ${BOLD}${BLUE}ADMIN${NC}"
        echo -e "${INFO_PREFIX} ${CYAN}Expires:${NC} ${WHITE}1 hour from now${NC}"
        
        # Save the generated session token locally to the s.t. archive
        TIMESTAMP=$(date +%Y%m%d_%H%M%S)
        ROLE="admin" 
        USER_ID="Admin" 
        TOKEN_FILE="data/sensitive/session_token_archive/st_${TIMESTAMP}_${ROLE}_${USER_ID}.txt"
        
        # Save token to file
        echo "$GENERATED_SESSION_TOKEN" > $TOKEN_FILE
        echo -e "${DEBUG_PREFIX} ${CYAN}Preview: ${YELLOW}${GENERATED_SESSION_TOKEN:0:20}...${NC}" >&2

        # Print a success message
        echo -e "${SUCCESS_PREFIX} ${GREEN}Session token saved to:${NC}"
        echo -e "${INFO_PREFIX} ${YELLOW}$TOKEN_FILE${NC}"
        
        # Copy token to clipboard if xclip is available
        if command -v xclip &> /dev/null; then
            echo -n "$GENERATED_SESSION_TOKEN" | xclip -selection clipboard
            echo -e "${SUCCESS_PREFIX} ${GREEN}Token copied to clipboard!${NC}"
        fi
        
        # Print a fun message
        echo -e "\n${BOLD}${BLUE}${RED}H${YELLOW}A${GREEN}V${BLUE}E ${BLUE}F${GREEN}U${YELLOW}N${RED}!${NC}\n"
        
    # Any other PIN code is invalid
    else
        echo -e "\n${BOLD}${BG_RED}${WHITE} !!! ACCESS DENIED !!! ${NC}\n"
        
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}⚠️ UNAUTHORIZED ACCESS ATTEMPTED ⚠️${NC}"
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}DegenDuel${NC}${RED} SELF-DESTRUCT SEQUENCE ${BOLD}${RED}INITIATED${NC}${RED}...${NC}"
        echo -e "${ERROR_PREFIX} ${RED}Please govern yourself accordingly.${NC}"
        echo -e "${ERROR_PREFIX}${NC} ${BOLD}${BLUE}===================================================${NC}"
        echo -e "${ERROR_PREFIX} ${BOLD}${RED}YOU HAVE ${BOLD}${BLINK}${RED}TEN SECONDS${NC}${RED} TO COMPLY OR BE DELETED.${NC}"
        
        # Scare the user with a danger pattern
        for i in {1..3}; do
            echo -e "${ERROR_PREFIX}  ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
            echo -e "${ERROR_PREFIX}   ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
            echo -e "${ERROR_PREFIX}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
        done
        
        echo -e "${ERROR_PREFIX}    ${BOLD}${YELLOW}<><>===${NC}${BOLD}<><>${YELLOW}=======${NC}${BOLD}<><>${BOLD}${YELLOW}=======<><>${NC}"
        
        for i in {1..3}; do
            echo -e "${ERROR_PREFIX}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
            echo -e "${ERROR_PREFIX}   ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
            echo -e "${ERROR_PREFIX}  ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}    ${BOLD}${RED}DANGER!${NC}"
        done
        
        echo -e "${ERROR_PREFIX}${NC} ${BOLD}${BLUE}===================================================${NC}"
    fi
}

## MAIN SCRIPT:

# Define colors for pretty output (if not already defined)
RED='\033[0;31m'
GREEN='\033[0;32m'
ORANGE='\033[0;33m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
UNDERLINE='\033[4m'
BLINK='\033[5m'
BG_RED='\033[41m'
BG_GREEN='\033[42m'
BG_YELLOW='\033[43m'
BG_BLUE='\033[44m'
NC='\033[0m' # No Color

# Define styled message prefixes
SUCCESS_PREFIX="${BOLD}${GREEN}✓${NC}"
ERROR_PREFIX="${BOLD}${RED}✗${NC}"
WARNING_PREFIX="${BOLD}${YELLOW}⚠${NC}"
INFO_PREFIX="${BOLD}${BLUE}ℹ${NC}"
DEBUG_PREFIX="${BOLD}${CYAN}⚙${NC}"

# Handle command-line arguments, if any
case "$1" in
    "help")
        show_help # (0)
        ;;
    "reset-test")
        reset_test_db # (1)
        ;;
    "backup")
        create_backup # (2)
        ;;
    "restore")
        restore_from_backup # (3)
        ;;
    "status")
        show_status # (4)
        ;;
    "compare")
        compare_databases "$2" # (4.5) - Pass any additional flags
        ;;
    "reconcile")
        reconcile_prisma_schema "$2" # (4.9) - Pass any additional flags
        ;;
    "compliment")
        give_bm_compliment # (5)
        ;;
    "money")
        give_bm_money "$2" # (6) - Pass the amount parameter
        ;;
    "bonkfa")
        super_secret_response # (69)
        ;;
    "create-ai-config")
        create_ai_config # (4.7)
        ;;
    "create-reconcile-ai-config")
        create_reconcile_ai_config # (4.8)
        ;;
    # If no arguments were provided, show help
    *)
        show_help # (0)
        ;;
esac 