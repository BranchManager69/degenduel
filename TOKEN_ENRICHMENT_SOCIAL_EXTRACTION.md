# Token Enrichment Social Link Extraction Enhancement

Based on the token diagnostics and analysis of the Token Enrichment Service, I recommend the following enhancements to improve social media data extraction from token descriptions.

## Current Status

The database analysis shows:
- 15,371 total tokens in the database
- Nearly 100% have symbol, name, and image_url
- 80.9% have descriptions
- Almost 0% have dedicated social media fields populated:
  - Only 1 token has a twitter_url
  - 0 tokens have website_url, telegram_url, or discord_url
  - 0 tokens have tags

However, many tokens have social links embedded in their descriptions:
- 271 tokens have Twitter links in descriptions
- 533 tokens have Telegram links in descriptions
- 7 tokens have Discord links
- 848 tokens have possible website links

## Enhancement Plan

### 1. Add Social Link Extraction from Descriptions

I've created a utility function in `/diagnostics/token-social-extractor.js` that can extract social links from token descriptions:

```javascript
/**
 * Extracts social media links from token descriptions
 * @param {string} description - The token description text
 * @returns {Object} - Object containing extracted social links
 */
function extractSocialLinksFromDescription(description) {
  if (!description) return {};
  
  const socials = {};
  
  // Twitter detection
  const twitterRegex = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i;
  const twitterMatch = description.match(twitterRegex);
  if (twitterMatch && twitterMatch[0]) {
    socials.twitter = twitterMatch[0].startsWith('http') ? twitterMatch[0] : `https://${twitterMatch[0]}`;
  }
  
  // Telegram detection
  const telegramRegex = /(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)/i;
  const telegramMatch = description.match(telegramRegex);
  if (telegramMatch && telegramMatch[0]) {
    socials.telegram = telegramMatch[0].startsWith('http') ? telegramMatch[0] : `https://${telegramMatch[0]}`;
  }
  
  // Discord detection
  const discordRegex = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/([a-zA-Z0-9_-]+)/i;
  const discordMatch = description.match(discordRegex);
  if (discordMatch && discordMatch[0]) {
    socials.discord = discordMatch[0].startsWith('http') ? discordMatch[0] : `https://${discordMatch[0]}`;
  }
  
  // Website detection (common TLDs)
  const websiteRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,})(?:\/[^\s]*)?/i;
  const websiteMatch = description.match(websiteRegex);
  if (websiteMatch && websiteMatch[0]) {
    // Exclude social media sites we've already captured
    const url = websiteMatch[0].startsWith('http') ? websiteMatch[0] : `https://${websiteMatch[0]}`;
    if (!url.includes('twitter.com') && !url.includes('x.com') && 
        !url.includes('t.me') && !url.includes('discord.gg')) {
      socials.website = url;
    }
  }
  
  return socials;
}
```

### 2. Integrate with the Existing Social Link Merging Logic

In `services/token-enrichment/tokenEnrichmentService.js`, the `mergeTokenData` function needs to be modified to include description-extracted links:

```javascript
// Modify the existing mergeTokenData function in tokenEnrichmentService.js

mergeTokenData(data) {
  // Existing code for source priorities and merging...
  
  // Extract socials from description if available
  let extractedSocials = {};
  if (result.description) {
    extractedSocials = this.extractSocialLinksFromDescription(result.description);
  }
  
  // Initialize socials object
  result.socials = {};
  
  // Add socials from DexScreener (highest priority)
  if (data.dexscreener && data.dexscreener.socials) {
    Object.entries(data.dexscreener.socials).forEach(([type, url]) => {
      if (url) result.socials[type] = url;
    });
  }
  
  // Add socials from Helius (second priority, only if not already present)
  if (data.helius && data.helius.socials) {
    Object.entries(data.helius.socials).forEach(([type, url]) => {
      if (url && !result.socials[type]) result.socials[type] = url;
    });
  }
  
  // Add socials extracted from description (lowest priority, only if not already present)
  Object.entries(extractedSocials).forEach(([type, url]) => {
    if (url && !result.socials[type]) result.socials[type] = url;
  });
  
  return result;
}
```

### 3. Run the Migration Script

To extract social links from all existing tokens, you can use the script I've created in `/diagnostics/token-social-extractor.js`:

```bash
# Test extraction without modifying the database
node diagnostics/token-social-extractor.js

# Run actual migration
node diagnostics/token-social-extractor.js --migrate
```

The script will:
1. Find all tokens with descriptions but missing social links
2. Extract social links from each description
3. Add the links to the proper database tables
4. Skip tokens with no extractable links or with links already present

### 4. Test the Results

After implementing these changes and running the migration, you can verify the improvement with the diagnostics script:

```bash
node diagnostics/simple-token-diagnostics.js
```

## Benefits

1. **Improved Data Completeness**: Extracting links from descriptions will significantly increase the number of tokens with social information.
2. **Better User Experience**: Contest image generation and token lookup will have more complete social data.
3. **Enhanced Token Verification**: More social links make it easier for users to verify token authenticity.
4. **Reduced External API Reliance**: Less need to call DexScreener for missing social data.

## Implementation Steps Summary

1. Copy the extraction function from `/diagnostics/token-social-extractor.js` to the TokenEnrichmentService
2. Modify the `mergeTokenData` function to include description-extracted links
3. Run the migration script to populate social data for existing tokens
4. Test the enhanced token enrichment service with new tokens

This approach will ensure both historical and future tokens have better social media data, improving the overall quality of your token database.