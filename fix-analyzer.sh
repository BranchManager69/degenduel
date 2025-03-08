#\!/bin/bash

# Backup the original file
cp /home/websites/degenduel/scripts/db-tools.sh /home/websites/degenduel/scripts/db-tools.sh.backup

# First fix: Replace $PROMPT_FILE with $FULL_PROMPT_FILE
sed -i 's/cat $PROMPT_FILE | jq -Rs/cat $FULL_PROMPT_FILE | jq -Rs/g' /home/websites/degenduel/scripts/db-tools.sh

# Second fix: Add file-based API call
# Find the curl command pattern
PATTERN='# Call OpenAI API with the appropriate parameters
    RESPONSE=\$(curl -s https:\/\/api.openai.com\/v1\/chat\/completions \\
      -H "Content-Type: application\/json" \\
      -H "Authorization: Bearer \$OPENAI_API_KEY" \\
      -d "\$PAYLOAD")'

# Create the replacement text
REPLACEMENT='# Save payload to file to avoid "argument list too long" error
    PAYLOAD_FILE="\$PROMPT_DIR\/payload_\$TIMESTAMP.json"
    echo "\$PAYLOAD" > "\$PAYLOAD_FILE"
    echo -e "\${INFO_PREFIX} \${GREEN}API payload saved to: \${WHITE}\$PAYLOAD_FILE\${NC}"
    
    # Call OpenAI API using the payload file
    RESPONSE=\$(curl -s https:\/\/api.openai.com\/v1\/chat\/completions \\
      -H "Content-Type: application\/json" \\
      -H "Authorization: Bearer \$OPENAI_API_KEY" \\
      -d @"\$PAYLOAD_FILE")'

# Replace the pattern in the file
sed -i "s/$PATTERN/$REPLACEMENT/g" /home/websites/degenduel/scripts/db-tools.sh

echo "Fix applied. Original file backed up to /home/websites/degenduel/scripts/db-tools.sh.backup"
