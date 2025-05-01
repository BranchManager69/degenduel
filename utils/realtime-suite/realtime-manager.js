/**
 * @file RealtimeManager - Core class for realtime data sync
 * @description Manages Redis pub/sub for realtime updates
 */

import IORedis from 'ioredis';
import { logApi } from '../logger-suite/logger.js';
import { channels, SYSTEM_CHANNELS } from './channels.js';

// Redis options for faster pub/sub (less overhead)
const REDIS_OPTIONS = {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  enableOfflineQueue: true,
  retryStrategy: (times) => Math.min(times * 50, 2000),
};

export class RealtimeManager {
  /**
   * Creates a new RealtimeManager
   */
  constructor() {
    // Create separate Redis clients for pub and sub (best practice)
    this.publisher = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      ...REDIS_OPTIONS,
      connectionName: 'dd-realtime-publisher',
    });

    this.subscriber = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      ...REDIS_OPTIONS,
      connectionName: 'dd-realtime-subscriber',
    });

    // Track active subscriptions
    this.handlers = new Map();
    
    // Debug mode for development
    this.debug = process.env.REALTIME_DEBUG === 'true';
    
    // Setup error handlers
    this._setupErrorHandlers();
    
    // Initialize
    this._initialize();
  }

  /**
   * Initialize the realtime system
   * @private
   */
  _initialize() {
    // Set up message handler for subscriber
    this.subscriber.on('message', (channel, message) => {
      try {
        const handlers = this.handlers.get(channel) || [];
        const data = JSON.parse(message);
        
        if (this.debug) {
          logApi.debug(`🔄 Realtime received on ${channel}:`, data);
        }
        
        // Call all handlers for this channel
        handlers.forEach(handler => {
          try {
            handler(data, channel);
          } catch (handlerError) {
            logApi.error(`Error in realtime handler for ${channel}:`, handlerError);
          }
        });
      } catch (err) {
        logApi.error(`Error processing realtime message on ${channel}:`, err);
      }
    });
    
    // Inform on startup
    this.publisher.on('connect', () => {
      if (this.debug) {
        logApi.info('🔌 Realtime publisher connected');
      }
    });
    
    this.subscriber.on('connect', () => {
      if (this.debug) {
        logApi.info('🔌 Realtime subscriber connected');
      }
      
      // Send a system heartbeat on startup
      this.publish(SYSTEM_CHANNELS.HEARTBEAT, { 
        timestamp: Date.now(),
        status: 'online',
        instance: process.env.INSTANCE_ID || 'primary'
      });
    });
  }

  /**
   * Set up error handlers for Redis clients
   * @private
   */
  _setupErrorHandlers() {
    this.publisher.on('error', (err) => {
      logApi.error('Realtime publisher error:', err);
    });
    
    this.subscriber.on('error', (err) => {
      logApi.error('Realtime subscriber error:', err);
    });
  }

  /**
   * Publish an event to a channel
   * @param {string} channel - The channel to publish to
   * @param {object} data - The data to publish
   * @returns {Promise<number>} - Number of clients that received the message
   */
  async publish(channel, data) {
    try {
      // Add metadata to all events
      const eventWithMeta = {
        ...data,
        _meta: {
          timestamp: Date.now(),
          channel,
        }
      };
      
      if (this.debug) {
        logApi.debug(`📤 Realtime publishing to ${channel}:`, eventWithMeta);
      }
      
      return await this.publisher.publish(channel, JSON.stringify(eventWithMeta));
    } catch (err) {
      logApi.error(`Error publishing to ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Subscribe to a channel
   * @param {string} channel - The channel to subscribe to
   * @param {function} handler - The handler function for messages
   * @returns {Promise<void>}
   */
  async subscribe(channel, handler) {
    try {
      // Register handler
      if (!this.handlers.has(channel)) {
        this.handlers.set(channel, []);
        // Only subscribe once per channel
        await this.subscriber.subscribe(channel);
        
        if (this.debug) {
          logApi.debug(`🔔 Subscribed to ${channel}`);
        }
      }
      
      // Add this handler
      this.handlers.get(channel).push(handler);
      
    } catch (err) {
      logApi.error(`Error subscribing to ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Unsubscribe from a channel
   * @param {string} channel - The channel to unsubscribe from
   * @param {function} [handler] - Optional specific handler to remove
   * @returns {Promise<void>}
   */
  async unsubscribe(channel, handler) {
    try {
      if (!this.handlers.has(channel)) return;
      
      // If handler provided, just remove that handler
      if (handler) {
        const handlers = this.handlers.get(channel);
        const index = handlers.indexOf(handler);
        
        if (index !== -1) {
          handlers.splice(index, 1);
        }
        
        // If no more handlers, unsubscribe from channel
        if (handlers.length === 0) {
          await this.subscriber.unsubscribe(channel);
          this.handlers.delete(channel);
          
          if (this.debug) {
            logApi.debug(`🔕 Unsubscribed from ${channel}`);
          }
        }
      } else {
        // Remove all handlers and unsubscribe
        await this.subscriber.unsubscribe(channel);
        this.handlers.delete(channel);
        
        if (this.debug) {
          logApi.debug(`🔕 Unsubscribed from all handlers on ${channel}`);
        }
      }
    } catch (err) {
      logApi.error(`Error unsubscribing from ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Check if there are subscribers for a channel
   * @param {string} channel - The channel to check
   * @returns {Promise<boolean>} - True if there are subscribers
   */
  async hasSubscribers(channel) {
    try {
      // This uses Redis PUBSUB NUMSUB command to check subscribers
      const result = await this.publisher.pubsub('NUMSUB', channel);
      return result[1] > 0;
    } catch (err) {
      logApi.error(`Error checking subscribers for ${channel}:`, err);
      return false;
    }
  }

  /**
   * Shutdown the realtime system
   * @returns {Promise<void>}
   */
  async shutdown() {
    try {
      // Send shutdown notice
      await this.publish(SYSTEM_CHANNELS.SHUTDOWN, { 
        timestamp: Date.now(),
        status: 'offline',
        instance: process.env.INSTANCE_ID || 'primary'
      });
      
      // Wait a moment for messages to be delivered
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Close connections
      await Promise.all([
        this.publisher.quit(),
        this.subscriber.quit()
      ]);
      
      if (this.debug) {
        logApi.info('🛑 Realtime system shutdown complete');
      }
      
    } catch (err) {
      logApi.error('Error shutting down realtime system:', err);
    }
  }
}