/**
 * @file Example subscription patterns
 * @description Various patterns for subscribing to realtime events
 */

import realtime from '../index.js';
import { TOKEN_CHANNELS, SYSTEM_CHANNELS, SERVICE_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Example: Cross-service notification system
 * Shows how services can communicate with each other
 */
export async function setupServiceCommunication() {
  // Token enrichment service listens for service messages
  await realtime.subscribe(SERVICE_CHANNELS.TOKEN_ENRICHMENT, (data) => {
    if (data.action === 'refresh_token') {
      logApi.info(`Token enrichment service received refresh request for token ${data.tokenAddress}`);
      // Logic to refresh token would go here
    }
  });
  
  // Token sync service listens for new token discoveries
  await realtime.subscribe(TOKEN_CHANNELS.DISCOVERY, (data) => {
    logApi.info(`Token sync service received new token discovery: ${data.address}`);
    // Logic to process new token would go here
  });
  
  // All services listen for system maintenance events
  await realtime.subscribe(SYSTEM_CHANNELS.MAINTENANCE, (data) => {
    if (data.status === 'starting') {
      logApi.warn(`System maintenance starting in ${data.timeUntilStart} seconds`);
      // Graceful shutdown preparation would go here
    } else if (data.status === 'completed') {
      logApi.info('System maintenance completed');
      // Resume normal operations
    }
  });
}

/**
 * Example: Request token price refresh for specific token
 * Shows how one service can request action from another
 */
export async function requestTokenRefresh(tokenId, tokenAddress, priority = 'normal') {
  await realtime.publish(SERVICE_CHANNELS.TOKEN_ENRICHMENT, {
    action: 'refresh_token',
    tokenId,
    tokenAddress,
    priority,
    requestedBy: 'admin-dashboard',
    timestamp: Date.now()
  });
  
  logApi.info(`Requested token refresh for ${tokenAddress} with priority ${priority}`);
}

/**
 * Example: Custom event filtering
 * Shows how to filter events before processing them
 */
export async function setupFilteredSubscription() {
  // Only process high-impact price changes (>5%)
  await realtime.subscribe(TOKEN_CHANNELS.PRICE, (data) => {
    // Skip small changes
    if (Math.abs(data.changePercent) < 5) {
      return;
    }
    
    logApi.info(`High impact price change detected: ${data.address} changed by ${data.changePercent}%`);
    // Processing for significant price changes would go here
  });
  
  // Only process events for tokens in the top 100
  await realtime.subscribe(TOKEN_CHANNELS.RANK, (data) => {
    // Skip tokens outside top 100
    if (data.rank > 100) {
      return;
    }
    
    logApi.info(`Top 100 token rank change: ${data.address} is now rank ${data.rank}`);
    // Processing for top token rank changes would go here
  });
}