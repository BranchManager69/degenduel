#!/bin/bash

# Set variables
OUTPUT_DIR="/home/websites/degenduel/docs"
OUTPUT_FILE="$OUTPUT_DIR/project_tree.md"
PROJECT_DIR="/home/websites/degenduel"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Create docs directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Start the markdown file
cat > "$OUTPUT_FILE" << EOF
# DegenDuel Repository - Project Tree
Generated at: $TIMESTAMP

\`\`\`
EOF

# Generate tree with:
# - max depth of 3 levels
# - exclude node_modules, .git, and other common excludes
# - show directories with more than 12 entries but truncate the listing
# - only show directories
tree -d -L 3 --dirsfirst \
     -I "node_modules|.git|coverage|dist|build|.next|.cache|logs|tmp|temp" \
     --filelimit 12 \
     --charset ascii \
     "$PROJECT_DIR" >> "$OUTPUT_FILE"

# Close the markdown code block
echo '```' >> "$OUTPUT_FILE"

# Add notes
cat >> "$OUTPUT_FILE" << EOF

> Notes:
> - Directories with more than 12 subdirectories are marked with (...)
> - Excluded: node_modules, .git, coverage, dist, build, .next, .cache, logs, tmp, temp
> - Tree depth: 3 levels
EOF