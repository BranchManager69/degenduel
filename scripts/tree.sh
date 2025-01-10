#!/bin/bash

# Set variables
OUTPUT_DIR="/home/websites/degenduel/docs"
OUTPUT_FILE="$OUTPUT_DIR/degenduel_api_server_project_tree.md"
PROJECT_DIR="/home/websites/degenduel"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Create docs directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Start the markdown file
cat > "$OUTPUT_FILE" << EOF
# DegenDuel API Server - Project Tree
Generated at: $TIMESTAMP

\`\`\`
EOF

# Generate tree with:
# - max depth of 5 levels
# - exclude node_modules, .git, and other common excludes
# - show directories with more than 20 entries but truncate the listing
# - only show directories
tree -d -L 5 --dirsfirst \
     -I "node_modules|.git|coverage|dist|build|.next|.cache|logs|tmp|temp" \
     --filelimit 20 \
     --charset ascii \
     "$PROJECT_DIR" >> "$OUTPUT_FILE"

# Close the markdown code block
echo '```' >> "$OUTPUT_FILE"

# Add notes
cat >> "$OUTPUT_FILE" << EOF

> Notes:
> - Directories with more than 20 subdirectories are marked with (...)
> - Excluded: node_modules, .git, coverage, dist, build, .next, .cache, logs, tmp, temp
> - Tree depth: 5 levels
EOF