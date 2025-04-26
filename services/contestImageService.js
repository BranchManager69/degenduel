// contestImageService.js
// Service to generate and manage AI-generated images for contests

import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';
import { config } from '../config/config.js';
import dexscreenerClient from '../services/solana-engine/dexscreener-client.js';

// Initialize OpenAI API client with dedicated image generation API key
const openai = new OpenAI({
  apiKey: config.api_keys.openai_image || config.api_keys.openai
});

// Base directory for saving images
const IMAGES_DIR = path.join(process.cwd(), 'public', 'images', 'contests');

// GPT-Image-1 configuration
const DEFAULT_CONFIG = {
  model: "gpt-image-1",     // Using GPT-Image-1 as default model
  size: "1024x1024",        // Standard square size
  quality: "high",          // High quality for GPT-Image-1
  output_format: "png",     // PNG output format
  background: "auto",       // Auto background detection
  moderation: "low",        // Less restrictive filtering
  useTokenData: true        // Use token data to enhance prompts when available
};

/**
 * Enhance tokens with additional metadata
 * @param {Array} tokens - Array of token objects
 * @returns {Promise<Array>} - Enhanced token objects
 */
async function enhanceTokensWithMetadata(tokens) {
  try {
    const enhancedTokens = [];
    
    for (const token of tokens) {
      try {
        // Make a copy of the original token
        const enhancedToken = { ...token, metadata: {} };
        
        // 1. First, use DexScreener client as the primary source of data
        //    This should give us the most up-to-date and comprehensive information
        if (token.address) {
          try {
            // Use the proper DexScreener client method
            logApi.debug(`${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Fetching DexScreener data for ${token.symbol || token.address}`);
            
            // Implement proper retry logic with backoff
            const maxRetries = 3;
            const initialDelayMs = 1000;
            let attempt = 0;
            let success = false;
            let poolsData = null;
            
            while (attempt < maxRetries && !success) {
              try {
                // Use the existing global singleton DexScreener client
                poolsData = await dexscreenerClient.getTokenPools('solana', token.address);
                success = true;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Successfully fetched DexScreener data for ${token.symbol || token.address}`);
              } catch (retryError) {
                attempt++;
                if (retryError.message.includes('429') && attempt < maxRetries) {
                  // Rate limited - exponential backoff
                  const delay = initialDelayMs * Math.pow(2, attempt - 1);
                  logApi.debug(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Rate limited, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                } else if (attempt >= maxRetries) {
                  logApi.debug(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Failed to get DexScreener data after ${maxRetries} attempts`);
                  break;
                } else {
                  // Other error, try once more after a short delay
                  await new Promise(resolve => setTimeout(resolve, initialDelayMs));
                }
              }
            }
            
            // If we got pool data, process it
            if (poolsData && poolsData.pairs && poolsData.pairs.length > 0) {
              // Get the most liquid pool
              const bestPool = poolsData.pairs.sort((a, b) => 
                (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
              )[0];
              
              // Add DexScreener pool data
              enhancedToken.metadata.dexscreener = {
                url: `https://dexscreener.com/solana/${token.address}`,
                bestPool: {
                  liquidity: bestPool.liquidity,
                  volume24h: bestPool.volume,
                  pairName: bestPool.baseToken.name + '/' + bestPool.quoteToken.symbol,
                  dexId: bestPool.dexId
                }
              };
              
              // Add social links from DexScreener
              if (bestPool.baseToken.twitter) {
                enhancedToken.metadata.twitter = bestPool.baseToken.twitter;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Twitter from DexScreener: ${bestPool.baseToken.twitter}`);
              }
              
              if (bestPool.baseToken.telegram) {
                enhancedToken.metadata.telegram = bestPool.baseToken.telegram;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Telegram from DexScreener: ${bestPool.baseToken.telegram}`);
              }
              
              if (bestPool.baseToken.discord) {
                enhancedToken.metadata.discord = bestPool.baseToken.discord;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Discord from DexScreener: ${bestPool.baseToken.discord}`);
              }
              
              if (bestPool.baseToken.websiteUrl) {
                enhancedToken.metadata.website = bestPool.baseToken.websiteUrl;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Website from DexScreener: ${bestPool.baseToken.websiteUrl}`);
              }
            }
          } catch (dexError) {
            logApi.debug(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} DexScreener error for ${token.symbol}: ${dexError.message}`);
          }
        }
        
        // 2. Next, fallback to our database data if we're missing info
        if (token.id) {
          try {
            // Get the complete token data with social links from the database
            const fullTokenData = await prisma.tokens.findUnique({
              where: { id: token.id },
              include: {
                token_socials: true,
                token_websites: true,
                token_prices: true,
                pools: {
                  take: 5,
                  orderBy: { updated_at: 'desc' }
                }
              }
            });
            
            if (fullTokenData) {
              // Add social links from the tokens table if not already present from DexScreener
              if (fullTokenData.twitter_url && !enhancedToken.metadata.twitter) {
                enhancedToken.metadata.twitter = fullTokenData.twitter_url;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Twitter from DB: ${fullTokenData.twitter_url}`);
              }
              
              if (fullTokenData.telegram_url && !enhancedToken.metadata.telegram) {
                enhancedToken.metadata.telegram = fullTokenData.telegram_url;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Telegram from DB: ${fullTokenData.telegram_url}`);
              }
              
              if (fullTokenData.discord_url && !enhancedToken.metadata.discord) {
                enhancedToken.metadata.discord = fullTokenData.discord_url;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Discord from DB: ${fullTokenData.discord_url}`);
              }
              
              if (fullTokenData.website_url && !enhancedToken.metadata.website) {
                enhancedToken.metadata.website = fullTokenData.website_url;
                logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found Website from DB: ${fullTokenData.website_url}`);
              }
              
              // Process additional social links from the token_socials table
              if (fullTokenData.token_socials && fullTokenData.token_socials.length > 0) {
                for (const social of fullTokenData.token_socials) {
                  const socialType = social.type.toLowerCase();
                  
                  // Only add if not already present
                  if (!enhancedToken.metadata[socialType]) {
                    enhancedToken.metadata[socialType] = social.url;
                    logApi.debug(`${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Found ${socialType} from token_socials: ${social.url}`);
                  }
                }
              }
              
              // Process additional websites from the token_websites table
              if (fullTokenData.token_websites && fullTokenData.token_websites.length > 0) {
                enhancedToken.metadata.additionalWebsites = fullTokenData.token_websites.map(site => ({
                  label: site.label || 'Website',
                  url: site.url
                }));
              }
              
              // Add token price data if available and not already set
              if (fullTokenData.token_prices && !enhancedToken.metadata.price) {
                enhancedToken.metadata.price = {
                  current: fullTokenData.token_prices.price,
                  change24h: fullTokenData.token_prices.change_24h,
                  marketCap: fullTokenData.token_prices.market_cap,
                  volume24h: fullTokenData.token_prices.volume_24h,
                  liquidity: fullTokenData.token_prices.liquidity
                };
              }
              
              // Add pools data if available and not already set
              if (fullTokenData.pools && fullTokenData.pools.length > 0 && !enhancedToken.metadata.pools) {
                enhancedToken.metadata.pools = fullTokenData.pools.map(pool => ({
                  name: pool.pool_name || `${pool.dex_id} Pool`,
                  dex: pool.dex_id,
                  liquidity: pool.liquidity_usd,
                  volume24h: pool.volume_24h_usd
                }));
              }
            }
          } catch (dbError) {
            logApi.debug(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Error fetching token data from DB: ${dbError.message}`);
          }
        }
        
        enhancedTokens.push(enhancedToken);
      } catch (tokenError) {
        // If any individual token enhancement fails, just add the original
        logApi.warn(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Error enhancing token ${token.symbol}: ${tokenError.message}`);
        enhancedTokens.push(token);
      }
    }
    
    return enhancedTokens;
  } catch (error) {
    logApi.error(`${fancyColors.RED}[contestImageService]${fancyColors.RESET} Error enhancing tokens:`, error.message);
    return tokens; // Return original tokens on error
  }
}

/**
 * Generates an AI image for a contest based on name and description
 * @param {Object} contest - The contest object with name and description
 * @param {Object} options - Optional configuration for image generation
 * @returns {Promise<string>} - The URL of the generated image
 */
async function generateContestImage(contest, options = {}) {
  try {
    const { name, description } = contest;
    const config = { ...DEFAULT_CONFIG, ...options };
    
    // Ensure images directory exists
    await fs.mkdir(IMAGES_DIR, { recursive: true });
    
    // Fetch token data if enabled
    let relatedTokens = [];
    if (config.useTokenData && !options.tokens) {
      // Try to get related tokens from database based on contest name/description
      relatedTokens = await getRelatedTokensForContest(contest);
      logApi.info(`🔍 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Found ${relatedTokens.length} related tokens for contest prompt enhancement`);
      
      // Try to enhance tokens with additional metadata from database and external sources
      relatedTokens = await enhanceTokensWithMetadata(relatedTokens);
    } else if (options.tokens) {
      // Use tokens provided in options
      relatedTokens = options.tokens;
      logApi.info(`🔍 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Using ${relatedTokens.length} provided tokens for prompt enhancement`);
    }
    
    // Create prompt for image generation
    const prompt = createImagePrompt(name, description, relatedTokens);
    
    logApi.info(`🎨 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Generating AI image for contest "${name}"`, {
      contest_id: contest.id,
      model: config.model,
      quality: config.quality,
      size: config.size,
      prompt_length: prompt.length,
      token_count: relatedTokens.length
    });
    
    // Prepare API request parameters
    const requestParams = {
      model: config.model,
      prompt: prompt,
      n: 1,
      size: config.size,
      quality: config.quality,
      output_format: config.output_format,
      background: config.background
    };
    
    // Moderation level (can be 'low' or 'auto')
    if (config.moderation) {
      requestParams.moderation = config.moderation;
    }
    
    // Optionally add output compression for webp or jpeg formats
    if (['webp', 'jpeg'].includes(config.output_format) && config.output_compression) {
      requestParams.output_compression = config.output_compression;
    }
    
    // Generate image using OpenAI API with the specified configuration
    const response = await openai.images.generate(requestParams);
    
    // GPT-Image-1 always returns base64-encoded images
    const imageData = response.data[0].b64_json;
    
    // Log token usage
    if (response.usage) {
      logApi.info(`${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Token usage:`, {
        total_tokens: response.usage.total_tokens,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      });
    }
    
    // Determine file extension based on output format
    const fileExt = config.output_format || 'png';
    
    // Generate unique filename and save path
    const filename = `contest_${contest.id || 'new'}_${uuidv4()}.${fileExt}`;
    const imagePath = path.join(IMAGES_DIR, filename);
    
    // Save the image to disk
    await fs.writeFile(imagePath, Buffer.from(imageData, 'base64'));
    
    // Return public URL of the image
    const imageUrl = `/images/contests/${filename}`;
    
    logApi.info(`✅ ${fancyColors.GREEN}[contestImageService]${fancyColors.RESET} Generated and saved AI image for contest`, {
      contest_id: contest.id,
      name: name,
      image_url: imageUrl,
      image_size_bytes: Buffer.from(imageData, 'base64').length,
      model: config.model,
      quality: config.quality
    });
    
    // Optionally save the prompt info for future reference
    if (config.savePrompt) {
      try {
        const promptInfo = {
          original_prompt: prompt,
          settings: config,
          token_data: relatedTokens.map(t => ({ 
            id: t.id, 
            symbol: t.symbol, 
            name: t.name,
            metadata: t.metadata || {} // Include enhanced metadata
          })),
          generated_at: new Date().toISOString()
        };
        
        const promptPath = path.join(IMAGES_DIR, `${path.parse(filename).name}.json`);
        await fs.writeFile(promptPath, JSON.stringify(promptInfo, null, 2));
      } catch (promptError) {
        logApi.warn(`⚠️ ${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Failed to save prompt info, but image was generated successfully`, {
          error: promptError.message
        });
      }
    }
    
    return imageUrl;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[contestImageService]${fancyColors.RESET} Failed to generate contest image`, {
      contest_id: contest.id,
      name: contest.name,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Find tokens that might be related to the contest based on its name/description
 * @param {Object} contest - The contest object
 * @returns {Promise<Array>} - Array of token objects
 */
async function getRelatedTokensForContest(contest) {
  try {
    const { name, description } = contest;
    
    // If no meaningful description, just get some random active tokens
    if (!description || description.length < 10) {
      return getRandomActiveTokens(3);
    }
    
    // Look for token names or symbols mentioned in the contest name/description
    const combinedText = (name + " " + description).toLowerCase();
    
    // Get all active tokens
    const allTokens = await prisma.tokens.findMany({
      where: {
        is_active: true
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
      take: 100 // Limit to avoid processing too many
    });
    
    // Find tokens mentioned by name or symbol
    const mentionedTokens = allTokens.filter(token => {
      if (!token.symbol && !token.name) return false;
      
      // Check if token symbol or name is mentioned
      const symbolLower = token.symbol ? token.symbol.toLowerCase() : "";
      const nameLower = token.name ? token.name.toLowerCase() : "";
      
      return (
        symbolLower && combinedText.includes(symbolLower) ||
        nameLower && combinedText.includes(nameLower)
      );
    });
    
    // If we found mentioned tokens, use them
    if (mentionedTokens.length > 0) {
      return mentionedTokens.slice(0, 3); // Limit to 3 tokens
    }
    
    // Extract keywords from contest description
    const contestTerms = (name + " " + description).toLowerCase().split(/\W+/).filter(term => 
      term.length > 3 && !['with', 'that', 'this', 'from', 'have', 'your'].includes(term)
    );
    
    // Find tokens with matching descriptions
    const matchingTokens = allTokens.filter(token => {
      if (!token.description) return false;
      
      const descLower = token.description.toLowerCase();
      return contestTerms.some(term => descLower.includes(term));
    });
    
    // If we found matching tokens, use them
    if (matchingTokens.length > 0) {
      // Shuffle and take up to 3
      const shuffled = [...matchingTokens].sort(() => 0.5 - Math.random());
      return shuffled.slice(0, 3);
    }
    
    // If all else fails, just get some random active tokens
    return getRandomActiveTokens(3);
    
  } catch (error) {
    logApi.error(`${fancyColors.RED}[contestImageService]${fancyColors.RESET} Error finding related tokens:`, error);
    return []; // Return empty array on error
  }
}

/**
 * Get random active tokens from the database
 * @param {number} count - Number of tokens to return
 * @returns {Promise<Array>} - Array of token objects
 */
async function getRandomActiveTokens(count = 3) {
  try {
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
      take: count * 3 // Get more than needed so we can filter
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
      logApi.info(`${fancyColors.YELLOW}[contestImageService]${fancyColors.RESET} Not enough tokens after skip, getting more...`);
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
    logApi.error(`${fancyColors.RED}[contestImageService]${fancyColors.RESET} Error fetching random tokens:`, error);
    return []; // Return empty array on error
  }
}

/**
 * Creates an image generation prompt based on contest details and token data
 * @param {string} name - Contest name
 * @param {string} description - Contest description
 * @param {Array} tokens - Array of token objects to include in the prompt
 * @returns {string} - Generated prompt for the image
 */
function createImagePrompt(name, description, tokens = []) {
  // Start with the basic contest info
  let prompt = `Create a high-impact banner image for a cryptocurrency trading contest on DegenDuel. The contest is called "${name}" and described as: "${description}".`;
  
  // Add token information if available
  if (tokens && tokens.length > 0) {
    // Extract token symbols and names
    const tokenSymbols = tokens.map(t => t.symbol);
    
    // Add token details to the prompt
    prompt += ` This contest features these tokens: ${tokenSymbols.join(', ')}. `;
    
    // Include ALL token descriptions for maximum context
    tokens.forEach(token => {
      // Start with token symbol
      prompt += `${token.symbol}: `;
      
      // Add primary description from token object
      if (token.description) {
        prompt += `${token.description} `;
      }
      
      // Always add DexScreener description as additional context, even if similar
      if (token.metadata && token.metadata.dexscreener && 
          token.metadata.dexscreener.bestPool && 
          token.metadata.dexscreener.bestPool.baseToken && 
          token.metadata.dexscreener.bestPool.baseToken.description) {
        prompt += `DexScreener description: ${token.metadata.dexscreener.bestPool.baseToken.description} `;
      }
      
      // Add a separator between tokens
      prompt += ` | `;
    });
    
    // Include metadata from enhanced tokens
    tokens.forEach(token => {
      if (token.metadata) {
        // Add social links
        if (token.metadata.twitter) {
          prompt += `${token.symbol} Twitter: ${token.metadata.twitter} `;
        }
        
        if (token.metadata.telegram) {
          prompt += `${token.symbol} Telegram: ${token.metadata.telegram} `;
        }
        
        if (token.metadata.website) {
          prompt += `${token.symbol} Website: ${token.metadata.website} `;
        }
        
        if (token.metadata.discord) {
          prompt += `${token.symbol} Discord: ${token.metadata.discord} `;
        }
        
        // Add DexScreener data if available
        // DexScreener pool data
        if (token.metadata.dexscreener && token.metadata.dexscreener.bestPool) {
          const pool = token.metadata.dexscreener.bestPool;
          
          if (pool.liquidity && pool.liquidity.usd) {
            prompt += `${token.symbol} Liquidity: $${pool.liquidity.usd.toLocaleString()} USD. `;
          }
          
          if (pool.volume24h && pool.volume24h.usd) {
            prompt += `${token.symbol} 24h Volume: $${pool.volume24h.usd.toLocaleString()} USD. `;
          }
          
          if (pool.pairName) {
            prompt += `${token.symbol} traded in ${pool.pairName} pool. `;
          }
          
          // Add more data from pool if available
          if (pool.fdv) {
            prompt += `${token.symbol} Fully Diluted Value: $${pool.fdv.toLocaleString()} USD. `;
          }
          
          if (pool.priceChange) {
            if (pool.priceChange.h24) {
              prompt += `${token.symbol} 24h Price Change: ${pool.priceChange.h24}%. `;
            }
            if (pool.priceChange.h6) {
              prompt += `${token.symbol} 6h Price Change: ${pool.priceChange.h6}%. `;
            }
            if (pool.priceChange.h1) {
              prompt += `${token.symbol} 1h Price Change: ${pool.priceChange.h1}%. `;
            }
          }
        }
        
        // Add additional price and market data if available
        if (token.metadata.price) {
          if (token.metadata.price.marketCap) {
            prompt += `${token.symbol} Market Cap: $${token.metadata.price.marketCap.toLocaleString()} USD. `;
          }
          if (token.metadata.price.current) {
            prompt += `${token.symbol} Current Price: $${token.metadata.price.current.toLocaleString()} USD. `;
          }
        }
        
        // Add pool data from database if available
        if (token.metadata.pools && token.metadata.pools.length > 0) {
          token.metadata.pools.forEach((pool, i) => {
            if (i < 2) { // Limit to top 2 pools
              prompt += `${token.symbol} ${pool.name}: Liquidity $${pool.liquidity?.toLocaleString() || 'N/A'} USD, `;
              prompt += `Volume $${pool.volume24h?.toLocaleString() || 'N/A'} USD. `;
            }
          });
        }
      }
    });
    
    // Add token tags if available
    const allTags = [];
    tokens.forEach(token => {
      if (token.tags && typeof token.tags === 'object') {
        try {
          if (Array.isArray(token.tags)) {
            allTags.push(...token.tags);
          } else {
            // Handle JSON object with tags
            Object.values(token.tags).forEach(tag => {
              if (typeof tag === 'string') allTags.push(tag);
            });
          }
        } catch (e) {
          // Ignore tag parsing errors
        }
      }
    });
    
    if (allTags.length > 0) {
      const uniqueTags = [...new Set(allTags)];
      prompt += ` Token categories: ${uniqueTags.join(', ')}. `;
    }
  }
  
  // Add guidance for the image style - explicitly request no text
  prompt += ` The image should be high-quality, modern, and visually striking, suitable for a crypto trading platform. Include crypto trading elements like charts, token symbols, and trading interfaces. IMPORTANT: DO NOT include any text, words, or labels in the image - create a purely visual experience without any readable text.`;
  
  return prompt.trim();
}

/**
 * Updates the image URL for an existing contest
 * @param {number} contestId - The ID of the contest to update
 * @param {string} imageUrl - The URL of the new image
 * @returns {Promise<Object>} - The updated contest
 */
async function updateContestImage(contestId, imageUrl) {
  try {
    const updatedContest = await prisma.contests.update({
      where: { id: contestId },
      data: { image_url: imageUrl }
    });
    
    logApi.info(`📝 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Updated image URL for contest ${contestId}`, {
      image_url: imageUrl
    });
    
    return updatedContest;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[contestImageService]${fancyColors.RESET} Failed to update image URL for contest ${contestId}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Regenerates an image for an existing contest
 * @param {number} contestId - The ID of the contest
 * @param {Object} options - Optional configuration for image generation
 * @returns {Promise<string>} - The URL of the newly generated image
 */
async function regenerateContestImage(contestId, options = {}) {
  try {
    // Fetch the contest data
    const contest = await prisma.contests.findUnique({
      where: { id: contestId }
    });
    
    if (!contest) {
      throw new Error(`Contest with ID ${contestId} not found`);
    }
    
    logApi.info(`🔄 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Regenerating image for contest ${contestId}`, {
      contest_name: contest.name,
      previous_image: contest.image_url,
      options: JSON.stringify(options)
    });
    
    // Generate a new image with specified options
    const imageUrl = await generateContestImage(contest, options);
    
    // Update the contest with the new image URL
    await updateContestImage(contestId, imageUrl);
    
    return imageUrl;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[contestImageService]${fancyColors.RESET} Failed to regenerate image for contest ${contestId}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Gets an existing image or generates a new one for a contest
 * @param {Object} contest - The contest object
 * @param {Object} options - Optional configuration for image generation
 * @returns {Promise<string>} - The URL of the image
 */
async function getOrGenerateContestImage(contest, options = {}) {
  try {
    // If the contest already has an image and no force regeneration, return it
    if (contest.image_url && !options.forceRegenerate) {
      return contest.image_url;
    }
    
    // Otherwise, generate a new image
    const imageUrl = await generateContestImage(contest, options);
    
    // If the contest has an ID, update it with the new image URL
    if (contest.id) {
      await updateContestImage(contest.id, imageUrl);
    }
    
    return imageUrl;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[contestImageService]${fancyColors.RESET} Failed to get or generate contest image`, {
      contest_id: contest.id,
      name: contest.name,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Returns the default configuration for image generation
 * @returns {Object} - Default configuration
 */
function getDefaultConfig() {
  return { ...DEFAULT_CONFIG };
}

export default {
  generateContestImage,
  updateContestImage,
  regenerateContestImage,
  getOrGenerateContestImage,
  getDefaultConfig,
  createImagePrompt // Export this for testing
};