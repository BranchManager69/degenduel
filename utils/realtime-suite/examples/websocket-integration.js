/**
 * @file Example WebSocket integration
 * @description Shows how to integrate realtime events with WebSockets
 */

import realtime from '../index.js';
import { TOKEN_CHANNELS, CONTEST_CHANNELS, USER_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Setup realtime event handlers for a WebSocket server
 * @param {Object} webSocketServer - UnifiedWebSocketServer instance
 */
export function setupRealtimeHandlers(webSocketServer) {
  // Subscribe to token price updates
  realtime.subscribe(TOKEN_CHANNELS.PRICE, (data) => {
    // Broadcast to clients subscribed to token updates
    webSocketServer.broadcastToTopic('token_updates', {
      type: 'PRICE_UPDATE',
      data
    });
    
    // Also broadcast to specific token channel if any clients are subscribed
    webSocketServer.broadcastToTopic(`token:${data.address}`, {
      type: 'PRICE_UPDATE',
      data
    });
  });
  
  // Subscribe to contest status changes
  realtime.subscribe(CONTEST_CHANNELS.STATUS, (data) => {
    // Broadcast to clients subscribed to contest updates
    webSocketServer.broadcastToTopic('contest_updates', {
      type: 'STATUS_UPDATE',
      data
    });
    
    // Also broadcast to specific contest channel
    webSocketServer.broadcastToTopic(`contest:${data.id}`, {
      type: 'STATUS_UPDATE',
      data
    });
  });
  
  // Subscribe to user balance updates
  realtime.subscribe(USER_CHANNELS.BALANCE, (data) => {
    // Only send to specific user
    webSocketServer.broadcastToUser(data.walletAddress, {
      type: 'BALANCE_UPDATE',
      data
    });
  });
  
  // Log successful setup
  logApi.info('Realtime handlers set up for WebSocket server');
}

/**
 * Clean up realtime subscriptions when shutting down
 */
export async function cleanupRealtimeHandlers() {
  // Unsubscribe from all channels to avoid memory leaks
  await Promise.all([
    realtime.unsubscribe(TOKEN_CHANNELS.PRICE),
    realtime.unsubscribe(CONTEST_CHANNELS.STATUS),
    realtime.unsubscribe(USER_CHANNELS.BALANCE)
  ]);
  
  // Shutdown realtime system
  await realtime.shutdown();
  
  logApi.info('Realtime handlers cleaned up');
}