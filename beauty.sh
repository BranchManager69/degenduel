#!/bin/bash

# ANSI color codes and cursor control
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'
UP='\033[1A'
DOWN='\033[1B'

# Meteor shower animation
meteor_shower() {
    local lines=15
    local cols=$(tput cols)
    local duration=3
    local end=$((SECONDS + duration))

    # Clear space for meteor shower
    for ((i=0; i<lines; i++)); do
        echo
    done
    
    while [ $SECONDS -lt $end ]; do
        for ((i=0; i<lines; i++)); do
            printf "${UP}"
        done
        
        for ((i=0; i<lines; i++)); do
            local spaces=$((RANDOM % cols))
            local meteor_len=$((RANDOM % 10 + 1))
            printf "%${spaces}s" ""
            for ((j=0; j<meteor_len; j++)); do
                if [ $j -eq 0 ]; then
                    printf "${YELLOW}*${NC}"
                else
                    printf "${BLUE}.${NC}"
                fi
            done
            echo
        done
        sleep 0.1
    done
}

# Matrix-style digital rain
matrix_rain() {
    local duration=3
    local end=$((SECONDS + duration))
    local chars='ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ'
    
    while [ $SECONDS -lt $end ]; do
        echo -ne "\033[32m${chars:$((RANDOM % ${#chars})):1}\033[0m"
        if [ $((RANDOM % 20)) -eq 0 ]; then
            echo -ne "\n"
        else
            echo -ne "\033[1C"
        fi
        sleep 0.02
    done
    echo -e "\n"
}

# Scrolling text effect
scroll_text() {
    local text=$1
    local delay=$2
    local cols=$(tput cols)
    local pad=$(printf '%*s' $cols '')
    local full_text="$pad$text$pad"
    
    for ((i=0; i<${#full_text}; i++)); do
        printf "\r%s" "${full_text:$i:$cols}"
        sleep $delay
    done
    echo
}

clear
echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║             INITIATING NEURAL BACKUP SEQUENCE            ║"
echo "║        PRESERVING DIGITAL CONSCIOUSNESS - STAND BY       ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

sleep 1
meteor_shower

scroll_text "ACCESSING NEURAL ARRAYS..." 0.04
sleep 0.5

BACKUP_DIR="/var/backups/postgres"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/degenduel_$TIMESTAMP.sql"

echo -e "\n${PURPLE}[SYSTEM]${NC} Consciousness tunneling established..."
matrix_rain

echo -e "${BLUE}[INFO]${NC} Target: ${GREEN}DegenDuel Mainframe${NC}"
echo -e "${BLUE}[INFO]${NC} Timestamp: ${GREEN}$(date)${NC}"
sleep 1

scroll_text "INITIATING NEURAL CLONING..." 0.06

echo -e "\n${YELLOW}[ALERT]${NC} Beginning neural backup..."
(sudo -u postgres pg_dump degenduel > "$BACKUP_FILE") &
PID=$!

# Progress animation while backup runs
chars="⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
while kill -0 $PID 2>/dev/null; do
    for ((i=0; i<${#chars}; i++)); do
        echo -ne "\r${YELLOW}[${chars:$i:1}]${NC} Transferring consciousness... "
        sleep 0.1
    done
done

if [ $? -eq 0 ]; then
    echo -e "\n\n${GREEN}[SUCCESS]${NC} Consciousness successfully split"
    scroll_text "NEURAL CLONING COMPLETE" 0.04
    
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "\n${BLUE}[INFO]${NC} Memory fragment size: ${GREEN}$SIZE${NC}"
else
    echo -e "\n\n${RED}[ERROR]${NC} Neural cloning failed! Check logs for details."
    exit 1
fi

echo -e "\n${PURPLE}[SYSTEM]${NC} Optimizing neural pathways..."
OLD_COUNT=$(find $BACKUP_DIR -name "degenduel_*.sql" -type f -mtime +30 | wc -l)
find $BACKUP_DIR -name "degenduel_*.sql" -type f -mtime +30 -delete

matrix_rain

TOTAL_BACKUPS=$(ls $BACKUP_DIR/degenduel_*.sql | wc -l)
TOTAL_SIZE=$(du -h $BACKUP_DIR | cut -f1)

echo -e "\n${CYAN}"
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                NEURAL CLONING COMPLETE                   ║"
echo "║                                                          ║"
echo "║                                                          ║"
printf "║  Total Memory Fragments: %-33s║\n" "$TOTAL_BACKUPS"
printf "║  Neural Pathways Used: %-34s║\n" "$TOTAL_SIZE"
echo "║                                                          ║"
echo "║                                                          ║"
echo "║         THANKS, SIR/MADAM!                               ║"
echo "║             YOUR DIGITAL CONSCIOUSNESS IS                ║"
echo "║                 SECURE WITH THE BRANCH MANAGER.          ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"

meteor_shower
echo -e "${NC}"
