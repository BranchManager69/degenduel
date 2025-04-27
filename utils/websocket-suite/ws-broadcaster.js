// utils/websocket-suite/ws-broadcaster.js

/**
 * WebSocket Broadcaster Utility
 * 
 * Provides a clean interface for services to broadcast messages to
 * specific user groups through the unified WebSocket system.
 */

import { logApi } from '../logger-suite/logger.js';
import config from '../../config/config.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../colors.js';

/**
 * WebSocket Broadcaster Utility
 * Provides a clean interface for any service to broadcast messages to
 * specific user groups through the unified WebSocket system
 */
class WSBroadcaster {
  constructor() {
    // Use logApi directly with proper formatting instead of creating a logger instance
  }

  /**
   * Broadcast a message to all users with a specific role
   * 
   * @param {string} role - The role to broadcast to (e.g., 'ADMIN', 'SUPER_ADMIN')
   * @param {string} category - Message category (e.g., 'ai_analysis', 'system_alert')
   * @param {string} action - Specific action (e.g., 'new_error_analysis', 'service_down')
   * @param {Object} data - The data payload to send
   * @param {Object} options - Additional options like priority
   * @returns {Promise<number>} - Number of clients the message was sent to
   */
  async broadcastToRole(role, category, action, data, options = {}) {
    const unifiedWS = config.websocket.unifiedWebSocket;
    
    if (!unifiedWS) {
      const errorMsg = `Failed to broadcast - Unified WebSocket not initialized`;
      logApi.warn(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} ${errorMsg}`);
      // Add diagnostic info to help troubleshoot
      logApi.debug(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} WebSocket config debug info: ${JSON.stringify({
        configHasWebSocketSection: !!config.websocket,
        configHasTopics: !!config.websocket?.topics,
        serviceCategory: category,
        serviceAction: action,
        targetRole: role
      })}`);
      // Throw error so callers know broadcast failed
      throw new Error(`WebSocket broadcast failed: ${errorMsg}`);
    }
    
    // Default priority is 'normal'
    const priority = options.priority || 'normal';
    
    // Create the message
    const message = {
      type: 'DATA',
      topic: 'admin', // Using admin topic for role-based messages
      subtype: category,
      action: action,
      data: data,
      priority: priority,
      timestamp: new Date().toISOString()
    };
    
    // Get count of messages sent
    let sentCount = 0;
    
    try {
      // Use the WebSocket server's built-in authentication data to find clients with the right role
      if (typeof unifiedWS.broadcastToRole === 'function') {
        // If the WS server already has a role-based broadcasting function, use it
        sentCount = await unifiedWS.broadcastToRole(role, message);
      } else {
        // Otherwise, manually filter and broadcast to clients with the specified role
        for (const [client, authData] of unifiedWS.authenticatedClients.entries()) {
          if (authData.role === role) {
            unifiedWS.send(client, message);
            sentCount++;
          }
        }
      }
      
      // Log the broadcast
      logApi.info(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Sent ${category}/${action} to ${sentCount} ${role} clients`, {
        role,
        category,
        action,
        sentCount,
        priority
      });
      
      // For high priority messages, also store in DB for clients that might be offline
      if (priority === 'high' || options.persist === true) {
        await this.storeMessage(role, category, action, data, options);
      }
      
      return sentCount;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Error broadcasting to ${role}:`, error);
      return 0;
    }
  }
  
  /**
   * Broadcast to a specific topic (for public broadcasts)
   * 
   * @param {string} topic - The WebSocket topic
   * @param {string} category - Message category
   * @param {string} action - Specific action
   * @param {Object} data - The data payload to send
   * @param {Object} options - Additional options
   * @returns {Promise<number>} - Number of clients the message was sent to
   */
  async broadcastToTopic(topic, category, action, data, options = {}) {
    const unifiedWS = config.websocket.unifiedWebSocket;
    
    if (!unifiedWS) {
      const errorMsg = `Failed to broadcast - Unified WebSocket not initialized`;
      logApi.warn(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} ${errorMsg}`);
      // Add diagnostic info
      logApi.debug(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} WebSocket config debug info: ${JSON.stringify({
        configHasWebSocketSection: !!config.websocket,
        configHasTopics: !!config.websocket?.topics,
        topic: topic,
        serviceCategory: category,
        serviceAction: action
      })}`);
      // Throw error so callers know broadcast failed
      throw new Error(`WebSocket broadcast failed: ${errorMsg}`);
    }
    
    // Create the message
    const message = {
      type: 'DATA',
      topic: topic,
      subtype: category,
      action: action,
      data: data,
      priority: options.priority || 'normal',
      timestamp: new Date().toISOString()
    };
    
    try {
      // Use the WebSocket server's broadcastToTopic method
      let sentCount = 0;
      
      if (typeof unifiedWS.broadcastToTopic === 'function') {
        sentCount = await unifiedWS.broadcastToTopic(topic, message);
      } else {
        // Fallback if the method doesn't exist
        const subscribers = unifiedWS.topicSubscribers.get(topic) || new Set();
        for (const client of subscribers) {
          unifiedWS.send(client, message);
          sentCount++;
        }
      }
      
      // Log the broadcast
      logApi.info(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Sent ${category}/${action} to ${sentCount} clients on topic ${topic}`, {
        topic,
        category,
        action,
        sentCount
      });
      
      return sentCount;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Error broadcasting to topic ${topic}:`, error);
      return 0;
    }
  }
  
  /**
   * Store a message in the websocket_messages table for users that might be offline
   * 
   * @param {string} targetRole - Role to target
   * @param {string} category - Message category
   * @param {string} action - Specific action
   * @param {Object} data - The data payload
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Stored messages for each target user
   */
  async storeMessage(targetRole, category, action, data, options = {}) {
    try {
      // Find all users with the target role
      const users = await prisma.users.findMany({
        where: { 
          role: targetRole,
          is_banned: false 
        },
        select: { 
          wallet_address: true 
        }
      });
      
      // Prepare the data to store
      const messageData = {
        category,
        action,
        content: data,
        priority: options.priority || 'normal',
        source: options.source || 'system',
        timestamp: new Date().toISOString()
      };
      
      // Create messages for each user
      const createdMessages = [];
      
      for (const user of users) {
        const message = await prisma.websocket_messages.create({
          data: {
            type: category,
            data: messageData,
            wallet_address: user.wallet_address,
            delivered: false,
            read: false
          }
        });
        
        createdMessages.push(message);
      }
      
      logApi.info(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Stored ${createdMessages.length} messages for ${targetRole} users`, {
        category,
        action,
        targetRole,
        messageCount: createdMessages.length
      });
      
      return createdMessages;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Error storing messages:`, error);
      return [];
    }
  }
  
  /**
   * Broadcast a message to specific users by wallet address
   * 
   * @param {Array<string>} walletAddresses - Array of wallet addresses to target
   * @param {string} category - Message category
   * @param {string} action - Specific action
   * @param {Object} data - The data payload to send
   * @param {Object} options - Additional options
   * @returns {Promise<number>} - Number of clients the message was sent to
   */
  async broadcastToUsers(walletAddresses, category, action, data, options = {}) {
    const unifiedWS = config.websocket.unifiedWebSocket;
    
    if (!unifiedWS) {
      const errorMsg = `Failed to broadcast - Unified WebSocket not initialized`;
      logApi.warn(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} ${errorMsg}`);
      // Add diagnostic info
      logApi.debug(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} WebSocket config debug info: ${JSON.stringify({
        configHasWebSocketSection: !!config.websocket,
        configHasTopics: !!config.websocket?.topics,
        userCount: walletAddresses?.length || 0,
        serviceCategory: category,
        serviceAction: action
      })}`);
      // Throw error so callers know broadcast failed
      throw new Error(`WebSocket broadcast failed: ${errorMsg}`);
    }
    
    // Create the message
    const message = {
      type: 'DATA',
      topic: 'user', // Using user topic for user-specific messages
      subtype: category,
      action: action,
      data: data,
      priority: options.priority || 'normal',
      timestamp: new Date().toISOString()
    };
    
    let sentCount = 0;
    const persistMessages = options.persist === true || options.priority === 'high';
    const storedMessages = [];
    
    try {
      // For each wallet address
      for (const walletAddress of walletAddresses) {
        let messageSent = false;
        
        // Find all WebSocket connections for this user
        if (unifiedWS.clientsByUserId && unifiedWS.clientsByUserId.has(walletAddress)) {
          const userClients = unifiedWS.clientsByUserId.get(walletAddress);
          
          // Send to all the user's active connections
          for (const client of userClients) {
            unifiedWS.send(client, message);
            sentCount++;
            messageSent = true;
          }
        }
        
        // If persist is enabled or the message wasn't sent live, store it
        if (persistMessages || !messageSent) {
          const storedMessage = await prisma.websocket_messages.create({
            data: {
              type: category,
              data: {
                category,
                action,
                content: data,
                priority: options.priority || 'normal',
                source: options.source || 'system',
                timestamp: new Date().toISOString()
              },
              wallet_address: walletAddress,
              delivered: messageSent,
              delivered_at: messageSent ? new Date() : null,
              read: false
            }
          });
          
          storedMessages.push(storedMessage);
        }
      }
      
      logApi.info(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Sent ${category}/${action} to ${sentCount} connections for ${walletAddresses.length} users`, {
        category,
        action,
        userCount: walletAddresses.length,
        connectionCount: sentCount,
        storedMessageCount: storedMessages.length
      });
      
      return sentCount;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[WS_BROADCASTER]${fancyColors.RESET} Error broadcasting to users:`, error);
      return 0;
    }
  }
}

// Export singleton instance
const broadcaster = new WSBroadcaster();
export default broadcaster;