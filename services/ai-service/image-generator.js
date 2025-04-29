// services/ai-service/image-generator.js
// Multi-purpose AI image generation module for the AI service

import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import { config } from '../../config/config.js';

// ----------------------------------------------------------
// CONFIGURABLE VALUES - Edit these to customize image generation
// ----------------------------------------------------------

// Base directories for saving different types of images - use config values if available
const IMAGE_DIRS = {
  profile: config.paths?.profileImages || path.join(process.cwd(), 'public', 'images', 'profiles'),
  contest: config.paths?.contestImages || path.join(process.cwd(), 'public', 'images', 'contests'),
  general: config.paths?.generatedImages || path.join(process.cwd(), 'public', 'images', 'generated'),
  uploads: config.paths?.uploadsDir || path.join(process.cwd(), 'uploads'),
  masks: config.paths?.maskImages || path.join(process.cwd(), 'public', 'images', 'masks'),
  source: config.paths?.sourceImages || path.join(process.cwd(), 'public', 'images', 'source')
};

// Profile image style prompts - these define the different visual styles available
const PROFILE_STYLE_PROMPTS = {
  default: `Create a high-quality profile picture. The image should be a creative abstract design that would make a good profile picture. Use vibrant colors, interesting patterns, and modern design elements. Make it visually striking and unique.`,
  
  avatar: `Create a stylized avatar character. Create a professional, friendly-looking cartoon character portrait with a clean background. The character should have distinctive features and a welcoming expression. Make it suitable for a professional profile picture.`,
  
  pixelart: `Create a pixel art style avatar. Use a retro 16-bit pixel art style with vibrant colors and clear details. The avatar should have character and personality while maintaining the classic pixel aesthetic.`,
  
  cyberpunk: `Create a cyberpunk-themed profile picture. Use neon colors, digital elements, and futuristic cyberpunk aesthetics. Include glowing elements, circuit patterns, and a high-tech feel.`,
  
  minimalist: `Create a minimalist, modern profile picture. Use simple shapes, clean lines, and a limited color palette. The design should be elegant, uncluttered, and contemporary.`,
  
  space: `Create a cosmic space-themed profile picture. Include elements like galaxies, nebulae, planets, or stars with vibrant cosmic colors. Create a sense of wonder and vastness while being visually striking.`,
  
  crypto: `Create a cryptocurrency/blockchain themed profile picture. Include subtle elements related to digital finance, blockchain, and crypto culture, using a modern and professional design language.`
};

// Default configurations for different image types
const CONFIG_TEMPLATES = {
  // Square format ideal for profile pictures
  profile: {
    model: config.ai?.image_model || "gpt-image-1",
    size: "1024x1024",
    quality: config.ai?.image_quality || "medium",  // Options: "high", "medium", "low"
    output_format: "png",
    background: "auto",
    moderation: "low"
  },
  
  // Landscape format ideal for contest banners
  contest: {
    model: config.ai?.image_model || "gpt-image-1",
    size: "1536x1024",
    quality: config.ai?.image_quality || "medium",
    output_format: "png",
    background: "auto",
    moderation: "low"
  },
  
  // General purpose default
  general: {
    model: config.ai?.image_model || "gpt-image-1",
    size: "1024x1024",
    quality: config.ai?.image_quality || "medium",
    output_format: "png",
    background: "auto",
    moderation: "low"
  }
};

// Initialize OpenAI API client with dedicated image generation API key
const openai = new OpenAI({
  apiKey: config.api_keys.openai_image || config.api_keys.openai
});

// Ensure all image directories exist
async function ensureDirectories() {
  for (const dir of Object.values(IMAGE_DIRS)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Generates an AI image based on prompt and configuration
 * @param {string} prompt - The prompt for image generation
 * @param {string} imageType - Type of image (profile, contest, general)
 * @param {Object} options - Additional options and metadata
 * @returns {Promise<Object>} - Object containing the image URL and metadata
 */
async function generateImage(prompt, imageType = 'general', options = {}) {
  try {
    await ensureDirectories();
    
    // Get the appropriate configuration template and merge with options
    const baseConfig = CONFIG_TEMPLATES[imageType] || CONFIG_TEMPLATES.general;
    const config = { ...baseConfig, ...options.config };
    
    // Select the appropriate directory
    const outputDir = IMAGE_DIRS[imageType] || IMAGE_DIRS.general;
    
    logApi.info(`🎨 ${fancyColors.CYAN}[aiService:imageGenerator]${fancyColors.RESET} Generating AI image (${imageType})`, {
      prompt_length: prompt.length,
      model: config.model,
      quality: config.quality,
      size: config.size,
      type: imageType,
      metadata: options.metadata || {}
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
    
    // Generate image using OpenAI API
    const response = await openai.images.generate(requestParams);
    
    // Extract image data (base64 for GPT-Image-1)
    const imageData = response.data[0].b64_json;
    
    // Log token usage if available
    if (response.usage) {
      logApi.info(`${fancyColors.CYAN}[aiService:imageGenerator]${fancyColors.RESET} Token usage:`, {
        total_tokens: response.usage.total_tokens,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      });
    }
    
    // Generate filename based on type and provided identifier
    const fileExt = config.output_format || 'png';
    let filename;
    
    if (options.filename) {
      // Use provided filename if available
      filename = `${options.filename}.${fileExt}`;
    } else if (options.identifier) {
      // Generate filename based on identifier and timestamp
      const timestamp = new Date().getTime();
      const id = typeof options.identifier === 'string' 
        ? options.identifier.substring(0, 8) 
        : 'img';
      filename = `${id}-${timestamp}.${fileExt}`;
    } else {
      // Generate completely random filename with UUID
      filename = `gen-${uuidv4()}.${fileExt}`;
    }
    
    // Full path for saving the image
    const imagePath = path.join(outputDir, filename);
    
    // Save the image to disk
    await fs.writeFile(imagePath, Buffer.from(imageData, 'base64'));
    
    // Construct the public URL
    const imageUrl = `/images/${imageType === 'general' ? 'generated' : 
                      imageType === 'profile' ? 'profiles' : 
                      imageType === 'contest' ? 'contests' : 'generated'}/${filename}`;
    
    // Log success
    logApi.info(`✅ ${fancyColors.GREEN}[aiService:imageGenerator]${fancyColors.RESET} Generated and saved AI image`, {
      type: imageType,
      image_url: imageUrl,
      image_size_bytes: Buffer.from(imageData, 'base64').length,
      model: config.model,
      quality: config.quality
    });
    
    // Optionally save the prompt info for reference
    if (config.savePrompt) {
      try {
        const promptInfo = {
          original_prompt: prompt,
          settings: config,
          metadata: options.metadata || {},
          generated_at: new Date().toISOString()
        };
        
        const promptPath = path.join(outputDir, `${path.parse(filename).name}.json`);
        await fs.writeFile(promptPath, JSON.stringify(promptInfo, null, 2));
      } catch (promptError) {
        logApi.warn(`⚠️ ${fancyColors.YELLOW}[aiService:imageGenerator]${fancyColors.RESET} Failed to save prompt info, but image was generated successfully`, {
          error: promptError.message
        });
      }
    }
    
    // Return result with URL and metadata
    return {
      url: imageUrl,
      type: imageType,
      model: config.model,
      quality: config.quality,
      size: config.size,
      generated_at: new Date().toISOString(),
      metadata: options.metadata || {}
    };
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[aiService:imageGenerator]${fancyColors.RESET} Failed to generate image`, {
      type: imageType,
      error: error.message,
      stack: error.stack,
      metadata: options.metadata || {}
    });
    throw error;
  }
}

/**
 * Generates a user profile image based on user data
 * @param {string} walletAddress - User's wallet address
 * @param {Object} options - Generation options including style
 * @returns {Promise<string>} - URL of the generated profile image
 */
async function generateUserProfileImage(walletAddress, options = {}) {
  try {
    // Find the user with related data
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
    
    // Check if the user already has a profile image
    if (user.profile_image_url && !options.forceRegenerate) {
      return user.profile_image_url;
    }
    
    // Create the prompt based on user data and style
    const style = options.style || 'default';
    const prompt = createProfileImagePrompt(user, style);
    
    // Generate the image
    const result = await generateImage(prompt, 'profile', {
      identifier: walletAddress,
      metadata: {
        wallet_address: walletAddress,
        display_name: user.nickname || user.username || 'User',
        style: style
      },
      config: options.config || {}
    });
    
    // Update the user's profile image URL in the database
    await prisma.users.update({
      where: { wallet_address: walletAddress },
      data: { 
        profile_image_url: result.url,
        profile_image_updated_at: new Date()
      }
    });
    
    return result.url;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[aiService:imageGenerator]${fancyColors.RESET} Failed to generate profile image`, {
      wallet_address: walletAddress,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Creates a prompt for profile image generation based on user data and style
 * @param {Object} user - User data to personalize the image
 * @param {string} style - Style category for the image
 * @returns {string} - Generated prompt for the image
 */
function createProfileImagePrompt(user, style = "default") {
  const { nickname, username, user_stats, user_level, user_achievements } = user;
  const displayName = nickname || username || 'User';
  
  // Get the base prompt for the selected style from our configuration constants
  let basePrompt = PROFILE_STYLE_PROMPTS[style] || PROFILE_STYLE_PROMPTS.default;
  
  // Insert user's name into the prompt
  let prompt = basePrompt.replace(/profile picture/g, `profile picture for a user named "${displayName}"`);
  
  // Add user achievements if available
  if (user_achievements && user_achievements.length > 0) {
    prompt += ` Consider that this user has achievements related to: ${user_achievements.map(a => a.title || 'trading').join(', ')}.`;
  }
  
  // Add user level if available
  if (user_level) {
    prompt += ` The user has reached level ${user_level.level_number} and has the title "${user_level.title || 'Trader'}".`;
  }
  
  // Add user stats if available
  if (user_stats) {
    if (user_stats.contests_entered && user_stats.contests_won) {
      prompt += ` The user has entered ${user_stats.contests_entered} contests and won ${user_stats.contests_won}.`;
    }
    
    if (user_stats.trade_count) {
      prompt += ` The user has made ${user_stats.trade_count} trades.`;
    }
  }
  
  // Add explicit guidance - this should always be included for consistency
  prompt += ` IMPORTANT: DO NOT include any text, letters, numbers, or words in the image. DO NOT include a frame, border, or any UI elements. The image should be a standalone visual design without any text elements whatsoever. Create a centered composition that works well as a profile picture.`;
  
  return prompt.trim();
}

/**
 * Get available style options for profile images
 * @returns {Array<Object>} - List of available styles with descriptions
 */
function getProfileImageStyles() {
  // Generate style options based on our constant PROFILE_STYLE_PROMPTS
  const styleDescriptions = {
    "default": "Creative abstract design with vibrant colors and patterns",
    "avatar": "Stylized cartoon character portrait",
    "pixelart": "Retro 16-bit pixel art style",
    "cyberpunk": "Futuristic design with neon colors and tech elements",
    "minimalist": "Clean, simple design with limited color palette",
    "space": "Space-themed with galaxies, stars and cosmic elements",
    "crypto": "Cryptocurrency/blockchain themed design"
  };
  
  const styleNames = {
    "default": "Abstract",
    "avatar": "Character",
    "pixelart": "Pixel Art",
    "cyberpunk": "Cyberpunk",
    "minimalist": "Minimalist",
    "space": "Cosmic",
    "crypto": "Crypto"
  };
  
  // Generate the style list based on available PROFILE_STYLE_PROMPTS
  return Object.keys(PROFILE_STYLE_PROMPTS).map(styleId => ({
    id: styleId,
    name: styleNames[styleId] || styleId.charAt(0).toUpperCase() + styleId.slice(1),
    description: styleDescriptions[styleId] || "Custom style option"
  }));
}

/**
 * Returns configuration templates for different image types
 * @returns {Object} - Configuration templates
 */
function getConfigTemplates() {
  return { ...CONFIG_TEMPLATES };
}

/**
 * Generates an image edit using source images and a prompt
 * @param {Array|string} sourceImages - Path(s) to source image(s) or Buffer(s)
 * @param {string} prompt - The prompt describing the desired edits
 * @param {string|null} maskPath - Optional path to mask image (transparent areas will be edited)
 * @param {Object} options - Additional options for generation
 * @returns {Promise<Object>} - Object containing the image URL and metadata
 */
async function generateImageEdit(sourceImages, prompt, maskPath = null, options = {}) {
  try {
    await ensureDirectories();
    
    // Prepare the image files
    const imageFiles = [];
    
    // Handle array of images or single image
    const imagesToProcess = Array.isArray(sourceImages) ? sourceImages : [sourceImages];
    
    // Convert all source images to OpenAI-compatible format
    for (const imagePath of imagesToProcess) {
      try {
        // If imagePath is already a Buffer, use it directly
        if (Buffer.isBuffer(imagePath)) {
          imageFiles.push(await openai.files.create({
            file: imagePath,
            purpose: 'assistants'
          }));
          continue;
        }
        
        // Check if image exists
        await fs.access(imagePath);
        
        // Read image file and convert to OpenAI format
        const imageBuffer = await fs.readFile(imagePath);
        
        // Use the OpenAI SDK's method to prepare files
        const formData = new FormData();
        formData.append('purpose', 'assistants');
        formData.append('file', new Blob([imageBuffer]));
        
        const fileObj = await openai.files.create(formData);
        imageFiles.push(fileObj);
      } catch (err) {
        logApi.warn(`${fancyColors.YELLOW}[aiService:imageGenerator]${fancyColors.RESET} Failed to process source image: ${err.message}`);
      }
    }
    
    if (imageFiles.length === 0) {
      throw new Error('No valid source images provided');
    }
    
    logApi.info(`${fancyColors.CYAN}[aiService:imageGenerator]${fancyColors.RESET} Generating image edit with ${imageFiles.length} source images`, {
      prompt_length: prompt.length,
      has_mask: !!maskPath,
      metadata: options.metadata || {}
    });
    
    // Prepare mask if provided
    let maskFile = null;
    if (maskPath) {
      try {
        await fs.access(maskPath);
        const maskBuffer = await fs.readFile(maskPath);
        
        const formData = new FormData();
        formData.append('purpose', 'assistants');
        formData.append('file', new Blob([maskBuffer]));
        
        maskFile = await openai.files.create(formData);
      } catch (err) {
        logApi.warn(`${fancyColors.YELLOW}[aiService:imageGenerator]${fancyColors.RESET} Failed to process mask image: ${err.message}`);
      }
    }
    
    // Get config
    const config = { 
      ...CONFIG_TEMPLATES.general, 
      ...(options.config || {}) 
    };
    
    // Create the edit request
    const requestParams = {
      model: config.model,
      image: imageFiles,
      prompt: prompt,
      n: 1,
      size: config.size,
      quality: config.quality
    };
    
    // Add mask if available
    if (maskFile) {
      requestParams.mask = maskFile;
    }
    
    // Call the OpenAI API to create the edit
    const response = await openai.images.edit(requestParams);
    
    // Get the image data
    const imageData = response.data[0].b64_json;
    
    // Handle file saving similar to generateImage
    const fileExt = config.output_format || 'png';
    let filename;
    
    if (options.filename) {
      filename = `${options.filename}.${fileExt}`;
    } else {
      // Generate unique filename
      const timestamp = new Date().getTime();
      const id = options.identifier || 'edit';
      filename = `${id}-${timestamp}.${fileExt}`;
    }
    
    // Determine the output directory
    const outputDir = options.outputDir || IMAGE_DIRS.general;
    const imagePath = path.join(outputDir, filename);
    
    // Save the image
    await fs.writeFile(imagePath, Buffer.from(imageData, 'base64'));
    
    // Construct the public URL
    const imageUrl = `/images/generated/${filename}`;
    
    // Log success
    logApi.info(`✅ ${fancyColors.GREEN}[aiService:imageGenerator]${fancyColors.RESET} Generated and saved image edit`, {
      image_url: imageUrl,
      image_size_bytes: Buffer.from(imageData, 'base64').length,
      model: config.model,
      quality: config.quality,
      source_image_count: imageFiles.length
    });
    
    // Return result with URL and metadata
    return {
      url: imageUrl,
      type: 'edit',
      model: config.model,
      quality: config.quality,
      size: config.size,
      generated_at: new Date().toISOString(),
      metadata: options.metadata || {}
    };
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[aiService:imageGenerator]${fancyColors.RESET} Failed to generate image edit`, {
      error: error.message,
      stack: error.stack,
      metadata: options.metadata || {}
    });
    throw error;
  }
}

/**
 * Generates a profile image that incorporates token logos or other visual elements
 * @param {string} walletAddress - User's wallet address
 * @param {Array} sourceImages - Array of image paths to incorporate (logos, etc.)
 * @param {Object} options - Generation options including style
 * @returns {Promise<string>} - URL of the generated profile image
 */
async function generateEnhancedProfileImage(walletAddress, sourceImages = [], options = {}) {
  try {
    // Find the user with related data
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
    
    // Check if we have source images to use
    if (!sourceImages || sourceImages.length === 0) {
      // Fall back to standard generation if no source images
      return generateUserProfileImage(walletAddress, options);
    }
    
    // Create the prompt based on user data and style
    const style = options.style || 'default';
    const prompt = createProfileImagePrompt(user, style);
    
    // Enhance the prompt with specific instructions for incorporating the source images
    const enhancedPrompt = `${prompt} Incorporate the provided images (token logos, symbols) into the design in a creative and professional way. Make them part of the composition while maintaining the overall style and aesthetic.`;
    
    // Set the output directory to profile images
    const outputOptions = {
      ...options,
      outputDir: IMAGE_DIRS.profile,
      identifier: walletAddress,
      metadata: {
        wallet_address: walletAddress,
        display_name: user.nickname || user.username || 'User',
        style: style,
        source_images: sourceImages.map(img => typeof img === 'string' ? path.basename(img) : 'buffer')
      }
    };
    
    // Generate the edited image
    const result = await generateImageEdit(sourceImages, enhancedPrompt, null, outputOptions);
    
    // Update the user's profile image URL in the database
    await prisma.users.update({
      where: { wallet_address: walletAddress },
      data: { 
        profile_image_url: result.url,
        profile_image_updated_at: new Date()
      }
    });
    
    return result.url;
  } catch (error) {
    logApi.error(`❌ ${fancyColors.RED}[aiService:imageGenerator]${fancyColors.RESET} Failed to generate enhanced profile image`, {
      wallet_address: walletAddress,
      error: error.message,
      stack: error.stack
    });
    
    // Try falling back to standard generation
    try {
      logApi.warn(`${fancyColors.YELLOW}[aiService:imageGenerator]${fancyColors.RESET} Falling back to standard profile image generation`);
      return generateUserProfileImage(walletAddress, options);
    } catch (fallbackError) {
      throw error; // Throw the original error
    }
  }
}

// Export the module
export default {
  generateImage,
  generateUserProfileImage,
  generateImageEdit,
  generateEnhancedProfileImage,
  getProfileImageStyles,
  getConfigTemplates
};