#!/bin/bash
# service-audit.sh - Audit DegenDuel services for BaseService compliance
# Usage: ./service-audit.sh

echo "===== DegenDuel Service Architecture Compliance Audit ====="
echo "Running in: $(pwd)"
echo

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 1. Find all service files
echo -e "${BLUE}Searching for service files...${NC}"
SERVICE_FILES=$(find ./services -type f -name "*.js" | grep -v "node_modules" | grep -v "test")
echo -e "Found $(echo "$SERVICE_FILES" | wc -l) potential service files"
echo

# 2. Check for BaseService extension
echo -e "${BLUE}Checking for BaseService extension...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    echo -e "${GREEN}✓${NC} $file extends BaseService"
    EXTENDS_BASE_SERVICE="$EXTENDS_BASE_SERVICE $file"
  else
    if grep -q "class.*Service" "$file"; then
      echo -e "${RED}✗${NC} $file contains a Service class but doesn't extend BaseService"
    fi
  fi
done
echo

# 3. Check for super.initialize() calls
echo -e "${BLUE}Checking for super.initialize() calls...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "super\.initialize()" "$file"; then
      echo -e "${GREEN}✓${NC} $file calls super.initialize()"
    else
      echo -e "${RED}✗${NC} $file extends BaseService but doesn't call super.initialize()"
    fi
  fi
done
echo

# 4. Check for event handling
echo -e "${BLUE}Checking for service event emission...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "serviceEvents\.emit" "$file"; then
      echo -e "${GREEN}✓${NC} $file emits service events"
    else
      echo -e "${YELLOW}?${NC} $file may not emit service events"
    fi
  fi
done
echo

# 5. Check for circuit breaker pattern
echo -e "${BLUE}Checking for circuit breaker implementation...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "circuitBreaker" "$file"; then
      echo -e "${GREEN}✓${NC} $file implements circuit breaker pattern"
    else
      echo -e "${YELLOW}?${NC} $file may not implement circuit breaker pattern"
    fi
  fi
done
echo

# 6. Check for handleError usage
echo -e "${BLUE}Checking for handleError usage...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "this\.handleError" "$file"; then
      echo -e "${GREEN}✓${NC} $file uses handleError"
    else
      echo -e "${RED}✗${NC} $file doesn't use handleError method"
    fi
  fi
done
echo

# 7. Check for prisma singleton usage
echo -e "${BLUE}Checking for prisma singleton import...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "import.*prisma.*from.*config/prisma" "$file"; then
      echo -e "${GREEN}✓${NC} $file imports prisma singleton"
    else
      if grep -q "new PrismaClient" "$file"; then
        echo -e "${RED}✗${NC} $file creates new PrismaClient instance"
      else
        if grep -q "prisma\." "$file" || grep -q "this\.db" "$file"; then
          echo -e "${YELLOW}?${NC} $file uses database but prisma import not found"
        fi
      fi
    fi
  fi
done
echo

# 8. Check for stop method implementation
echo -e "${BLUE}Checking for stop method implementation...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "async stop" "$file"; then
      if grep -q "super\.stop" "$file"; then
        echo -e "${GREEN}✓${NC} $file implements stop method with super.stop()"
      else
        echo -e "${YELLOW}?${NC} $file implements stop method but doesn't call super.stop()"
      fi
    else
      echo -e "${RED}✗${NC} $file doesn't implement stop method"
    fi
  fi
done
echo

# 9. Check for serviceManager.register usage
echo -e "${BLUE}Checking for serviceManager.register usage...${NC}"
echo "$SERVICE_FILES" | while read file; do
  if grep -q "extends BaseService" "$file"; then
    if grep -q "serviceManager\.register" "$file"; then
      REGISTER_LINE=$(grep -n "serviceManager\.register" "$file" | head -1)
      echo -e "${GREEN}✓${NC} $file uses serviceManager.register at line ${REGISTER_LINE%%:*}"
    else
      echo -e "${RED}✗${NC} $file doesn't use serviceManager.register"
    fi
  fi
done
echo

# 10. Check for circular reference risk in error logging
echo -e "${BLUE}Checking for potential circular reference issues in error logging...${NC}"
echo "$SERVICE_FILES" | while read file; do
  CIRCULAR_REFS=$(grep -n "logApi\.\(error\|warn\|info\|debug\)" "$file" | grep ", \(error\|err\)")
  if [ -n "$CIRCULAR_REFS" ]; then
    echo -e "${RED}✗${NC} $file has potential circular reference in error logging:"
    echo "$CIRCULAR_REFS" | head -3
    if [ $(echo "$CIRCULAR_REFS" | wc -l) -gt 3 ]; then
      echo "   ... and $(expr $(echo "$CIRCULAR_REFS" | wc -l) - 3) more instances"
    fi
  fi
done
echo

echo "===== Audit Complete ====="
echo "For detailed analysis, pipe this output to a file: ./service-audit.sh > service-audit-results.txt"