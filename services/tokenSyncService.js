// services/tokenSync.js

/*
 * This service is responsible for fetching and updating token prices and metadata.
 * It stays up to date by constantly fetching from the DegenDuel Market Data API.
 * 
 */

import prisma from '../config/prisma.js';
import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';
import { TOKEN_VALIDATION } from '../config/constants.js';

// Service state
let initialSyncComplete = false;
let priceUpdateInterval = null;
let metadataUpdateInterval = null;
let lastKnownTokens = new Map();

// Validation utilities
function validateUrl(url) {
  if (!url) return null;
  
  // If url is an object, try to get the URL string from it
  if (typeof url === 'object') {
    if (url.href) {
      url = url.href;
    } else if (url.url) {
      url = url.url;
    } else {
      logApi.warn(`Invalid URL object format:`, url);
      return null;
    }
  }

  if (typeof url !== 'string') {
    logApi.warn(`Invalid URL type: ${typeof url}`);
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    if (!TOKEN_VALIDATION.URLS.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      logApi.warn(`Invalid protocol for URL: ${url}`);
      return null;
    }
    if (url.length > TOKEN_VALIDATION.URLS.MAX_LENGTH) {
      logApi.warn(`URL too long: ${url}`);
      return null;
    }
    return url;
  } catch (error) {
    logApi.warn(`Invalid URL: ${url}`, { error: error.message });
    return null;
  }
}

function validateDescription(desc) {
  if (!desc) return null;
  const trimmed = desc.trim();
  return trimmed.length > TOKEN_VALIDATION.DESCRIPTION.MAX_LENGTH 
    ? trimmed.substring(0, TOKEN_VALIDATION.DESCRIPTION.MAX_LENGTH - 3) + '...' 
    : trimmed;
}

function validateSymbol(symbol) {
  if (!symbol) return null;
  
  // Clean up the symbol
  let cleanSymbol = symbol.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_.]/g, ''); // Allow hyphens, dots, and underscores
  
  // If the symbol is now empty after cleaning, log a warning
  if (!cleanSymbol) {
    logApi.warn(`Symbol became empty after cleaning: ${symbol}`);
    return symbol.substring(0, TOKEN_VALIDATION.SYMBOL.MAX_LENGTH);
  }
  
  // If it doesn't match the strict pattern, log a warning but don't fail
  if (!TOKEN_VALIDATION.SYMBOL.PATTERN.test(cleanSymbol)) {
    logApi.warn(`Non-standard symbol format (accepted): ${symbol} -> ${cleanSymbol}`);
  }
  
  return cleanSymbol.substring(0, TOKEN_VALIDATION.SYMBOL.MAX_LENGTH);
}

function validateName(name) {
  const trimmed = name.trim();
  return trimmed.length > TOKEN_VALIDATION.NAME.MAX_LENGTH 
    ? trimmed.substring(0, TOKEN_VALIDATION.NAME.MAX_LENGTH) 
    : trimmed;
}

function validateAddress(address) {
  if (!TOKEN_VALIDATION.ADDRESS.SOLANA_PATTERN.test(address)) {
    logApi.warn(`Invalid Solana address format: ${address}`);
  }
  return address;
}

// Refresh rates for various phases of the Token and Market Data Sync Service:
const PRICE_UPDATE_INTERVAL = 0.5 * 60 * 1000; // every 30 seconds
const METADATA_UPDATE_INTERVAL = 5 * 60 * 1000; // every 5 minutes

// helpful DegenDuel API endpoints:
const DD_SERV_API = config.api_urls.dd_serv;
const DATA_API = config.api_urls.data;

// Sync retries and delays
const MAX_RETRIES = 3;
const RETRY_DELAY = 0.25 * 60 * 1000; // 15 seconds between sync retries
const INITIAL_SYNC_TIMEOUT = 0.5 * 60 * 1000; // 30 seconds timeout for initial sync operations
const AXIOS_TIMEOUT = 0.5 * 60 * 1000; // 30 seconds timeout for axios requests

// Metadata sync statistics
let syncStats = {
  totalProcessed: 0,
  validationFailures: {
    urls: 0,
    descriptions: 0,
    symbols: 0,
    names: 0,
    addresses: 0
  },
  metadataCompleteness: {
    hasImage: 0,
    hasDescription: 0,
    hasTwitter: 0,
    hasTelegram: 0,
    hasDiscord: 0,
    hasWebsite: 0
  },
  performance: {
    lastSyncDuration: 0,
    averageSyncDuration: 0,
    syncCount: 0
  },
  history: {
    lastSync: null,
    lastSuccessfulSync: null,
    failedSyncs: 0,
    consecutiveFailures: 0
  },
  updates: {
    created: 0,
    updated: 0,
    failed: 0,
    unchanged: 0,
    totalSince: {
      created: 0,
      updated: 0,
      failed: 0
    }
  },
  successRate: 0
};

// Helper function for delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(fetchFn, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      logApi.warn(`API call failed (attempt ${attempt}/${retries}):`, {
        error: error.message,
        status: error.response?.status,
        endpoint: error.config?.url
      });
      
      if (attempt === retries) {
        throw error;
      }
      
      await delay(RETRY_DELAY);
      logApi.info(`Retrying API call (attempt ${attempt + 1}/${retries})...`);
    }
  }
}

async function fetchTokenPrices(addresses) {
  logApi.info(`Fetching prices for ${addresses.length} tokens...`);
  return fetchWithRetry(async () => {
    const response = await axios.post(`${DATA_API}/prices/bulk`, { 
      addresses 
    }, { 
      timeout: AXIOS_TIMEOUT 
    });
    logApi.info(`Received price data for ${response.data.data.length} tokens`);
    return response.data.data;
  });
}

async function fetchSimpleList() {
  logApi.info('Fetching simple token list...');
  return fetchWithRetry(async () => {
    const response = await axios.get(`${DD_SERV_API}/list?detail=simple`, {
      timeout: AXIOS_TIMEOUT
    });
    logApi.info(`Received simple list with ${response.data.length} tokens`);
    return response.data;
  });
}

async function fetchFullDetails() {
  logApi.info('Fetching full token details...');
  return fetchWithRetry(async () => {
    const response = await axios.get(`${DD_SERV_API}/list?detail=full`, {
      timeout: AXIOS_TIMEOUT
    });
    logApi.info(`Received full details for ${response.data.length} tokens`);
    return response.data;
  });
}

function hasTokenListChanged(newTokens) {
  if (lastKnownTokens.size !== newTokens.length) {
    logApi.info(`Token list size changed: ${lastKnownTokens.size} -> ${newTokens.length}`);
    return true;
  }

  for (const token of newTokens) {
    const existing = lastKnownTokens.get(token.contractAddress);
    if (!existing || 
        existing.name !== token.name || 
        existing.symbol !== token.symbol ||
        existing.imageUrl !== token.imageUrl ||
        existing.description !== token.description) {
      logApi.info(`Token changed: ${token.contractAddress}`, {
        old: existing,
        new: {
          name: token.name,
          symbol: token.symbol,
          hasImage: !!token.imageUrl,
          hasDescription: !!token.description
        }
      });
      return true;
    }
  }
  return false;
}

async function updatePrices() {
  const startTime = Date.now();
  logApi.info('Starting price update cycle...');
  
  try {
    // Get all active token addresses
    const activeTokens = await prisma.tokens.findMany({
      where: { is_active: true },
      select: { address: true, id: true }
    });

    logApi.info(`Found ${activeTokens.length} active tokens in database`);

    if (activeTokens.length === 0) {
      logApi.info('No active tokens found for price update');
      return;
    }

    const addresses = activeTokens.map(token => token.address);
    const addressToId = Object.fromEntries(activeTokens.map(token => [token.address, token.id]));

    // Fetch current prices
    const priceData = await fetchTokenPrices(addresses);
    
    // Update prices in transaction
    let updatedCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const token of priceData) {
        const tokenId = addressToId[token.address];
        if (!tokenId) {
          logApi.warn(`No matching token ID found for address: ${token.address}`);
          continue;
        }

        await tx.token_prices.upsert({
          where: { token_id: tokenId },
          create: {
            token_id: tokenId,
            price: new Decimal(token.price),
            updated_at: new Date(token.timestamp)
          },
          update: {
            price: new Decimal(token.price),
            updated_at: new Date(token.timestamp)
          }
        });
        updatedCount++;
      }
    });

    const duration = Date.now() - startTime;
    logApi.info(`Price update cycle completed`, {
      totalTokens: activeTokens.length,
      pricesReceived: priceData.length,
      pricesUpdated: updatedCount,
      duration: `${duration}ms`
    });
  } catch (error) {
    logApi.error('Error updating token prices:', {
      error: error.message,
      stack: error.stack
    });
  }
}

async function updateMetadata(fullData) {
  logApi.info(`Starting metadata update for ${fullData.length} tokens...`);

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let validationFailures = 0;

  await prisma.$transaction(async (tx) => {
    for (const token of fullData) {
      try {
        // Skip tokens with missing required fields
        if (!token?.contractAddress || !token?.symbol || !token?.name) {
          logApi.warn('Skipping token with missing required fields:', {
            address: token?.contractAddress,
            symbol: token?.symbol,
            name: token?.name
          });
          validationFailures++;
          continue;
        }

        // Validate all fields
        const validatedData = {
          address: validateAddress(token.contractAddress),
          symbol: validateSymbol(token.symbol),
          name: validateName(token.name),
          decimals: 9, // Default for Solana tokens
          is_active: true,
          market_cap: token.marketCap ? new Decimal(token.marketCap) : null,
          change_24h: token.change_h24 ? new Decimal(token.change_h24) : null,
          volume_24h: token.volume24h ? new Decimal(token.volume24h) : null,
          image_url: validateUrl(token.imageUrl),
          description: validateDescription(token.description),
          twitter_url: validateUrl(token.socials?.twitter),
          telegram_url: validateUrl(token.socials?.telegram),
          discord_url: validateUrl(token.socials?.discord),
          website_url: validateUrl(token.websites?.[0])
        };

        const existingToken = await tx.tokens.findUnique({
          where: { address: token.contractAddress }
        });

        if (existingToken) {
          await tx.tokens.update({
            where: { id: existingToken.id },
            data: validatedData
          });
          updated++;
        } else {
          await tx.tokens.create({
            data: validatedData
          });
          created++;
        }
      } catch (error) {
        validationFailures++;
        logApi.error('Failed to process token:', {
          token: token?.contractAddress,
          error: error.message
        });
      }
    }
  });

  // Update our cache with the latest token list
  lastKnownTokens = new Map(
    fullData.filter(token => token?.contractAddress && token?.name && token?.symbol)
      .map(token => [
        token.contractAddress,
        { name: token.name, symbol: token.symbol }
      ])
  );

  logApi.info('Metadata update completed', {
    totalTokens: fullData.length,
    created,
    updated,
    unchanged,
    validationFailures,
    successRate: ((fullData.length - validationFailures) / fullData.length * 100).toFixed(2) + '%'
  });
}

function startPriceSync() {
    if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
    }
    
    priceUpdateInterval = setInterval(async () => {
        try {
            await updatePrices();
            logApi.debug('Price sync completed successfully');
        } catch (error) {
            logApi.error('Error in price update interval:', error);
        }
    }, 30000); // 30 seconds
}

function startMetadataSync() {
    if (metadataUpdateInterval) {
        clearInterval(metadataUpdateInterval);
    }
    
    metadataUpdateInterval = setInterval(async () => {
        try {
            const fullData = await fetchFullDetails();
            await updateMetadata(fullData);
            logApi.debug('Metadata sync completed successfully');
        } catch (error) {
            logApi.error('Error in metadata sync interval:', error);
        }
    }, 300000); // 5 minutes
}

export async function startSync() {
    try {
        logApi.info('Starting Token Sync Service...');
        
        // Initialize service state
        const now = new Date();
        const serviceState = {
            enabled: true,
            running: true,
            last_started: now.toISOString(),
            status: 'starting',
            stats: {
                totalProcessed: 0,
                validationFailures: {
                    urls: 0,
                    descriptions: 0,
                    symbols: 0,
                    names: 0,
                    addresses: 0
                },
                metadataCompleteness: {
                    hasImage: 0,
                    hasDescription: 0,
                    hasTwitter: 0,
                    hasTelegram: 0,
                    hasDiscord: 0,
                    hasWebsite: 0
                },
                performance: {
                    lastSyncDuration: 0,
                    averageSyncDuration: 0,
                    syncCount: 0
                },
                history: {
                    lastSync: null,
                    lastSuccessfulSync: null,
                    failedSyncs: 0,
                    consecutiveFailures: 0
                },
                updates: {
                    created: 0,
                    updated: 0,
                    failed: 0,
                    unchanged: 0,
                    totalSince: {
                        created: 0,
                        updated: 0,
                        failed: 0
                    }
                },
                successRate: 0
            },
            config: {
                price_update_interval_ms: 30000,
                metadata_update_interval_ms: 300000,
                max_retries: 3,
                retry_delay_ms: 15000,
                initial_sync_timeout_ms: 30000,
                axios_timeout_ms: 30000
            }
        };

        // Update service settings with proper error handling
        try {
            await prisma.system_settings.upsert({
                where: {
                    key: 'token_sync_service'
                },
                update: {
                    value: serviceState,
                    updated_at: now,
                    updated_by: 'system'
                },
                create: {
                    key: 'token_sync_service',
                    value: serviceState,
                    updated_at: now,
                    updated_by: 'system',
                    description: 'Token synchronization service configuration and state'
                }
            });
            logApi.info('Token Sync Service state initialized successfully');
        } catch (dbError) {
            logApi.error('Failed to update token sync service state:', dbError);
            throw new Error('Database operation failed: ' + dbError.message);
        }

        // Start the sync intervals
        startPriceSync();
        startMetadataSync();
        
        logApi.info('Token Sync Service started successfully');
        
        return true;
    } catch (error) {
        logApi.error('Failed to start Token Sync Service:', error);
        throw error;
    }
}

function stopSync() {
  try {
    if (priceUpdateInterval) {
      clearInterval(priceUpdateInterval);
      priceUpdateInterval = null;
    }
    if (metadataUpdateInterval) {
      clearInterval(metadataUpdateInterval);
      metadataUpdateInterval = null;
    }

    // Update system settings to show service is stopped
    prisma.system_settings.update({
      where: { key: 'token_sync_service' },
      data: {
        value: {
          running: false,
          last_stopped: new Date().toISOString(),
          status: 'stopped',
          stats: syncStats,
          config: {
            price_update_interval_ms: PRICE_UPDATE_INTERVAL,
            metadata_update_interval_ms: METADATA_UPDATE_INTERVAL,
            max_retries: MAX_RETRIES,
            retry_delay_ms: RETRY_DELAY,
            initial_sync_timeout_ms: INITIAL_SYNC_TIMEOUT,
            axios_timeout_ms: AXIOS_TIMEOUT
          }
        },
        updated_at: new Date()
      }
    }).catch(error => {
      logApi.error('Failed to update system settings on service stop:', error);
    });

    logApi.info('Token Sync Service stopped');
  } catch (error) {
    logApi.error('Error stopping Token Sync Service:', error);
    throw error;
  }
}

// Export both the service functions and the stats
export { startSync, stopSync, syncStats }; 