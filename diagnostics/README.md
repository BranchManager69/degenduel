# Token Database Diagnostics

Diagnostic tools for analyzing token data quality in the database.

## Overview

These tools help identify issues with token data quality:
- Missing social media links
- Links embedded in descriptions that should be extracted
- Incomplete token metadata
- Fields needing enrichment

## Quick Usage

```bash
# Run all diagnostics
npm run tokens

# Run specific checks
npm run tokens basic   # Basic token stats
npm run tokens social  # Social link analysis
npm run tokens full    # Comprehensive report
```

## Available Tools

1. **Basic Checks** (`basic`):
   - Token counts and completeness
   - Field population rates
   - Sample tokens

2. **Social Link Finder** (`social`):
   - Finds Twitter/Telegram/Discord links in descriptions
   - Lists tokens needing link extraction
   - Shows sample tokens with embedded links

3. **Quality Report** (`full`):
   - Complete analysis with field distribution
   - Data quality metrics
   - Improvement recommendations for token enrichment

## Common Findings

The most common issues found include:

1. Social media links embedded in descriptions instead of structured fields
2. Inconsistent token symbol length and formatting
3. Incomplete or missing token metadata
4. Tokens with unusual characteristics

## Integration with Token Enrichment

These diagnostics can help guide the token enrichment process by identifying:
- Which tokens need social link extraction
- Fields with lowest population rates
- Tokens needing additional data enrichment