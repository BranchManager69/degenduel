// tokenSyncService.js

import prisma from './config/prisma.js';
import axios from 'axios';
import { Decimal } from '@prisma/client/runtime/library';
import { logApi } from './utils/logger-suite/logger.js';

const PRICE_UPDATE_INTERVAL = 30000; // 30 seconds
const METADATA_UPDATE_INTERVAL = 600000; // 10 minutes
const DD_SERV_API = 'https://degenduel.me/api/dd-serv/tokens';
const DATA_API = 'https://data.degenduel.me/api';

let lastKnownTokens = new Map();
let priceUpdateInterval;
let metadataUpdateInterval;

async function fetchTokenPrices(addresses) {
  try {
    const response = await axios.post(`${DATA_API}/prices/bulk`, { addresses });
    return response.data.data;
  } catch (error) {
    logApi.error('Error fetching token prices:', error);
    throw error;
  }
}

async function fetchSimpleList() {
  try {
    const response = await axios.get(`${DD_SERV_API}/list?detail=simple`);
    return response.data;
  } catch (error) {
    logApi.error('Error fetching simple list:', error);
    throw error;
  }
}

async function fetchFullDetails() {
  try {
    const response = await axios.get(`${DD_SERV_API}/list?detail=full`);
    return response.data;
  } catch (error) {
    logApi.error('Error fetching full details:', error);
    throw error;
  }
}

function hasTokenListChanged(newTokens) {
  if (lastKnownTokens.size !== newTokens.length) return true;

  for (const token of newTokens) {
    const existing = lastKnownTokens.get(token.contractAddress);
    if (!existing || 
        existing.name !== token.name || 
        existing.symbol !== token.symbol) {
      return true;
    }
  }
  return false;
}

async function updatePrices() {
  try {
    // Get all active token addresses
    const activeTokens = await prisma.tokens.findMany({
      where: { is_active: true },
      select: { address: true, id: true }
    });

    if (activeTokens.length === 0) {
      logApi.info('No active tokens found for price update');
      return;
    }

    const addresses = activeTokens.map(token => token.address);
    const addressToId = Object.fromEntries(activeTokens.map(token => [token.address, token.id]));

    // Fetch current prices
    const priceData = await fetchTokenPrices(addresses);
    
    // Update prices in transaction
    await prisma.$transaction(async (tx) => {
      for (const token of priceData) {
        const tokenId = addressToId[token.address];
        if (!tokenId) continue;

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
      }
    });

    logApi.info(`Updated prices for ${priceData.length} tokens`);
  } catch (error) {
    logApi.error('Error updating token prices:', error);
  }
}

async function updateMetadata(fullData) {
  logApi.info(`Updating metadata for ${fullData.length} tokens...`);

  await prisma.$transaction(async (tx) => {
    for (const token of fullData) {
      const tokenData = {
        address: token.contractAddress,
        symbol: token.symbol,
        name: token.name,
        decimals: 9, // Default for Solana tokens
        is_active: true,
        market_cap: token.marketCap ? new Decimal(token.marketCap) : null,
        change_24h: token.change_h24 ? new Decimal(token.change_h24) : null,
        volume_24h: token.volume24h ? new Decimal(token.volume24h) : null,
        created_at: token.createdAt ? new Date(token.createdAt) : new Date()
      };

      const existingToken = await tx.tokens.findUnique({
        where: { address: token.contractAddress }
      });

      if (existingToken) {
        await tx.tokens.update({
          where: { id: existingToken.id },
          data: tokenData
        });
      } else {
        await tx.tokens.create({
          data: tokenData
        });
      }
    }
  });

  // Update our cache with the latest token list
  lastKnownTokens = new Map(
    fullData.map(token => [
      token.contractAddress,
      { name: token.name, symbol: token.symbol }
    ])
  );

  logApi.info('Token metadata update completed successfully');
}

async function startSync() {
  logApi.info('Starting token sync service...');

  try {
    // Initial full sync
    logApi.info('Performing initial full sync...');
    const fullData = await fetchFullDetails();
    await updateMetadata(fullData);
    await updatePrices();
    logApi.info('Initial sync completed');

    // Set up the 30-second price update interval
    priceUpdateInterval = setInterval(updatePrices, PRICE_UPDATE_INTERVAL);

    // Set up the 10-minute metadata update interval
    metadataUpdateInterval = setInterval(async () => {
      try {
        logApi.info('Performing scheduled metadata update...');
        const fullData = await fetchFullDetails();
        await updateMetadata(fullData);
      } catch (error) {
        logApi.error('Error in metadata sync interval:', error);
      }
    }, METADATA_UPDATE_INTERVAL);

  } catch (error) {
    logApi.error('Error starting sync service:', error);
    throw error;
  }
}

// Cleanup function for graceful shutdown
function stopSync() {
  if (priceUpdateInterval) clearInterval(priceUpdateInterval);
  if (metadataUpdateInterval) clearInterval(metadataUpdateInterval);
  logApi.info('Token sync service stopped');
}

export { startSync, stopSync }; 