// services/dialect/blinks-registry.js

/**
 * Blinks Registry Implementation for DegenDuel
 * 
 * This module implements a Dialect Blinks registry for DegenDuel's
 * Solana Actions (Blinks) functionality.
 * 
 * @version 1.0.7
 * @created 2025-05-11
 * @updated 2025-05-23
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import { PublicKey } from '@solana/web3.js';
import { v4 as uuidv4 } from 'uuid';
import { Dialect } from '@dialectlabs/sdk';

// Top-level dynamic import for @dialectlabs/web3
const dialectWeb3Promise = import('@dialectlabs/web3');

// Cache for registered blinks
const blinksCache = new Map();

// Wallet encryption key (will be loaded from config)
let encryptionKey;

/**
 * Initialize the Dialect SDK with our wallet credentials
 * and register as a Blinks Provider
 */
async function initializeDialect() {
  try {
    // Wait for the dynamic import to resolve
    const { makeDialectSolana, SolanaSigner } = await dialectWeb3Promise;

    // Get wallet keypair from config
    const walletPrivateKey = config.dialect?.walletPrivateKey || 
                             config.master_wallet?.branch_manager_wallet_key;
    
    if (!walletPrivateKey) {
      throw new Error('No wallet private key found for Dialect initialization');
    }
    
    // Decode the private key
    const secretKey = Buffer.from(walletPrivateKey, 'base64');
    
    // Create Solana signer from private key
    const signer = new SolanaSigner({
      secretKey,
    });
    
    // Initialize Dialect SDK with Solana adapter
    const dialectSolanaNetwork = config.network === 'mainnet' ? 'mainnet-beta' : 'devnet';
    
    const dialectSolana = makeDialectSolana({
      env: dialectSolanaNetwork,
      wallet: {
        address: signer.address,
        signMessage: signer.signMessage,
        signTransaction: signer.signTransaction,
      },
    });
    
    // Create Dialect SDK instance
    const dialectSdk = Dialect.sdk({
      enabled: true,
      environment: config.environment === 'production' ? 'production' : 'development',
      dialectCloud: {
        tokenStore: {
          getToken: async () => config.dialect?.apiKey || '',
        },
      },
      solana: dialectSolana,
    });
    
    // Create blinks provider
    const dialectBlinksProvider = await dialectSdk.blinks.providers.create({
      name: 'DegenDuel',
      description: 'DegenDuel Contest & Trading Platform',
      websiteUrl: 'https://degenduel.me',
      iconUrl: 'https://degenduel.me/images/logo192.png',
      termsUrl: 'https://degenduel.me/terms',
      oauthRedirectUrl: 'https://degenduel.me/api/blinks/auth/callback',
      blinksInstructionsUrl: 'https://degenduel.me/docs/blinks',
    });
    
    logApi.info('Dialect Blinks provider initialized successfully', {
      providerId: dialectBlinksProvider.id,
      providerName: dialectBlinksProvider.name,
    });
    
    return dialectSdk;
  } catch (error) {
    logApi.error('Failed to initialize Dialect SDK', { error });
    throw error;
  }
}

/**
 * Register a blink action with Dialect
 * 
 * @param {Object} blinkData - The blink data to register
 * @param {string} blinkData.name - Name of the blink
 * @param {string} blinkData.description - Description of the blink
 * @param {string} blinkData.actionUrl - URL to execute the blink
 * @param {string} blinkData.icon - URL to the blink's icon
 * @param {Object} blinkData.parameters - Parameters the blink accepts
 * @returns {Promise<Object>} - The registered blink
 */
async function registerBlink(dialectSdk, blinkData) {
  try {
    const {
      name,
      description,
      actionUrl,
      icon = 'https://degenduel.me/images/logo192.png',
      parameters = {},
    } = blinkData;
    
    // Validate required fields
    if (!name || !description || !actionUrl) {
      throw new Error('Missing required fields for blink registration');
    }
    
    // Generate a unique ID for this blink
    const blinkId = blinkData.id || uuidv4();
    
    // Register the blink with Dialect
    const blink = await dialectSdk.blinks.register({
      id: blinkId,
      name,
      description,
      actionUrl,
      iconUrl: icon,
      parameters,
    });
    
    // Cache the registered blink
    blinksCache.set(blinkId, blink);
    
    logApi.info('Registered blink with Dialect', {
      blinkId: blink.id,
      blinkName: blink.name,
    });
    
    return blink;
  } catch (error) {
    logApi.error('Failed to register blink with Dialect', {
      error,
      blinkData,
    });
    throw error;
  }
}

/**
 * Get a registered blink by ID
 * 
 * @param {string} blinkId - The ID of the blink to get
 * @returns {Promise<Object>} - The registered blink
 */
async function getBlink(dialectSdk, blinkId) {
  try {
    // Check cache first
    if (blinksCache.has(blinkId)) {
      return blinksCache.get(blinkId);
    }
    
    // Fetch from Dialect
    const blink = await dialectSdk.blinks.find(blinkId);
    
    // Cache the result
    if (blink) {
      blinksCache.set(blinkId, blink);
    }
    
    return blink;
  } catch (error) {
    logApi.error('Failed to get blink from Dialect', {
      error,
      blinkId,
    });
    throw error;
  }
}

/**
 * Get all registered blinks for this provider
 * 
 * @returns {Promise<Array>} - Array of registered blinks
 */
async function getAllBlinks(dialectSdk) {
  try {
    const blinks = await dialectSdk.blinks.findAll();
    
    // Update cache
    blinks.forEach(blink => {
      blinksCache.set(blink.id, blink);
    });
    
    return blinks;
  } catch (error) {
    logApi.error('Failed to get all blinks from Dialect', { error });
    throw error;
  }
}

/**
 * Update a registered blink
 * 
 * @param {string} blinkId - The ID of the blink to update
 * @param {Object} updateData - The data to update
 * @returns {Promise<Object>} - The updated blink
 */
async function updateBlink(dialectSdk, blinkId, updateData) {
  try {
    // Validate blink exists
    const existingBlink = await getBlink(dialectSdk, blinkId);
    
    if (!existingBlink) {
      throw new Error(`Blink with ID ${blinkId} not found`);
    }
    
    // Update the blink
    const updatedBlink = await dialectSdk.blinks.update({
      id: blinkId,
      ...updateData,
    });
    
    // Update cache
    blinksCache.set(blinkId, updatedBlink);
    
    logApi.info('Updated blink in Dialect', {
      blinkId,
      updateData,
    });
    
    return updatedBlink;
  } catch (error) {
    logApi.error('Failed to update blink in Dialect', {
      error,
      blinkId,
      updateData,
    });
    throw error;
  }
}

/**
 * Delete a registered blink
 * 
 * @param {string} blinkId - The ID of the blink to delete
 * @returns {Promise<boolean>} - Whether the deletion was successful
 */
async function deleteBlink(dialectSdk, blinkId) {
  try {
    // Validate blink exists
    const existingBlink = await getBlink(dialectSdk, blinkId);
    
    if (!existingBlink) {
      throw new Error(`Blink with ID ${blinkId} not found`);
    }
    
    // Delete the blink
    await dialectSdk.blinks.delete(blinkId);
    
    // Remove from cache
    blinksCache.delete(blinkId);
    
    logApi.info('Deleted blink from Dialect', { blinkId });
    
    return true;
  } catch (error) {
    logApi.error('Failed to delete blink from Dialect', {
      error,
      blinkId,
    });
    throw error;
  }
}

/**
 * Register all default blinks used by DegenDuel
 *
 * @returns {Promise<Array>} - Array of registered blinks
 */
async function registerDefaultBlinks(dialectSdk) {
  try {
    // Define our default blinks
    const defaultBlinks = [
      {
        id: 'join-contest',
        name: 'Join Contest',
        description: 'Join a contest on DegenDuel with an AI-selected portfolio',
        actionUrl: 'https://degenduel.me/api/blinks/join-contest',
        parameters: {
          contest_id: {
            type: 'string',
            description: 'Contest ID to join',
            required: true,
          },
          referrer: {
            type: 'string',
            description: 'Wallet address of the referrer',
            required: false,
          },
        },
      },
      /*
      // NOTE: These Blinks are commented out because they don't involve transactions
      // and/or aren't properly implemented yet.
      // Blinks should only be used for actions requiring a transaction signature.

      {
        id: 'view-contest',
        name: 'View Contest',
        description: 'View a live contest on DegenDuel',
        actionUrl: 'https://degenduel.me/api/blinks/view-contest',
        parameters: {
          contest_id: {
            type: 'string',
            description: 'Contest ID to view',
            required: true,
          },
        },
      },
      {
        id: 'view-results',
        name: 'View Results',
        description: 'View contest results on DegenDuel',
        actionUrl: 'https://degenduel.me/api/blinks/view-results',
        parameters: {
          contest_id: {
            type: 'string',
            description: 'Contest ID to view results for',
            required: true,
          },
        },
      },
      {
        id: 'place-token-bet',
        name: 'Place Token Bet',
        description: 'Place a bet on a token on DegenDuel',
        actionUrl: 'https://degenduel.me/api/blinks/place-token-bet',
        parameters: {
          token_address: {
            type: 'string',
            description: 'Token address to bet on',
            required: true,
          },
          amount: {
            type: 'number',
            description: 'Bet amount in SOL',
            required: true,
          },
        },
      },
      */
    ];
    
    // Register each blink
    const registeredBlinks = await Promise.all(
      defaultBlinks.map(blinkData => registerBlink(dialectSdk, blinkData))
    );
    
    logApi.info('Registered default blinks with Dialect', {
      count: registeredBlinks.length,
      blinks: registeredBlinks.map(b => b.id),
    });
    
    return registeredBlinks;
  } catch (error) {
    logApi.error('Failed to register default blinks with Dialect', { error });
    throw error;
  }
}

export default {
  initializeDialect,
  registerBlink,
  getBlink,
  getAllBlinks,
  updateBlink,
  deleteBlink,
  registerDefaultBlinks,
};