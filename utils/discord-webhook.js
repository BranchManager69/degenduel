// utils/discord-webhook.js
import fetch from 'node-fetch';
import { logApi } from './logger-suite/logger.js';

/**
 * Discord webhook client for sending notifications to Discord channels
 * Includes rate limiting protection and automatic retries
 */
class DiscordWebhook {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
    
    // Rate limiting protection
    this.rateLimitQueue = [];
    this.lastSentTimestamp = 0;
    this.isProcessingQueue = false;
    this.MIN_INTERVAL_MS = 1500; // Minimum 1.5 second between messages to avoid rate limiting
    
    // Message deduplication (avoid sending identical messages within a short time)
    this.recentMessageHashes = new Map();
    this.DEDUPLICATION_WINDOW_MS = 60000; // 1 minute window for deduplication
    
    // Service state tracking (prevent spam during service errors)
    this.serviceErrorStates = new Map();
    this.SERVICE_ERROR_COOLDOWN_MS = 300000; // 5 minutes cooldown for service error notifications
  }

  /**
   * Generate a simple hash for a message to help with deduplication
   * @private
   */
  _getMessageHash(content) {
    let str = typeof content === 'string' ? content : JSON.stringify(content);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Check if a message is a duplicate within the time window
   * @private
   */
  _isDuplicate(content) {
    const hash = this._getMessageHash(content);
    const lastSent = this.recentMessageHashes.get(hash);
    
    if (lastSent && (Date.now() - lastSent) < this.DEDUPLICATION_WINDOW_MS) {
      return true;
    }
    
    // Store this message hash with current timestamp
    this.recentMessageHashes.set(hash, Date.now());
    
    // Clean up old message hashes
    this._cleanupMessageHashes();
    
    return false;
  }

  /**
   * Clean up old message hashes that are outside the deduplication window
   * @private
   */
  _cleanupMessageHashes() {
    const now = Date.now();
    for (const [hash, timestamp] of this.recentMessageHashes.entries()) {
      if (now - timestamp > this.DEDUPLICATION_WINDOW_MS) {
        this.recentMessageHashes.delete(hash);
      }
    }
  }

  /**
   * Tracks service error states to prevent notification spam
   * @private
   */
  _shouldThrottleServiceNotification(serviceName, status) {
    if (!serviceName) return false;
    
    // Don't throttle recovery notifications
    if (status === 'recovered' || status === 'up') {
      this.serviceErrorStates.delete(serviceName);
      return false;
    }
    
    const lastErrorTime = this.serviceErrorStates.get(serviceName);
    const now = Date.now();
    
    // If we have a recent error for this service, throttle the notification
    if (lastErrorTime && (now - lastErrorTime) < this.SERVICE_ERROR_COOLDOWN_MS) {
      return true;
    }
    
    // Record this error timestamp
    this.serviceErrorStates.set(serviceName, now);
    return false;
  }

  /**
   * Process the message queue with rate limiting
   * @private
   */
  async _processQueue() {
    if (this.isProcessingQueue || this.rateLimitQueue.length === 0) return;
    
    this.isProcessingQueue = true;
    
    try {
      while (this.rateLimitQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastSend = now - this.lastSentTimestamp;
        
        // Enforce minimum interval between messages
        if (timeSinceLastSend < this.MIN_INTERVAL_MS) {
          await new Promise(resolve => setTimeout(resolve, this.MIN_INTERVAL_MS - timeSinceLastSend));
        }
        
        const { messageData, resolve, reject, retryCount } = this.rateLimitQueue.shift();
        
        try {
          const result = await this._sendToDiscord(messageData);
          this.lastSentTimestamp = Date.now();
          resolve(result);
        } catch (error) {
          // Handle rate limiting with automatic retry
          if (error.status === 429 && error.retry_after && retryCount < 3) {
            // Put the message back in the queue with a higher retry count
            logApi.warn(`[DiscordWebhook] Rate limited, will retry in ${error.retry_after}s (attempt ${retryCount + 1}/3)`);
            
            // Add a slight delay based on the retry-after plus a small amount of jitter
            const retryMs = (error.retry_after * 1000) + Math.random() * 500;
            
            // Re-queue the message with increased retry count
            this.rateLimitQueue.unshift({
              messageData,
              resolve,
              reject,
              retryCount: retryCount + 1
            });
            
            // Pause processing for the retry period
            await new Promise(r => setTimeout(r, retryMs));
          } else {
            // Either not a rate limit error or we've exceeded retries
            reject(error);
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Actual request to Discord API
   * @private
   */
  async _sendToDiscord(messageData) {
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => response.text());
      
      const error = new Error(`Discord API error: ${response.status}`);
      error.status = response.status;
      
      if (errorData && typeof errorData === 'object') {
        // Extract retry_after from Discord response if it exists
        if (errorData.retry_after !== undefined) {
          error.retry_after = errorData.retry_after;
        }
        error.details = errorData;
      }
      
      throw error;
    }

    return true;
  }

  /**
   * Add a message to the rate-limited queue
   * @private
   */
  _queueMessage(messageData) {
    return new Promise((resolve, reject) => {
      this.rateLimitQueue.push({
        messageData,
        resolve,
        reject,
        retryCount: 0
      });
      
      // Start processing the queue
      this._processQueue();
    });
  }

  /**
   * Send a simple message to Discord with rate limiting and deduplication
   * @param {string} content - The message content 
   * @returns {Promise<boolean>} - Success status
   */
  async sendMessage(content) {
    try {
      if (!this.webhookUrl) {
        logApi.warn('[DiscordWebhook] No webhook URL provided');
        return false;
      }

      // Check for duplicate message
      if (this._isDuplicate(content)) {
        logApi.info('[DiscordWebhook] Skipping duplicate message within deduplication window');
        return true; // Report success but skip sending
      }

      // Queue the message for rate-limited delivery
      return await this._queueMessage({ content });
    } catch (error) {
      logApi.error('[DiscordWebhook] Error sending message:', error);
      return false;
    }
  }

  /**
   * Send a rich embed message to Discord with rate limiting and deduplication
   * @param {Object} embed - Discord embed object
   * @param {Array} components - Optional components (buttons, etc.)
   * @returns {Promise<boolean>} - Success status
   */
  async sendEmbed(embed, components = null) {
    try {
      if (!this.webhookUrl) {
        logApi.warn('[DiscordWebhook] No webhook URL provided');
        return false;
      }

      // Service-specific throttling (prevent spamming service error notifications)
      if (embed.title && typeof embed.title === 'string') {
        // Extract service name from titles like "🔴 Service Down: market_data_service"
        const serviceMatch = embed.title.match(/Service (?:Down|Error|Status Change):\s+(\w+)/i);
        if (serviceMatch) {
          const serviceName = serviceMatch[1];
          const status = embed.title.includes('Down') ? 'down' : 
                         embed.title.includes('Recovered') ? 'recovered' :
                         embed.title.includes('Error') ? 'error' : 'unknown';
          
          if (this._shouldThrottleServiceNotification(serviceName, status)) {
            logApi.info(`[DiscordWebhook] Throttling service notification for ${serviceName} (status: ${status})`);
            return true; // Report success but skip sending
          }
        }
      }

      // Check for duplicate message
      if (this._isDuplicate(embed)) {
        logApi.info('[DiscordWebhook] Skipping duplicate embed within deduplication window');
        return true; // Report success but skip sending
      }

      // Prepare message data with embeds
      const messageData = { embeds: [embed] };
      
      // Add components if provided (buttons, select menus, etc.)
      if (components && Array.isArray(components)) {
        messageData.components = components;
      }

      // Queue the message for rate-limited delivery
      return await this._queueMessage(messageData);
    } catch (error) {
      logApi.error('[DiscordWebhook] Error sending embed:', error);
      return false;
    }
  }

  /**
   * Create a success notification embed
   * @param {string} title - Embed title
   * @param {string} description - Embed description
   * @returns {Object} Discord embed object
   */
  createSuccessEmbed(title, description) {
    return {
      title,
      description,
      color: 0x00ff00, // Green
      timestamp: new Date().toISOString(),
      footer: {
        text: 'DegenDuel Platform',
      },
    };
  }

  /**
   * Create an error notification embed
   * @param {string} title - Embed title
   * @param {string} description - Embed description
   * @returns {Object} Discord embed object
   */
  createErrorEmbed(title, description) {
    return {
      title,
      description,
      color: 0xff0000, // Red
      timestamp: new Date().toISOString(),
      footer: {
        text: 'DegenDuel Platform',
      },
    };
  }

  /**
   * Create an info notification embed
   * @param {string} title - Embed title
   * @param {string} description - Embed description
   * @returns {Object} Discord embed object
   */
  createInfoEmbed(title, description) {
    return {
      title,
      description,
      color: 0x0099ff, // Blue
      timestamp: new Date().toISOString(),
      footer: {
        text: 'DegenDuel Platform',
      },
    };
  }
}

export default DiscordWebhook;