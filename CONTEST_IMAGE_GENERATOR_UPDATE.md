# Contest Image Generator Update

## Summary

The contest image generation service has been updated to save images using the contest code as the filename instead of a random UUID. This makes it easier for the frontend to predictably access contest images without needing to query the database first.

## Changes Made

1. Modified the image filename generation in `contestImageService.js`:
   - Now uses `<contest_code>.png` format when a contest code is available
   - Falls back to the previous `contest_<id>_<uuid>.png` format for backwards compatibility
   - Maintains the same approach for JSON prompt files

## How It Works

When generating a contest image:

1. If the contest has a `contest_code` (which all contests should have according to the database schema):
   - The image is saved as `/public/images/contests/<contest_code>.png`
   - Example: `DEGEN-20250427.png`

2. If for some reason `contest_code` is not available:
   - Falls back to the legacy format: `contest_<id>_<uuid>.png`
   - Example: `contest_134_2c3f66bd-5dbd-4bbb-bc43-98c0355a9877.png`

## Accessing Images from Frontend

This change allows frontend developers to construct the image URL directly using the contest code:

```javascript
// Before: Needed to get the image_url from the contest data
const contestImageUrl = contest.image_url;

// After: Can construct the URL directly from the contest code
const contestImageUrl = `/images/contests/${contest.contest_code}.png`;
```

## Testing

The changes have been tested and confirmed working. When running the test script, the image is now saved with the contest code as the filename.

## Files Modified

- `/services/contestImageService.js`