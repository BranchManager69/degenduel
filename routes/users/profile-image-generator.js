// routes/users/profile-image-generator.js

// Route handler for AI-generated user profile images

import express from 'express';
import path from 'path';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { requireAuth } from '../../middleware/auth.js';
import AIApi from '../../api/aiApi.js';
import prisma from '../../config/prisma.js';

const router = express.Router();

/**
 * @swagger
 * /api/profile-image/generate/{walletAddress}:
 *   post:
 *     summary: Generate an AI profile image for a user
 *     description: Generates a unique AI profile image for the user based on the specified style
 *     tags: [Users, AI]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *         description: The wallet address of the user
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               style:
 *                 type: string
 *                 description: Style of the image (default, avatar, pixelart, cyberpunk, etc.)
 *               forceRegenerate:
 *                 type: boolean
 *                 description: Whether to force regeneration even if user already has a profile image
 *             example:
 *               style: "cyberpunk"
 *               forceRegenerate: true
 *     responses:
 *       200:
 *         description: Profile image generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 imageUrl:
 *                   type: string
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized - user can only generate their own profile image
 *       500:
 *         description: Server error during image generation
 */
router.post('/generate/:walletAddress', requireAuth, async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { 
      style = 'default', 
      forceRegenerate = false,
      sourceImages = [],
      tokenAddresses = []
    } = req.body;
    
    // Ensure users can only generate their own profile image (unless admin)
    if (req.wallet_address !== walletAddress && !req.is_admin && !req.is_superadmin) {
      return res.status(401).json({
        success: false,
        message: 'You can only generate profile images for your own account'
      });
    }
    
    // Common options
    const options = {
      style,
      forceRegenerate,
      metadata: {
        requested_by: req.wallet_address,
        ip: req.ip,
        user_agent: req.headers['user-agent']
      }
    };
    
    let imageUrl;
    
    // Check if we have source images or token addresses to incorporate
    if ((sourceImages && sourceImages.length > 0) || (tokenAddresses && tokenAddresses.length > 0)) {
      let imagePaths = [];
      
      // If sourceImages are provided, use them (these are direct paths)
      if (sourceImages && sourceImages.length > 0) {
        imagePaths = sourceImages;
      }
      
      // If token addresses are provided, get their logos
      if (tokenAddresses && tokenAddresses.length > 0) {
        try {
          // Look up token logos in database
          const tokens = await prisma.tokens.findMany({
            where: {
              address: {
                in: tokenAddresses
              }
            },
            select: {
              address: true,
              symbol: true,
              image_url: true,
              logo_url: true
            }
          });
          
          // Add token logos to imagePaths
          for (const token of tokens) {
            const logoUrl = token.logo_url || token.image_url;
            if (logoUrl) {
              // Convert from URL to local file path if needed
              if (logoUrl.startsWith('http')) {
                // This would require downloading the image - for simplicity we'll just use local paths
                logApi.info(`Skipping remote logo URL: ${logoUrl}`);
              } else {
                // Assume it's a local path
                const localPath = path.join(process.cwd(), 'public', logoUrl.replace(/^\//, ''));
                imagePaths.push(localPath);
              }
            }
          }
        } catch (err) {
          logApi.warn(`${fancyColors.YELLOW}[profile-image-generator]${fancyColors.RESET} Failed to get token logos: ${err.message}`);
        }
      }
      
      // If we have source images, use enhanced generation
      if (imagePaths.length > 0) {
        imageUrl = await AIApi.generateEnhancedProfileImage(walletAddress, imagePaths, options);
        
        logApi.info(`${fancyColors.CYAN}[profile-image-generator]${fancyColors.RESET} Generated enhanced AI profile image for user ${walletAddress}`, {
          style,
          image_url: imageUrl,
          source_image_count: imagePaths.length,
          force_regenerate: forceRegenerate
        });
      } else {
        // Fall back to standard generation
        imageUrl = await AIApi.generateUserProfileImage(walletAddress, options);
        
        logApi.info(`${fancyColors.CYAN}[profile-image-generator]${fancyColors.RESET} Generated standard AI profile image for user ${walletAddress}`, {
          style,
          image_url: imageUrl,
          force_regenerate: forceRegenerate
        });
      }
    } else {
      // Standard profile image generation
      imageUrl = await AIApi.generateUserProfileImage(walletAddress, options);
      
      logApi.info(`${fancyColors.CYAN}[profile-image-generator]${fancyColors.RESET} Generated AI profile image for user ${walletAddress}`, {
        style,
        image_url: imageUrl,
        force_regenerate: forceRegenerate
      });
    }
    
    return res.json({
      success: true,
      imageUrl,
      message: 'Profile image generated successfully'
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[profile-image-generator]${fancyColors.RESET} Failed to generate profile image:`, error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to generate profile image',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/profile-image/styles:
 *   get:
 *     summary: Get available profile image styles
 *     description: Returns list of available styles for AI-generated profile images
 *     tags: [Users, AI]
 *     responses:
 *       200:
 *         description: List of available styles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 styles:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 */
router.get('/styles', async (req, res) => {
  try {
    const styles = AIApi.getProfileImageStyles();
    
    return res.json({
      success: true,
      styles
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[profile-image-generator]${fancyColors.RESET} Failed to get profile image styles:`, error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile image styles',
      error: error.message
    });
  }
});

/**
 * Generate a test profile image for development purposes
 */
router.post('/test', async (req, res) => {
  try {
    const { prompt, style = 'default' } = req.body;
    
    const result = await AIApi.generateImage(
      prompt || 'Create a pixel art style avatar profile picture with vibrant colors, suitable for a crypto trading platform user',
      'profile',
      {
        identifier: 'test-user',
        metadata: {
          test: true,
          style
        }
      }
    );
    
    return res.json({
      success: true,
      result
    });
  } catch (error) {
    logApi.error(`${fancyColors.RED}[profile-image-generator]${fancyColors.RESET} Test profile image generation failed:`, error);
    
    return res.status(500).json({
      success: false,
      message: 'Failed to generate test profile image',
      error: error.message
    });
  }
});

export default router;