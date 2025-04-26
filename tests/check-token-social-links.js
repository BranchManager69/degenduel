// check-token-social-links.js
// A targeted script to quickly check token social links without image generation

import prisma from '../config/prisma.js';
import dexscreenerClient from '../services/solana-engine/dexscreener-client.js';

// Target token address from .env
const TARGET_TOKEN_ADDRESS = 'DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump';

/**
 * Get token information from database
 */
async function getTokenFromDb() {
  try {
    console.log(`\n🔍 Checking database for token: ${TARGET_TOKEN_ADDRESS}`);
    
    const token = await prisma.tokens.findFirst({
      where: { address: TARGET_TOKEN_ADDRESS },
      include: {
        token_socials: true,
        token_websites: true
      }
    });
    
    if (!token) {
      console.log("❌ Token not found in database");
      return null;
    }
    
    console.log(`\n✅ Found token in database: ${token.symbol} (${token.name})`);
    console.log(`\n📊 Database social links:`);
    console.log(`- Twitter: ${token.twitter_url || 'Not found'}`);
    console.log(`- Website: ${token.website_url || 'Not found'}`);
    console.log(`- Telegram: ${token.telegram_url || 'Not found'}`);
    console.log(`- Discord: ${token.discord_url || 'Not found'}`);
    
    // Additional token_socials
    if (token.token_socials && token.token_socials.length > 0) {
      console.log(`\n📊 Additional social links:`);
      token.token_socials.forEach(social => {
        console.log(`- ${social.type}: ${social.url}`);
      });
    }
    
    // Additional websites
    if (token.token_websites && token.token_websites.length > 0) {
      console.log(`\n📊 Additional websites:`);
      token.token_websites.forEach(website => {
        console.log(`- ${website.label || 'Website'}: ${website.url}`);
      });
    }
    
    return token;
  } catch (error) {
    console.error(`\n❌ Database error: ${error.message}`);
    return null;
  }
}

/**
 * Get token information from DexScreener
 */
async function getTokenFromDexScreener() {
  try {
    console.log(`\n🔍 Checking DexScreener for token: ${TARGET_TOKEN_ADDRESS}`);
    
    const poolsData = await dexscreenerClient.getTokenPools('solana', TARGET_TOKEN_ADDRESS);
    
    if (!poolsData || !poolsData.pairs || poolsData.pairs.length === 0) {
      console.log("❌ No DexScreener data found");
      return null;
    }
    
    // Sort by liquidity and take the best pool
    const bestPool = poolsData.pairs
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    
    console.log(`\n✅ Found token on DexScreener: ${bestPool.baseToken.symbol} (${bestPool.baseToken.name})`);
    console.log(`\n📊 DexScreener social links:`);
    console.log(`- Twitter: ${bestPool.baseToken.twitter || 'Not found'}`);
    console.log(`- Website: ${bestPool.baseToken.websiteUrl || 'Not found'}`);
    console.log(`- Telegram: ${bestPool.baseToken.telegram || 'Not found'}`);
    console.log(`- Discord: ${bestPool.baseToken.discord || 'Not found'}`);
    
    // Additional pool info
    console.log(`\n📊 Pool information:`);
    console.log(`- DEX: ${bestPool.dexId}`);
    console.log(`- Pair: ${bestPool.baseToken.symbol}/${bestPool.quoteToken.symbol}`);
    console.log(`- Liquidity: $${bestPool.liquidity?.usd?.toLocaleString() || 'Unknown'}`);
    console.log(`- Volume 24h: $${bestPool.volume?.h24?.toLocaleString() || 'Unknown'}`);
    
    return bestPool;
  } catch (error) {
    console.error(`\n❌ DexScreener error: ${error.message}`);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("\n🚀 CHECKING TOKEN SOCIAL LINKS");
    console.log("============================");
    
    // Check database first
    const dbToken = await getTokenFromDb();
    
    // Check DexScreener next (with no delay between calls)
    const dexScreenerToken = await getTokenFromDexScreener();
    
    // Perform a direct fetch for comparison if needed
    if (!dexScreenerToken) {
      console.log(`\n🔄 Attempting direct fetch from DexScreener API...`);
      try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/solana/${TARGET_TOKEN_ADDRESS}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.pairs && data.pairs.length > 0) {
            console.log(`\n✅ Direct API call successful!`);
            console.log(`- Pairs found: ${data.pairs.length}`);
            
            const firstPair = data.pairs[0];
            console.log(`\n📊 Direct API social links:`);
            console.log(`- Twitter: ${firstPair.baseToken.twitter || 'Not found'}`);
            console.log(`- Website: ${firstPair.baseToken.websiteUrl || 'Not found'}`);
            console.log(`- Telegram: ${firstPair.baseToken.telegram || 'Not found'}`);
            console.log(`- Discord: ${firstPair.baseToken.discord || 'Not found'}`);
          } else {
            console.log(`\n❓ Direct API call successful but no pairs found`);
          }
        } else {
          console.log(`\n❌ Direct API call failed: ${response.status} ${response.statusText}`);
        }
      } catch (directError) {
        console.error(`\n❌ Direct fetch error: ${directError.message}`);
      }
    }
    
    console.log("\n✨ SOCIAL LINK CHECKING COMPLETE");
  } catch (error) {
    console.error(`\n❌ Fatal error: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
main().catch(error => {
  console.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});