#!/bin/bash
# Script to run the contest image generator test with real token data

echo "Running Contest Image Generator Test with Token Data..."
echo "======================================================"

# Navigate to project root
cd "$(dirname "$0")/.."

# Create output directory
mkdir -p tests/output/contest-images

# Add execution permissions
chmod +x tests/test-contest-image-with-tokens.js

# Run the test
node tests/test-contest-image-with-tokens.js
TEST_EXIT_CODE=$?

echo "======================================================"
echo "Test completed with exit code: $TEST_EXIT_CODE"
exit $TEST_EXIT_CODE