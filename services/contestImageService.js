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

// Initialize OpenAI API client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 
          config.openai?.apiKey || 
          (config.secrets && config.secrets.openai?.apiKey)
});

// Base directory for saving images
const IMAGES_DIR = path.join(process.cwd(), 'public', 'images', 'contests');

// Image generation configuration defaults
const DEFAULT_CONFIG = {
  model: "dall-e-3", // 'dall-e-3' for highest quality, 'dall-e-2' for faster/cheaper
  size: "1024x1024", // Options: "1024x1024", "1792x1024", "1024x1792" for DALL-E 3
  quality: "hd",     // 'hd' or 'standard' (hd is 2x cost but much better quality)
  style: "vivid",    // 'vivid' (more dramatic) or 'natural' (more realistic)
  randomPrompt: false // Add some randomness to prompts for variety
};

// Predefined art styles for contest images
const ART_STYLES = {
  CRYPTO_PUNK: "crypto punk style, vibrant neon colors, pixel art elements, retro-futuristic",
  VAPORWAVE: "vaporwave aesthetics, neon colors, retrofuturistic, 80s/90s computer graphics, glitchy elements",
  CYBERPUNK: "cyberpunk style, futuristic cityscape, neon-lit, high contrast, digital dystopia, holographic elements",
  ABSTRACT: "abstract digital art, flowing shapes, generative patterns, algorithmic design",
  MANGA: "manga/anime style, bold colors, action lines, dramatic lighting, character focused",
  SYNTHWAVE: "synthwave aesthetic, sunset gradients, neon grid, retrowave, purple and blue hues",
  MINIMALIST: "minimalist design, clean lines, limited color palette, simple shapes, high contrast",
  GLITCH: "digital glitch art, distorted elements, corrupt data aesthetics, techno-dystopian feel",
  GRADIENT: "smooth colorful gradients, flowing liquid-like transitions, vibrant colors bleeding into each other",
  DEFI: "decentralized finance symbols, blockchain visualization, crypto ecosystem, token networks"
};

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
    
    // Create prompt for image generation
    const prompt = createImagePrompt(name, description, config);
    
    logApi.info(`🎨 ${fancyColors.CYAN}[contestImageService]${fancyColors.RESET} Generating AI image for contest "${name}"`, {
      contest_id: contest.id,
      model: config.model,
      quality: config.quality,
      size: config.size,
      style: config.style,
      prompt_length: prompt.length
    });
    
    // Generate image using OpenAI API with the specified configuration
    const response = await openai.images.generate({
      model: config.model,
      prompt: prompt,
      n: 1,
      size: config.size,
      quality: config.quality,
      style: config.style,
      response_format: "b64_json" // Get base64 data directly
    });
    
    // Extract image data and the revised prompt (DALL-E 3 returns its own revised prompt)
    const imageData = response.data[0].b64_json;
    const revisedPrompt = response.data[0].revised_prompt;
    
    // Generate unique filename and save path
    const filename = `contest_${contest.id || 'new'}_${uuidv4()}.png`;
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
          revised_prompt: revisedPrompt,
          settings: config,
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
 * Creates an image generation prompt based on contest name and description with DegenDuel style
 * @param {string} name - Contest name
 * @param {string} description - Contest description
 * @param {Object} config - Configuration options
 * @returns {string} - Generated prompt for the image
 */
function createImagePrompt(name, description, config = {}) {
  // Extract contest's specific details and themes
  const contestThemes = extractKeyThemes(name, description);
  const specificTokens = extractSpecificTokens(name, description);
  const marketCondition = determineMarketCondition(description);
  const contestType = determineContestType(name, description);
  
  // Select art style based on contest details or random if specified
  let artStyle = "";
  if (config.artStyle && ART_STYLES[config.artStyle]) {
    artStyle = ART_STYLES[config.artStyle];
  } else if (specificTokens.length > 0 && specificTokens.some(t => t.toLowerCase().includes('sol'))) {
    artStyle = ART_STYLES.ABSTRACT;
  } else if (contestType.includes('bull')) {
    artStyle = ART_STYLES.GRADIENT;
  } else if (contestType.includes('bear')) {
    artStyle = ART_STYLES.GLITCH;
  } else {
    // Pick a random art style
    const styles = Object.values(ART_STYLES);
    artStyle = styles[Math.floor(Math.random() * styles.length)];
  }
  
  // Build the token-specific elements for the prompt
  let tokenElements = "";
  if (specificTokens.length > 0) {
    tokenElements = `featuring ${specificTokens.join(', ')} cryptocurrency symbols and logos, `;
  }
  
  // Core prompt focusing on DegenDuel's crypto dueling concept
  const basePrompt = `Create a high-impact banner image for a cryptocurrency trading contest on DegenDuel where traders are battling each other in a ${marketCondition} market. ${tokenElements}The image should be ultramodern, dynamic, and incorporate ${artStyle}.`;
  
  // Contest-specific details
  const contestDetails = `This specific contest is called "${name}" and focuses on ${contestThemes.join(', ')}. The contest type is ${contestType}.`;
  
  // Visual style guidance
  const styleGuidance = `Include abstract price charts, candlestick patterns, and crypto trading elements. The image should evoke excitement, competition, risk, and opportunity in cryptocurrency markets with a "degen" vibe.`;
  
  // Random additional elements for variety if enabled
  let additionalElements = "";
  if (config.randomPrompt) {
    const randomElements = [
      "Include subtle rocket emojis symbolizing 'to the moon'",
      "Add some subtle 'diamond hands' references",
      "Include abstract bull and bear symbols fighting",
      "Incorporate subtle 'WAGMI' (We're All Gonna Make It) energy",
      "Show stylized trading terminals and crypto wallets",
      "Add subtle laser eyes effect, popular in crypto culture",
      "Include futuristic trading arena elements",
      "Show digital warriors battling with crypto tokens as weapons"
    ];
    
    additionalElements = " " + randomElements[Math.floor(Math.random() * randomElements.length)] + ".";
  }
  
  // Assemble the final prompt
  return `${basePrompt} ${contestDetails} ${styleGuidance}${additionalElements}`;
}

/**
 * Extract key themes from contest name and description
 * @param {string} name - Contest name 
 * @param {string} description - Contest description
 * @returns {Array} - Array of key themes for the prompt
 */
function extractKeyThemes(name, description) {
  // Default themes if we can't extract specific ones
  const defaultThemes = ["cryptocurrency trading", "competition", "DeFi"];
  
  // Handle case when description is missing
  if (!description || description.length < 10) {
    return defaultThemes;
  }
  
  // Combined text for keyword extraction
  const combinedText = (name + " " + description).toLowerCase();
  
  // Extensive keyword list for crypto trading
  const keywordsList = [
    // Market conditions
    "bull", "bear", "market", "rally", "dump", "moon", "crash", 
    
    // Trading concepts
    "trading", "chart", "portfolio", "invest", "profit", "loss",
    "strategy", "volatility", "risk", "growth", "hodl", "position",
    
    // Crypto specific
    "crypto", "token", "coin", "NFT", "blockchain", "defi", "dex", 
    "yield", "stake", "liquidity", "mining", "wallet", "exchange",
    
    // Ecosystems
    "solana", "ethereum", "bitcoin", "btc", "eth", "sol", "meme", 
    "memecoin", "altcoin", "dao", "metaverse", "web3"
  ];
  
  // Find mentions of keywords
  const foundKeywords = keywordsList.filter(keyword => 
    combinedText.includes(keyword)
  );
  
  // Return either found keywords or defaults if none found
  return foundKeywords.length > 0 ? foundKeywords : defaultThemes;
}

/**
 * Extract specific token mentions from contest name and description
 * @param {string} name - Contest name
 * @param {string} description - Contest description
 * @returns {Array} - Array of specific tokens mentioned
 */
function extractSpecificTokens(name, description) {
  const tokens = [];
  const combinedText = (name + " " + description).toUpperCase();
  
  // Common tokens to look for
  const commonTokens = [
    "BTC", "ETH", "SOL", "BONK", "DUEL", "USDC", "USDT", 
    "SHIB", "DOGE", "PEPE", "JUP", "PYTH", "RAY", "ORCA"
  ];
  
  // Look for token symbols
  commonTokens.forEach(token => {
    // Check for token as a standalone word (with word boundaries)
    if (new RegExp(`\\b${token}\\b`).test(combinedText)) {
      tokens.push(token);
    }
  });
  
  // Also look for Dollar sign prefixed tokens like $SOL
  const dollarTokenRegex = /\$([A-Z]{2,10})/g;
  let match;
  while ((match = dollarTokenRegex.exec(combinedText)) !== null) {
    tokens.push(match[1]);
  }
  
  // Return unique tokens
  return [...new Set(tokens)];
}

/**
 * Determine market condition from description
 * @param {string} description - Contest description
 * @returns {string} - Market condition
 */
function determineMarketCondition(description) {
  if (!description) return "volatile";
  
  const text = description.toLowerCase();
  
  if (text.includes("bull") || 
      text.includes("rally") || 
      text.includes("moon") ||
      text.includes("pump")) {
    return "bullish";
  }
  
  if (text.includes("bear") || 
      text.includes("crash") || 
      text.includes("dump") ||
      text.includes("dip")) {
    return "bearish";
  }
  
  if (text.includes("sideways") ||
      text.includes("consolidation") ||
      text.includes("ranging")) {
    return "sideways";
  }
  
  return "volatile";
}

/**
 * Determine contest type from name and description
 * @param {string} name - Contest name
 * @param {string} description - Contest description
 * @returns {string} - Contest type
 */
function determineContestType(name, description) {
  const combinedText = (name + " " + description).toLowerCase();
  
  if (combinedText.includes("bull") || combinedText.includes("rally")) {
    return "bull market challenge";
  }
  
  if (combinedText.includes("bear") || combinedText.includes("crash")) {
    return "bear market survival";
  }
  
  if (combinedText.includes("meme") || combinedText.includes("degen")) {
    return "meme coin degen challenge";
  }
  
  if (combinedText.includes("weekly")) {
    return "weekly trading competition";
  }
  
  if (combinedText.includes("daily")) {
    return "daily trading sprint";
  }
  
  if (combinedText.includes("solana")) {
    return "Solana ecosystem showdown";
  }
  
  // Default contest type
  return "crypto trading showdown";
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
 * Returns all available art styles for image generation
 * @returns {Object} - Available art styles
 */
function getAvailableArtStyles() {
  return ART_STYLES;
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
  getAvailableArtStyles,
  getDefaultConfig
};