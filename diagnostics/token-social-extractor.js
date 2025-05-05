import { PrismaClient } from '@prisma/client';
import { logApi } from '../utils/logger-suite/logger.js';

const prisma = new PrismaClient();

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
  
  // Website detection - using improved regex for common TLDs
  // Get all URLs from the description
  const websiteRegex = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,})(?:\/[^\s]*)?/gi;
  const websiteMatches = description.match(websiteRegex) || [];
  
  // Process all found URLs
  for (const match of websiteMatches) {
    const url = match.startsWith('http') ? match : `https://${match}`;
    
    // Exclude social media sites we've already captured
    if (!url.includes('twitter.com') && !url.includes('x.com') && 
        !url.includes('t.me') && !url.includes('telegram.me') && 
        !url.includes('discord.gg') && !url.includes('discord.com')) {
      
      // If we find multiple websites, append numbers to distinguish them
      if (socials.website) {
        let websiteIndex = 2;
        while (socials[`website${websiteIndex}`]) {
          websiteIndex++;
        }
        socials[`website${websiteIndex}`] = url;
      } else {
        socials.website = url;
      }
    }
  }
  
  return socials;
}

async function migrateTokenSocials() {
  console.log('Starting social links migration...');
  
  // Get all tokens with descriptions but no social links
  const tokens = await prisma.tokens.findMany({
    where: {
      description: { not: null },
      // Find tokens with either no socials or few socials
      OR: [
        { token_socials: { none: {} } },
        { token_socials: { some: {} } }
      ]
    },
    include: {
      token_socials: true
    }
  });
  
  console.log(`Found ${tokens.length} tokens to process`);
  
  let processed = 0;
  let updated = 0;
  
  for (const token of tokens) {
    processed++;
    
    // Extract social links from description
    const extractedSocials = extractSocialLinksFromDescription(token.description);
    
    // Skip if no socials were extracted
    if (Object.keys(extractedSocials).length === 0) continue;
    
    // Prepare data for update
    const socialEntries = [];
    
    // Get existing social types
    const existingSocials = new Set(token.token_socials.map(s => s.type));
    
    // Add only new social types
    for (const [type, url] of Object.entries(extractedSocials)) {
      if (!existingSocials.has(type) && url) {
        socialEntries.push({
          token_id: token.id,
          type,
          url: url.substring(0, 255) // Ensure URL is not too long
        });
      }
    }
    
    // Skip if no new socials to add
    if (socialEntries.length === 0) continue;
    
    // Create new social entries
    await prisma.token_socials.createMany({
      data: socialEntries,
      skipDuplicates: true
    });
    
    // Handle websites separately - store in token_websites table with "Description" label
    const websiteEntries = [];
    
    // Process all website fields (website, website2, website3, etc.)
    Object.entries(extractedSocials).forEach(([key, url]) => {
      if (key.startsWith('website')) {
        websiteEntries.push({
          token_id: token.id,
          label: 'Description', // Special label to indicate source
          url: url.substring(0, 255)
        });
      }
    });
    
    // Skip if no websites to add
    if (websiteEntries.length > 0) {
      try {
        // Add each website (checking for duplicates)
        for (const entry of websiteEntries) {
          // Check if this URL already exists for this token
          const existingWebsite = await prisma.token_websites.findFirst({
            where: { 
              token_id: entry.token_id,
              url: entry.url
            }
          });
          
          // Only add if it doesn't already exist
          if (!existingWebsite) {
            await prisma.token_websites.create({
              data: entry
            });
            
            console.log(`Added website from description for ${token.symbol}: ${entry.url.substring(0, 40)}...`);
          }
        }
      } catch (websiteError) {
        console.error(`Error adding websites for token ${token.id}:`, websiteError.message);
      }
    }
    
    updated++;
    
    // Progress logging
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${tokens.length} tokens, updated ${updated}`);
    }
  }
  
  console.log(`Migration complete. Processed ${processed} tokens, updated ${updated}`);
  await prisma.$disconnect();
}

// Run in test mode (dry run) by default
async function testExtraction() {
  console.log('Testing social link extraction (dry run)...');
  
  // Get some tokens with descriptions that likely contain social links
  const tokens = await prisma.tokens.findMany({
    where: {
      description: {
        contains: 'twitter.com',
        mode: 'insensitive'
      }
    },
    take: 10,
    orderBy: { last_refresh_success: 'desc' }
  });
  
  console.log(`Testing extraction on ${tokens.length} sample tokens\n`);
  
  for (const token of tokens) {
    console.log(`\n- ${token.symbol} (${token.name || 'No name'}):`);
    console.log(`  Description: "${token.description?.substring(0, 100)}${token.description?.length > 100 ? '...' : ''}"`);
    
    const extractedSocials = extractSocialLinksFromDescription(token.description);
    
    console.log('  Extracted social links:');
    if (Object.keys(extractedSocials).length === 0) {
      console.log('    None found');
    } else {
      for (const [type, url] of Object.entries(extractedSocials)) {
        console.log(`    ${type}: ${url}`);
      }
    }
  }
  
  await prisma.$disconnect();
}

// Command line arguments processing
const args = process.argv.slice(2);

if (args.includes('--migrate')) {
  migrateTokenSocials().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
} else {
  console.log('Running in test mode. Use --migrate to perform actual database updates.');
  testExtraction().catch(error => {
    console.error('Test extraction failed:', error);
    process.exit(1);
  });
}