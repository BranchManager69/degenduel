#!/bin/bash

# This script updates import statements for marketDataService across the codebase
# Usage: 
#   ./update-imports.sh          - Make actual changes
#   ./update-imports.sh --dry-run - Preview changes without modifying files

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 DRY RUN MODE: No files will be modified"
fi

echo "Finding import statements for marketDataService..."

# Find all files containing import statements for marketDataService
FILES=$(grep -l "import.*marketDataService from ['\"].*services/marketDataService\.js['\"]" --include="*.js" -r .)

echo "Found $(echo "$FILES" | wc -l) files to update"

for file in $FILES
do
  if [ "$file" != "./services/marketDataService.js" ]; then
    if [ "$DRY_RUN" = true ]; then
      echo -e "\n📄 Found imports in: $file"
      
      # Show the current import line
      CURRENT_IMPORT=$(grep "import.*marketDataService from" "$file")
      echo "   Current: $CURRENT_IMPORT"
      
      # Show what the new import would be
      # Create a copy of the pattern with the updated path
      NEW_IMPORT=$(echo "$CURRENT_IMPORT" | sed -E 's|(\.\.+)/services/marketDataService\.js|\1/services/market-data/marketDataService.js|g')
      echo "➔ New:     $NEW_IMPORT"
    else
      echo "Updating $file"
      
      # Use a single regex pattern that handles all path depth variants
      sed -i -E 's|(\.\.+)/services/marketDataService\.js|\1/services/market-data/marketDataService.js|g' "$file"
    fi
  fi
done

if [ "$DRY_RUN" = true ]; then
  echo -e "\n✅ Dry run complete. Run without --dry-run to apply changes."
else
  echo "✅ Done! Updated all imports."
fi