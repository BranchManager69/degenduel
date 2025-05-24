// tests/test-contest-image-with-tokens.js
// Test file for contest image generation using token data from the database

import prisma from '../config/prisma.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config/config.js';
import dexscreenerClient from '../services/solana-engine/dexscreener-client.js';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Output directory for test images
const OUTPUT_DIR = path.join(__dirname, 'output', 'contest-images');

// Sample contest for testing
const sampleContest = {
  id: 9999, // Test ID
  name: "Solana Degen Trading Contest",
  description: "Battle of the degens! Trade the hottest tokens in this high-stakes competition.",
  contest_code: "DEGEN-" + new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  entry_fee: "0.5",
  start_time: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
  end_time: new Date(Date.now() + 25 * 60 * 60 * 1000),   // Tomorrow + 1 hour
  min_participants: 2,
  max_participants: 50,
  status: 'pending'
};

/**
 * Get random tokens with good descriptions from the database
 * @param {number} count - Number of tokens to get
 * @returns {Promise<Array>} - Array of token objects
 */
async function getRandomTokensFromDB(count = 3) {
  try {
    // IMPORTANT: First, let's try to find the specific token mentioned in the .env file
    const targetToken = await prisma.tokens.findFirst({
      where: {
        address: 'DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump'
      },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        description: true,
        image_url: true,
        tags: true
      }
    });
    
    // If we found the target token, use it as our first token
    if (targetToken) {
      console.log(`🚀 Found target token ${targetToken.symbol} (${targetToken.address}) for testing!`);
      
      // Now get additional random tokens to complete the set
      const remainingTokensNeeded = count - 1;
      
      // Get total count of eligible tokens
      const totalTokens = await prisma.tokens.count({
        where: {
          is_active: true,
          description: {
            not: null
          },
          // Exclude the target token that we already have
          NOT: {
            address: targetToken.address
          }
        }
      });
      
      // Get random tokens for the rest of our set
      const randomSkip = Math.floor(Math.random() * Math.max(1, totalTokens - (remainingTokensNeeded * 3)));
      
      // Get tokens with decent descriptions
      const tokens = await prisma.tokens.findMany({
        where: {
          is_active: true,
          description: {
            not: null
          },
          // Exclude target token that we already have
          NOT: {
            address: targetToken.address
          }
        },
        select: {
          id: true,
          address: true,
          symbol: true,
          name: true,
          description: true,
          image_url: true,
          tags: true
        },
        skip: randomSkip,
        take: remainingTokensNeeded * 3
      });
      
      // Start with target token
      const allTokens = [targetToken];
      
      // Add the rest of the tokens
      const shuffled = [...tokens].sort(() => 0.5 - Math.random());
      allTokens.push(...shuffled.slice(0, remainingTokensNeeded));
      
      return allTokens;
    }
    
    // If target token wasn't found, continue with regular random selection
    console.log("⚠️ Target token not found, using random tokens instead");
    
    // Get total count of eligible tokens
    const totalTokens = await prisma.tokens.count({
      where: {
        is_active: true,
        description: {
          not: null
        }
      }
    });
    
    // Generate a truly random skip value based on timestamp
    const randomSkip = Math.floor(Math.random() * Math.max(1, totalTokens - (count * 3)));
    
    // Get tokens with decent descriptions - using skip for randomization
    const tokens = await prisma.tokens.findMany({
      where: {
        is_active: true,
        description: {
          not: null
        }
      },
      select: {
        id: true,
        address: true,
        symbol: true,
        name: true,
        description: true,
        image_url: true,
        tags: true
      },
      skip: randomSkip,
      take: count * 3 // Get more than we need so we can filter
    });
    
    // Filter to tokens with decent descriptions
    const filteredTokens = tokens.filter(token => 
      token.description && 
      token.description.length > 30 && 
      token.name && 
      token.symbol
    );
    
    // If we don't have enough tokens after skipping, get more without the skip
    if (filteredTokens.length < count) {
      console.log("Not enough tokens after skip, getting more...");
      const moreTokens = await prisma.tokens.findMany({
        where: {
          is_active: true,
          description: {
            not: null
          }
        },
        select: {
          id: true,
          address: true,
          symbol: true,
          name: true,
          description: true,
          image_url: true,
          tags: true
        },
        take: count * 5 // Get even more to ensure we have enough
      });
      
      // Add more filtered tokens
      const moreFilteredTokens = moreTokens.filter(token => 
        token.description && 
        token.description.length > 30 && 
        token.name && 
        token.symbol &&
        // Make sure we don't add duplicates
        !filteredTokens.some(t => t.id === token.id)
      );
      
      filteredTokens.push(...moreFilteredTokens);
    }
    
    // Shuffle and take the requested number
    const shuffled = [...filteredTokens].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  } catch (error) {
    console.error("Error fetching tokens:", error);
    return [];
  }
}

/**
 * Enhance tokens with additional data from DexScreener
 * @param {Array} tokens - Base token data from database
 * @returns {Promise<Array>} - Enhanced token data
 */
async function enhanceTokensWithDexScreenerData(tokens) {
  try {
    console.log("\nEnhancing tokens with DexScreener data...");
    
    // Use the existing client - already initialized at server startup
    // No initialization needed - the singleton instance is already set up
    
    // Enhance each token with additional data
    const enhancedTokens = [];
    
    for (const token of tokens) {
      try {
        // Make a copy of the original token
        const enhancedToken = { ...token, metadata: {} };
        
        if (token.address) {
          // Special handling for target token - log in detail what we're seeing
          const isTargetToken = token.address === 'DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump';
          
          if (isTargetToken) {
            console.log(`\n🔍 FOUND TARGET TOKEN - Detailed enhancement information will be shown below:`);
          }
          
          console.log(`  - Enhancing ${token.symbol} (${token.address.slice(0, 8)}...)`);
          
          // Get pools data from DexScreener
          try {
            const poolsData = await dexscreenerClient.getTokenPools('solana', token.address);
            
            // For target token - log the raw poolsData for inspection
            if (isTargetToken && poolsData) {
              console.log("\n✨ TARGET TOKEN DEXSCREENER RAW DATA:");
              console.log("  - Has pairs:", !!poolsData.pairs);
              console.log("  - Pairs count:", poolsData.pairs ? poolsData.pairs.length : 0);
              
              if (poolsData.pairs && poolsData.pairs.length > 0) {
                const firstPair = poolsData.pairs[0];
                console.log("  - Base token name:", firstPair.baseToken.name);
                console.log("  - Base token symbol:", firstPair.baseToken.symbol);
                console.log("  - Has baseToken.twitter:", !!firstPair.baseToken.twitter);
                console.log("  - Has baseToken.telegram:", !!firstPair.baseToken.telegram);
                console.log("  - Has baseToken.websiteUrl:", !!firstPair.baseToken.websiteUrl);
                console.log("  - Has baseToken.discord:", !!firstPair.baseToken.discord);
                
                // Show the actual URLs if found
                if (firstPair.baseToken.twitter) {
                  console.log("  - Twitter URL: " + firstPair.baseToken.twitter);
                }
                if (firstPair.baseToken.telegram) {
                  console.log("  - Telegram URL: " + firstPair.baseToken.telegram);
                }
                if (firstPair.baseToken.websiteUrl) {
                  console.log("  - Website URL: " + firstPair.baseToken.websiteUrl);
                }
                if (firstPair.baseToken.discord) {
                  console.log("  - Discord URL: " + firstPair.baseToken.discord);
                }
              }
            }
            
            if (poolsData && poolsData.pairs && poolsData.pairs.length > 0) {
              // Get the most liquid pool
              const bestPool = poolsData.pairs.sort((a, b) => 
                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
              )[0];
              
              enhancedToken.metadata.dexscreener = {
                url: `https://dexscreener.com/solana/${token.address}`,
                bestPool: {
                  liquidity: bestPool.liquidity,
                  volume24h: bestPool.volume,
                  pairName: bestPool.baseToken.name + '/' + bestPool.quoteToken.symbol,
                  dexId: bestPool.dexId
                }
              };
              
              // Extract social links if available
              if (bestPool.baseToken.twitter) {
                enhancedToken.metadata.twitter = bestPool.baseToken.twitter;
                if (isTargetToken) {
                  console.log("  ✅ Added Twitter from DexScreener:", bestPool.baseToken.twitter);
                }
              }
              
              if (bestPool.baseToken.telegram) {
                enhancedToken.metadata.telegram = bestPool.baseToken.telegram;
                if (isTargetToken) {
                  console.log("  ✅ Added Telegram from DexScreener:", bestPool.baseToken.telegram);
                }
              }
              
              if (bestPool.baseToken.discord) {
                enhancedToken.metadata.discord = bestPool.baseToken.discord;
                if (isTargetToken) {
                  console.log("  ✅ Added Discord from DexScreener:", bestPool.baseToken.discord);
                }
              }
              
              // Add website if available
              if (bestPool.baseToken.websiteUrl) {
                enhancedToken.metadata.website = bestPool.baseToken.websiteUrl;
                if (isTargetToken) {
                  console.log("  ✅ Added Website from DexScreener:", bestPool.baseToken.websiteUrl);
                }
              }
            }
          } catch (poolError) {
            console.log(`    - Could not fetch pool data: ${poolError.message}`);
            
            if (isTargetToken) {
              console.log("  ❌ ERROR WITH TARGET TOKEN:", poolError.message);
              
              // Try to get data directly using DexScreener client
              try {
                console.log("  ⚠️ Trying to fetch target token data directly...");
                const directResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump`);
                
                if (directResponse.ok) {
                  const directData = await directResponse.json();
                  console.log("  ✅ DIRECT API CALL SUCCEEDED!");
                  console.log("  - Has pairs:", !!directData.pairs);
                  console.log("  - Pairs count:", directData.pairs ? directData.pairs.length : 0);
                  
                  if (directData.pairs && directData.pairs.length > 0) {
                    const pair = directData.pairs[0];
                    console.log("  - Twitter:", pair.baseToken.twitter || "Not found");
                    console.log("  - Website:", pair.baseToken.websiteUrl || "Not found");
                    console.log("  - Telegram:", pair.baseToken.telegram || "Not found");
                    console.log("  - Discord:", pair.baseToken.discord || "Not found");
                  }
                } else {
                  console.log("  ❌ DIRECT API CALL FAILED:", directResponse.status);
                }
              } catch (directError) {
                console.log("  ❌ DIRECT API CALL ERROR:", directError.message);
              }
            }
          }
        }
        
        enhancedTokens.push(enhancedToken);
      } catch (tokenError) {
        console.log(`  - Error enhancing ${token.symbol}: ${tokenError.message}`);
        enhancedTokens.push(token); // Add the original token as fallback
      }
    }
    
    console.log(`✅ Enhanced ${enhancedTokens.length} tokens with additional data`);
    return enhancedTokens;
  } catch (error) {
    console.error("Error enhancing tokens:", error);
    return tokens; // Return original tokens on error
  }
}

/**
 * Main test function for contest image generation
 */
async function testContestImageWithTokens() {
  console.log("\n🎨 TESTING CONTEST IMAGE GENERATION WITH TOKENS\n");
  console.log("=".repeat(60));
  
  try {
    // Create output directory
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // 1. Get the contest image service
    const contestImageService = await import('../utils/contest-image-utils.js').then(m => m.default);
    console.log("Loaded contest image service");
    
    // 2. Get random tokens from database
    console.log("\nFetching random tokens from database...");
    const tokens = await getRandomTokensFromDB(3);
    
    if (tokens.length === 0) {
      console.error("❌ No suitable tokens found in the database. Test aborted.");
      return;
    }
    
    console.log(`✅ Found ${tokens.length} tokens with good descriptions:`);
    tokens.forEach(token => {
      const symbol = token.symbol || 'Unknown';
      const name = token.name || token.address || 'Unknown';
      const desc = token.description ? 
        `${token.description.slice(0, 100)}...` : 
        '(No description)';
      console.log(`- ${symbol} (${name}): ${desc}`);
    });
    
    // 3. Enhance tokens with additional data
    const enhancedTokens = await enhanceTokensWithDexScreenerData(tokens);
    
    // 4. Print detailed information about all tokens we found
    console.log("\n===== DETAILED TOKEN SOCIAL MEDIA INFO =====");
    enhancedTokens.forEach(token => {
      const symbol = token.symbol || 'Unknown';
      const name = token.name || token.address || 'Unknown';
      const address = token.address || 'Unknown';
      
      console.log(`\n${symbol} (${name}):`);
      console.log(`  - Address: ${address}`);
      console.log(`  - Database socials directly on token:`);
      console.log(`    * Twitter: ${token.twitter_url || 'Not found in DB'}`);
      console.log(`    * Website: ${token.website_url || 'Not found in DB'}`);
      console.log(`    * Telegram: ${token.telegram_url || 'Not found in DB'}`);
      console.log(`    * Discord: ${token.discord_url || 'Not found in DB'}`);
      
      // Enhanced metadata from DexScreener
      if (token.metadata) {
        console.log(`  - Enhanced metadata found:`);
        console.log(`    * Twitter: ${token.metadata.twitter || 'Not found'}`);
        console.log(`    * Website: ${token.metadata.website || 'Not found'}`);
        console.log(`    * Telegram: ${token.metadata.telegram || 'Not found'}`);
        console.log(`    * Discord: ${token.metadata.discord || 'Not found'}`);
      }
    });
    
    // 5. Generate image with enhanced tokens
    console.log("\nGenerating contest image with tokens...");
    
    // Get the default configuration
    const config = contestImageService.getDefaultConfig();
    console.log("Using GPT-Image-1 configuration:", config);
    
    // Create a prompt using the actual service implementation
    console.log("\nCreating prompt with token data...");
    
    // Get the prompt directly to display it
    const promptText = contestImageService.createImagePrompt(
      sampleContest.name, 
      sampleContest.description, 
      enhancedTokens
    );
    
    // Show the full prompt that will be sent to OpenAI
    console.log("\n📝 FINAL PROMPT BEING SENT TO IMAGE GENERATOR:\n" + "=".repeat(80));
    console.log(promptText);
    console.log("=".repeat(80));
    
    const result = await contestImageService.generateContestImage(sampleContest, {
      tokens: enhancedTokens,
      savePrompt: true
    });
    
    // Show the generated image URL in a way that's easy to click
    console.log(`\n✅ Image generated successfully!`);
    console.log(`📷 Local path: ${result}`);
    console.log(`🌐 Web URL: https://degenduel.me${result}`);
    
    // If we have enhanced tokens, show what social links were found
    if (enhancedTokens && enhancedTokens.length > 0) {
      console.log("\n📊 Token data enhancement results:");
      enhancedTokens.forEach(token => {
        console.log(`\n  ${token.symbol} (${token.name || token.address}):`);
        
        // Show the original description (shortened) - with error handling
        let shortDesc = 'No description';
        if (token.description) {
          try {
            shortDesc = token.description.length > 70 ? 
              token.description.substring(0, 70) + '...' : 
              token.description;
          } catch (e) {
            shortDesc = 'Error getting description';
          }
        }
        console.log(`  - Description: ${shortDesc}`);
        
        // Show any social links found
        if (token.metadata) {
          const socialLinks = [];
          if (token.metadata.twitter) socialLinks.push(`Twitter: ${token.metadata.twitter}`);
          if (token.metadata.telegram) socialLinks.push(`Telegram: ${token.metadata.telegram}`);
          if (token.metadata.discord) socialLinks.push(`Discord: ${token.metadata.discord}`);
          if (token.metadata.website) socialLinks.push(`Website: ${token.metadata.website}`);
          
          if (socialLinks.length > 0) {
            console.log(`  - Social links found: ${socialLinks.length}`);
            socialLinks.forEach(link => console.log(`    * ${link}`));
          } else {
            console.log(`  - No social links found`);
          }
          
          // Show ALL DexScreener data for full transparency
          if (token.metadata.dexscreener) {
            console.log(`  - DexScreener data found:`);
            console.log(`    * URL: ${token.metadata.dexscreener.url}`);
            
            const pool = token.metadata.dexscreener.bestPool;
            if (pool) {
              console.log(`    * Best Pool: ${pool.pairName || 'Unknown'}`);
              
              if (pool.liquidity && pool.liquidity.usd) {
                console.log(`    * Liquidity: $${pool.liquidity.usd.toLocaleString()}`);
              }
              
              if (pool.volume24h && pool.volume24h.usd) {
                console.log(`    * 24h Volume: $${pool.volume24h.usd.toLocaleString()}`);
              }
              
              // Show price changes if available
              if (pool.priceChange) {
                if (pool.priceChange.h24) console.log(`    * 24h Change: ${pool.priceChange.h24}%`);
                if (pool.priceChange.h6) console.log(`    * 6h Change: ${pool.priceChange.h6}%`);
                if (pool.priceChange.h1) console.log(`    * 1h Change: ${pool.priceChange.h1}%`);
              }
              
              // Show base token description if available
              if (pool.baseToken && pool.baseToken.description) {
                const desc = pool.baseToken.description;
                console.log(`    * DexScreener Description: ${desc.length > 50 ? desc.substring(0, 50) + '...' : desc}`);
                
                // Compare with database description
                if (token.description && pool.baseToken.description !== token.description) {
                  console.log(`    * ⚠️ DIFFERENT from DB description`);
                } else if (token.description) {
                  console.log(`    * ✅ Matches DB description`);
                }
              }
            }
          }
          
          // Show Database token price data
          if (token.metadata.price) {
            console.log(`  - Database price data found:`);
            if (token.metadata.price.current) console.log(`    * Current Price: $${token.metadata.price.current}`);
            if (token.metadata.price.marketCap) console.log(`    * Market Cap: $${token.metadata.price.marketCap.toLocaleString()}`);
            if (token.metadata.price.volume24h) console.log(`    * 24h Volume: $${token.metadata.price.volume24h.toLocaleString()}`);
          }
          
          // Show pool data from database
          if (token.metadata.pools && token.metadata.pools.length > 0) {
            console.log(`  - Database pools data found: ${token.metadata.pools.length} pools`);
            token.metadata.pools.slice(0, 2).forEach((pool, i) => {
              console.log(`    * Pool ${i+1}: ${pool.name || pool.dex || 'Unknown'}`);
              if (pool.liquidity) console.log(`      - Liquidity: $${pool.liquidity.toLocaleString()}`);
              if (pool.volume24h) console.log(`      - Volume: $${pool.volume24h.toLocaleString()}`);
            });
          }
          
          // Additional websites
          if (token.metadata.additionalWebsites && token.metadata.additionalWebsites.length > 0) {
            console.log(`  - Additional websites: ${token.metadata.additionalWebsites.length}`);
            token.metadata.additionalWebsites.forEach((site, i) => {
              console.log(`    * ${site.label}: ${site.url}`);
            });
          }
        }
      });
    }
    
    // Show success message (compact)
    console.log("\n✨ TEST COMPLETED SUCCESSFULLY ✨");
    
  } catch (error) {
    console.error("\n❌ TEST FAILED:");
    console.error(error);
    process.exit(1);
  } finally {
    // Clean up Prisma connection
    await prisma.$disconnect();
    // Ensure script exits cleanly
    process.exit(0);
  }
}

// Run the test
testContestImageWithTokens().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});