/**
 * @file WebSocket server integration for realtime events
 * @description Connects realtime events to WebSocket broadcasts
 */

import realtime from '../index.js';
import { TOKEN_CHANNELS, CONTEST_CHANNELS, USER_CHANNELS, SYSTEM_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Map of channel subscriptions to WebSocket topics
 */
const CHANNEL_TO_TOPIC_MAP = {
  // Token channels
  [TOKEN_CHANNELS.PRICE]: 'token_updates',
  [TOKEN_CHANNELS.METADATA]: 'token_updates',
  [TOKEN_CHANNELS.RANK]: 'token_updates',
  [TOKEN_CHANNELS.VOLUME]: 'token_updates',
  [TOKEN_CHANNELS.LIQUIDITY]: 'token_updates',
  
  // Contest channels
  [CONTEST_CHANNELS.STATUS]: 'contest_updates',
  [CONTEST_CHANNELS.PARTICIPANT]: 'contest_updates',
  [CONTEST_CHANNELS.PORTFOLIO]: 'contest_updates',
  [CONTEST_CHANNELS.TRADE]: 'contest_updates',
  [CONTEST_CHANNELS.PRIZES]: 'contest_updates',
  
  // System channels
  [SYSTEM_CHANNELS.STATUS]: 'system_updates',
  [SYSTEM_CHANNELS.MAINTENANCE]: 'system_updates'
};

/**
 * Integrate realtime events with the WebSocket server
 * @param {Object} wsServer - UnifiedWebSocketServer instance
 */
export async function integrateWithWebSocketServer(wsServer) {
  // Set up handlers for all channels to topics
  for (const [channel, topic] of Object.entries(CHANNEL_TO_TOPIC_MAP)) {
    await realtime.subscribe(channel, (data) => {
      // Get event type from channel (e.g., token:price -> PRICE_UPDATE)
      const eventType = channel.split(':')[1].toUpperCase() + '_UPDATE';
      
      // Broadcast to all clients subscribed to this topic
      wsServer.broadcastToTopic(topic, {
        type: eventType,
        data
      });
      
      // For token-specific events, also broadcast to token-specific channels
      if (channel.startsWith('token:') && data.address) {
        wsServer.broadcastToTopic(`token:${data.address}`, {
          type: eventType,
          data
        });
      }
      
      // For contest-specific events, also broadcast to contest-specific channels
      if (channel.startsWith('contest:') && data.id) {
        wsServer.broadcastToTopic(`contest:${data.id}`, {
          type: eventType,
          data
        });
      }
    });
  }
  
  // Special handling for user-specific events
  await realtime.subscribe(USER_CHANNELS.BALANCE, (data) => {
    if (data.walletAddress) {
      wsServer.broadcastToUser(data.walletAddress, {
        type: 'BALANCE_UPDATE',
        data
      });
    }
  });
  
  // Handle user achievement notifications
  await realtime.subscribe(USER_CHANNELS.ACHIEVEMENT, (data) => {
    if (data.walletAddress) {
      wsServer.broadcastToUser(data.walletAddress, {
        type: 'ACHIEVEMENT_UNLOCKED',
        data
      });
    }
  });
  
  logApi.info('Realtime events integrated with WebSocket server');
  
  // Return cleanup function
  return async () => {
    // Unsubscribe from all channels
    for (const channel of Object.keys(CHANNEL_TO_TOPIC_MAP)) {
      await realtime.unsubscribe(channel);
    }
    
    await realtime.unsubscribe(USER_CHANNELS.BALANCE);
    await realtime.unsubscribe(USER_CHANNELS.ACHIEVEMENT);
    
    logApi.info('Realtime WebSocket integration cleaned up');
  };
}