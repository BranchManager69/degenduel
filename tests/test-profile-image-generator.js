// tests/test-profile-image-generator.js
// Test script for the AI profile image generator

import AIApi from '../api/aiApi.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import prisma from '../config/prisma.js';
import { config } from '../config/config.js';
import path from 'path';
import fs from 'fs/promises';

// Use an admin wallet from config if available, or prompt user to enter a test wallet
const TEST_WALLET = config.admin?.wallet || process.argv[2];

// Test with token logos or source images if specified
const SOURCE_IMAGES = process.argv[3] ? process.argv[3].split(',') : [];

async function main() {
  try {
    console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Testing AI Profile Image Generator`);
    
    // Validate we have a wallet to test with
    if (!TEST_WALLET) {
      console.error(`${fancyColors.RED}[ERROR]${fancyColors.RESET} No test wallet provided. Usage: node test-profile-image-generator.js <wallet_address> [source_image_paths]`);
      console.error(`${fancyColors.YELLOW}[INFO]${fancyColors.RESET} You can also configure an admin wallet in your config file.`);
      process.exit(1);
    }
    
    // Get available profile image styles
    const styles = AIApi.getProfileImageStyles();
    console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Available styles:`, 
      styles.map(s => `${s.id} (${s.name})`).join(', '));
    
    // Get a random style
    const randomStyle = styles[Math.floor(Math.random() * styles.length)];
    console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Using style: ${randomStyle.id} (${randomStyle.name})`);
    
    // Check if we have source images to use for enhanced profile image generation
    const validSourceImages = [];
    
    if (SOURCE_IMAGES.length > 0) {
      console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Checking provided source images...`);
      
      for (const imgPath of SOURCE_IMAGES) {
        try {
          await fs.access(imgPath);
          validSourceImages.push(imgPath);
          console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Valid source image: ${imgPath}`);
        } catch (err) {
          console.log(`${fancyColors.RED}[TEST]${fancyColors.RESET} Invalid source image path: ${imgPath}`);
        }
      }
    }
    
    let imageUrl;
    
    // If we have source images, test enhanced profile image generation
    if (validSourceImages.length > 0) {
      console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Generating enhanced profile image with ${validSourceImages.length} source images...`);
      
      imageUrl = await AIApi.generateEnhancedProfileImage(TEST_WALLET, validSourceImages, {
        style: randomStyle.id,
        forceRegenerate: true,
        metadata: {
          test: true
        }
      });
      
      console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Enhanced profile image generated successfully!`);
      console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Source images used:`, validSourceImages);
    } else {
      // Generate a standard profile image
      console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Generating standard profile image for wallet ${TEST_WALLET}...`);
      
      imageUrl = await AIApi.generateUserProfileImage(TEST_WALLET, {
        style: randomStyle.id,
        forceRegenerate: true,
        metadata: {
          test: true
        }
      });
      
      console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Standard profile image generated successfully!`);
    }
    
    console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Image URL: ${imageUrl}`);
    
    // Verify image was saved to database
    const user = await prisma.users.findUnique({
      where: { wallet_address: TEST_WALLET },
      select: { profile_image_url: true, profile_image_updated_at: true }
    });
    
    if (user && user.profile_image_url === imageUrl) {
      console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Profile image saved to database successfully!`);
      console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Updated at: ${user.profile_image_updated_at}`);
    } else {
      console.log(`${fancyColors.RED}[TEST]${fancyColors.RESET} Profile image NOT saved to database!`);
      console.log(`${fancyColors.RED}[TEST]${fancyColors.RESET} Database image: ${user?.profile_image_url}`);
    }
    
    // Test direct image generation for non-profile use case
    console.log(`${fancyColors.CYAN}[TEST]${fancyColors.RESET} Testing general image generation...`);
    
    const generalImageResult = await AIApi.generateImage(
      "Create a stylized crypto trading dashboard visualization with charts, market data, and trading elements.",
      'general',
      {
        identifier: 'test',
        metadata: {
          test: true,
          purpose: 'dashboard'
        }
      }
    );
    
    console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} General image generated successfully!`);
    console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} Result:`, generalImageResult);
    
    console.log(`${fancyColors.GREEN}[TEST]${fancyColors.RESET} All tests completed successfully!`);
  } catch (error) {
    console.error(`${fancyColors.RED}[TEST ERROR]${fancyColors.RESET} ${error.message}`);
    console.error(error);
  } finally {
    // Close Prisma client
    await prisma.$disconnect();
  }
}

// Run the test
main();