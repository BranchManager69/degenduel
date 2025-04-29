#!/bin/bash

# show-services.sh - Ultra simple service status check
# Just shows services from system_settings with their status and update time

# Simple flags
ACTIVE_ONLY=0
[ "$1" = "--active" ] && ACTIVE_ONLY=1

# Run direct SQL query with minimal formatting
psql -U branchmanager -h localhost -d degenduel -c "
SELECT 
  key as service, 
  value->>'status' as status,
  updated_at
FROM system_settings 
$([ $ACTIVE_ONLY -eq 1 ] && echo "WHERE value->>'status' = 'active'")
ORDER BY updated_at DESC;
"