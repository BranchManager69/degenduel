// userProfileImageService.js
// Service to generate AI-created profile images for users

import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';
import { config } from '../config/config.js';

// Initialize OpenAI API client with dedicated image generation API key
const openai = new OpenAI({
  apiKey: config.api_keys.openai_image || config.api_keys.openai
});

// Base directory for saving profile images
const IMAGES_DIR = path.join(process.cwd(), 'public', 'images', 'profiles');

// GPT-Image-1 configuration for profile images
const DEFAULT_CONFIG = {
  model: "gpt-image-1",     // Using GPT-Image-1 as default model
  size: "1024x1024",        // Square format for profile pictures
  quality: "medium",        // Options: "high", "medium", "low" (cost per image: $0.19, $0.07, and $0.02, respectively)
  output_format: "png",     // Options: "png", "jpeg", "webp"
  background: "auto",       // Options: "transparent", "opaque", "auto"
  moderation: "low",        // Options: "low", "auto"
};

/**
 * Generates an AI profile image for a user based on their preferences
 * @param {Object} user - The user object with name/nickname and preferences
 * @param {Object} options - Optional configuration for image generation
 * @returns {Promise<string>} - The URL of the generated image
 */
async function generateUserProfileImage(user, options = {}) {
  try {
    const config = { ...DEFAULT_CONFIG, ...options };
    
    // Ensure images directory exists
    await fs.mkdir(IMAGES_DIR, { recursive: true });
    
    // Extract user data for the prompt
    const { wallet_address, nickname, username } = user;
    const displayName = nickname || username || 'User';
    
    // Create prompt for image generation
    const prompt = createProfileImagePrompt(user, options.promptStyle || "default");
    
    logApi.info(`🎨 ${fancyColors.CYAN}[userProfileImageService]${fancyColors.RESET} Generating AI profile image for "${displayName}"`, {
      wallet_address,
      model: config.model,
      quality: config.quality,
      size: config.size,
      prompt_length: prompt.length,
      style: options.promptStyle || "default"
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
    
    // Generate image using OpenAI API with the specified configuration
    const response = await openai.images.generate(requestParams);
    
    // GPT-Image-1 always returns base64-encoded images
    const imageData = response.data[0].b64_json;
    
    // Log token usage
    if (response.usage) {
      logApi.info(`${fancyColors.CYAN}[userProfileImageService]${fancyColors.RESET} Token usage:`, {
        total_tokens: response.usage.total_tokens,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      });
    }
    
    // Determine file extension based on output format
    const fileExt = config.output_format || 'png';
    
    // Generate unique filename based on wallet address and timestamp
    const uniqueId = wallet_address.substring(0, 8);
    const timestamp = new Date().getTime();
    const filename = `${uniqueId}-${timestamp}.${fileExt}`;
    
    const imagePath = path.join(IMAGES_DIR, filename);
    
    // Save the image to disk
    await fs.writeFile(imagePath, Buffer.from(imageData, 'base64'));
    
    // Return public URL of the image
    const imageUrl = `/images/profiles/${filename}`;
    
    logApi.info(`✅ ${fancyColors.GREEN}[userProfileImageService]${fancyColors.RESET} Generated and saved AI profile image`, {
      wallet_address,
      display_name: displayName,
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
          user_data: {
            wallet_address,
            display_name: displayName
          },
          style: options.promptStyle || "default",
          generated_at: new Date().toISOString()
        };
        
        const promptPath = path.join(IMAGES_DIR, `${path.parse(filename).name}.json`);
        await fs.writeFile(promptPath, JSON.stringify(promptInfo, null, 2));
      } catch (promptError) {
        logApi.warn(`⚠️ ${fancyColors.YELLOW}[userProfileImageService]${fancyColors.RESET} Failed to save prompt info, but image was generated successfully`, {
          error: promptError.message
        });
      }
    }
    
    return imageUrl;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[userProfileImageService]${fancyColors.RESET} Failed to generate profile image`, {
      wallet_address: user.wallet_address,
      name: user.nickname || user.username,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Creates a prompt for profile image generation based on user data and style
 * @param {Object} user - User data to personalize the image
 * @param {string} style - Style category for the image (default, avatar, pixelart, etc.)
 * @returns {string} - Generated prompt for the image
 */
function createProfileImagePrompt(user, style = "default") {
  const { nickname, username, user_stats, user_level, user_achievements } = user;
  const displayName = nickname || username || 'User';
  
  // Base prompt templates for different styles
  const stylePrompts = {
    default: `Create a high-quality profile picture for a user named "${displayName}". The image should be a creative abstract design that would make a good profile picture. Use vibrant colors, interesting patterns, and modern design elements. Make it visually striking and unique.`,
    
    avatar: `Create a stylized avatar character for user "${displayName}". Create a professional, friendly-looking cartoon character portrait with a clean background. The character should have distinctive features and a welcoming expression. Make it suitable for a professional profile picture.`,
    
    pixelart: `Create a pixel art style avatar for user "${displayName}". Use a retro 16-bit pixel art style with vibrant colors and clear details. The avatar should have character and personality while maintaining the classic pixel aesthetic.`,
    
    cyberpunk: `Create a cyberpunk-themed profile picture for user "${displayName}". Use neon colors, digital elements, and futuristic cyberpunk aesthetics. Include glowing elements, circuit patterns, and a high-tech feel.`,
    
    minimalist: `Create a minimalist, modern profile picture for user "${displayName}". Use simple shapes, clean lines, and a limited color palette. The design should be elegant, uncluttered, and contemporary.`,
    
    space: `Create a cosmic space-themed profile picture for user "${displayName}". Include elements like galaxies, nebulae, planets, or stars with vibrant cosmic colors. Create a sense of wonder and vastness while being visually striking.`,
    
    crypto: `Create a cryptocurrency/blockchain themed profile picture for user "${displayName}". Include subtle elements related to digital finance, blockchain, and crypto culture, using a modern and professional design language.`
  };
  
  // Select the base prompt based on style
  let prompt = stylePrompts[style] || stylePrompts.default;
  
  // Add user achievements if available
  if (user_achievements && user_achievements.length > 0) {
    prompt += ` Consider that this user has achievements related to: ${user_achievements.map(a => a.title || 'trading').join(', ')}.`;
  }
  
  // Add user level if available
  if (user_level) {
    prompt += ` The user has reached level ${user_level.level_number} and has the title "${user_level.title || 'Trader'}".`;
  }
  
  // Add explicit guidance
  prompt += ` IMPORTANT: DO NOT include any text, letters, numbers, or words in the image. DO NOT include a frame, border, or any UI elements. The image should be a standalone visual design without any text elements whatsoever. Create a centered composition that works well as a profile picture.`;
  
  return prompt.trim();
}

/**
 * Updates a user's profile image URL in the database
 * @param {string} walletAddress - User's wallet address
 * @param {string} imageUrl - URL of the new profile image
 * @returns {Promise<Object>} - Updated user object
 */
async function updateUserProfileImage(walletAddress, imageUrl) {
  try {
    const updatedUser = await prisma.users.update({
      where: { wallet_address: walletAddress },
      data: { 
        profile_image_url: imageUrl,
        profile_image_updated_at: new Date()
      }
    });
    
    logApi.info(`📝 ${fancyColors.CYAN}[userProfileImageService]${fancyColors.RESET} Updated profile image for user ${walletAddress}`, {
      image_url: imageUrl
    });
    
    return updatedUser;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[userProfileImageService]${fancyColors.RESET} Failed to update profile image for user ${walletAddress}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get profile image URL for a user, generating a new one if needed
 * @param {string} walletAddress - User's wallet address 
 * @param {Object} options - Options for image generation
 * @returns {Promise<string>} - URL of the profile image
 */
async function getOrGenerateProfileImage(walletAddress, options = {}) {
  try {
    // Find the user
    const user = await prisma.users.findUnique({
      where: { wallet_address: walletAddress },
      include: {
        user_level: true,
        user_achievements: {
          take: 3,
          orderBy: { achieved_at: 'desc' }
        }
      }
    });
    
    if (!user) {
      throw new Error(`User with wallet address ${walletAddress} not found`);
    }
    
    // If the user already has a profile image and we're not forcing regeneration, return it
    if (user.profile_image_url && !options.forceRegenerate) {
      return user.profile_image_url;
    }
    
    // Generate a new profile image
    const imageUrl = await generateUserProfileImage(user, options);
    
    // Update the user's profile image URL in the database
    await updateUserProfileImage(walletAddress, imageUrl);
    
    return imageUrl;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[userProfileImageService]${fancyColors.RESET} Failed to get/generate profile image`, {
      wallet_address: walletAddress,
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

/**
 * Returns available style options for profile image generation
 * @returns {Array<string>} - List of available style options
 */
function getAvailableStyles() {
  return [
    "default",
    "avatar",
    "pixelart",
    "cyberpunk",
    "minimalist",
    "space",
    "crypto"
  ];
}

// Export the service functions
export default {
  generateUserProfileImage,
  updateUserProfileImage,
  getOrGenerateProfileImage,
  getDefaultConfig,
  getAvailableStyles,
  createProfileImagePrompt // Export for testing
};