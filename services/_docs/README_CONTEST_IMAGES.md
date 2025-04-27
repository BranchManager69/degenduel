# Contest Image Standardization

## Overview

The DegenDuel platform now uses a standardized approach for contest images across all systems. This document explains the implementation details and how to work with contest images.

## Standardized Image URL Format

All contest images follow this standardized URL format:

```
/images/contests/{contest_code}.png
```

Where `{contest_code}` is the unique contest code (e.g., `DUEL-20250427-1600`).

## Implementation Details

### Contest Scheduler Service

When creating new contests, the scheduler:

1. Sets the `image_url` field to the standardized format: `/images/contests/{contest_code}.png`
2. Immediately copies a placeholder image to this location so there's something to display right away
3. Then initiates the AI image generation process in a non-blocking way

### Contest Image Service

When generating images:

1. Uses the standardized filename format: `{contest_code}.png`
2. Saves the image to the standard location, replacing any placeholder
3. No changes to the database are needed since the URL remains the same

### Frontend & Discord Integration

All frontend components and integrations (including Discord):
1. Can reliably construct the image URL using just the contest code
2. Don't need to query the database for the image URL
3. Always display the most up-to-date image (initially a placeholder, then the AI-generated image once ready)

## Migration

A migration script (`scripts/migrate-contest-images.js`) has been created to:

1. Update all existing contest records to use the standardized URL format
2. Copy existing images to the new standardized location
3. Use a default placeholder for contests where images are missing

## Advantages of Standardization

1. **Predictability**: Any system can determine the image URL from just the contest code
2. **Consistency**: All services use the same URL pattern
3. **Simplified Updates**: When an image is regenerated, no database update is needed since the URL remains the same
4. **Frontend Efficiency**: Frontend can construct URLs without additional API calls

## Best Practices

1. **Always use contest codes** for new contests
2. **Never hard-code placeholder image paths** in database records
3. **Use the standard URL format** in all interfaces and integrations
4. **Ensure the contest_code field** is populated for all contests

For questions or issues regarding contest images, contact the DegenDuel development team.