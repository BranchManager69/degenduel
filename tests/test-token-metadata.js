// Test script to verify token metadata refresh functionality
import { PrismaClient } from '@prisma/client';
import tokenDEXDataService from '../services/token-dex-data-service.js';
import { logApi } from '../utils/logger-suite/logger.js';
import '../utils/colors.js';  // Import colors for formatting
import { config } from '../config/config.js';
import { dexscreenerClient } from '../services/solana-engine/dexscreener-client.js';

// Set the active profile to 'production' to ensure services are enabled
config.services.active_profile = 'production';

// Initialize the Prisma client
const prisma = new PrismaClient();

// Test token address - PumpFun token
const TEST_TOKEN_ADDRESS = '8x8YipfqZctyTadL2sETH8YbMtinZAXZi6CYFebfpump';

// Format console output
function printSeparator(title) {
  console.log('\n' + '='.repeat(80));
  console.log(`${title}`);
  console.log('='.repeat(80) + '\n');
}

async function showTokenData(tokenAddress) {
  printSeparator(`CURRENT TOKEN DATA FOR ${tokenAddress}`);
  
  try {
    // Get token data from the database
    const token = await prisma.tokens.findUnique({
      where: { address: tokenAddress },
      include: {
        token_socials: true,
        token_websites: true,
      }
    });
    
    if (!token) {
      console.log(`Token ${tokenAddress} not found in database.`);
      return null;
    }
    
    // Display token information
    console.log(`Token ID: ${token.id}`);
    console.log(`Name: ${token.name || 'Not set'}`);
    console.log(`Symbol: ${token.symbol || 'Not set'}`);
    console.log(`Website URL: ${token.website_url || 'Not set'}`);
    console.log(`Twitter URL: ${token.twitter_url || 'Not set'}`);
    console.log(`Telegram URL: ${token.telegram_url || 'Not set'}`);
    console.log(`Discord URL: ${token.discord_url || 'Not set'}`);
    console.log(`Image URL: ${token.image_url || 'Not set'}`);
    
    // Display token socials
    console.log('\nSocial Links:');
    if (token.token_socials && token.token_socials.length > 0) {
      token.token_socials.forEach(social => {
        console.log(`- ${social.type}: ${social.url}`);
      });
    } else {
      console.log('No social links stored in token_socials table.');
    }
    
    // Display token websites
    console.log('\nWebsites:');
    if (token.token_websites && token.token_websites.length > 0) {
      token.token_websites.forEach(website => {
        console.log(`- ${website.label || 'Website'}: ${website.url}`);
      });
    } else {
      console.log('No websites stored in token_websites table.');
    }
    
    return token;
  } catch (error) {
    console.error('Error fetching token data:', error);
    return null;
  }
}

async function fetchRawTokenData(tokenAddress) {
  printSeparator(`FETCHING RAW DEXSCREENER DATA FOR ${tokenAddress}`);
  
  try {
    // Initialize the DexScreener client
    console.log('Initializing DexScreener client...');
    await dexscreenerClient.initialize();
    console.log('DexScreener client initialized successfully\n');
    
    // Fetch the raw token data
    console.log(`Fetching raw data for token ${tokenAddress}...`);
    const rawData = await dexscreenerClient.getTokenPools('solana', tokenAddress);
    
    // Display the raw data
    console.log('\nRAW DEXSCREENER DATA:');
    console.log(JSON.stringify(rawData, null, 2));
    
    return rawData;
  } catch (error) {
    console.error('Error fetching raw token data:', error);
    return null;
  }
}

async function refreshTokenMetadata(tokenAddress) {
  printSeparator(`REFRESHING TOKEN METADATA FOR ${tokenAddress}`);
  
  try {
    // Initialize the token DEX data service
    console.log('Initializing token DEX data service...');
    await tokenDEXDataService.initialize();
    console.log('Service initialized successfully\n');
    
    // Fetch the raw data first to see what we're working with
    await fetchRawTokenData(tokenAddress);
    
    // Refresh pools for the token
    console.log(`\nRefreshing pools and metadata for token ${tokenAddress}...`);
    const result = await tokenDEXDataService.refreshPoolsForToken(tokenAddress);
    
    // Display refresh result
    console.log('\nREFRESH RESULT:');
    console.log(JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Error refreshing token metadata:', error);
    return { success: false, error: error.message };
  }
}

// Main test function
async function runTest() {
  try {
    printSeparator('TOKEN METADATA REFRESH TEST');
    
    // Show current token data
    const tokenBefore = await showTokenData(TEST_TOKEN_ADDRESS);
    
    // If the token doesn't exist, create a basic record
    if (!tokenBefore) {
      console.log('Token not found in database, creating a basic record...');
      await prisma.tokens.create({
        data: {
          address: TEST_TOKEN_ADDRESS,
          symbol: 'PUMPFUN',
          name: 'PumpFun',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      });
      console.log('Basic token record created');
    }
    
    // Refresh token metadata
    const refreshResult = await refreshTokenMetadata(TEST_TOKEN_ADDRESS);
    
    // Show updated token data
    await showTokenData(TEST_TOKEN_ADDRESS);
    
    printSeparator('TEST COMPLETED');
    
    process.exit(0);
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

// Run the test
runTest();