// utils/discord-webhook.js
import fetch from 'node-fetch';
import { logApi } from './logger-suite/logger.js';

/**
 * Discord webhook client for sending notifications to Discord channels
 */
class DiscordWebhook {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Send a simple message to Discord
   * @param {string} content - The message content 
   * @returns {Promise<boolean>} - Success status
   */
  async sendMessage(content) {
    try {
      if (!this.webhookUrl) {
        logApi.warn('[DiscordWebhook] No webhook URL provided');
        return false;
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logApi.error(`[DiscordWebhook] Failed to send message: ${errorText}`);
        return false;
      }

      return true;
    } catch (error) {
      logApi.error('[DiscordWebhook] Error sending message:', error);
      return false;
    }
  }

  /**
   * Send a rich embed message to Discord
   * @param {Object} embed - Discord embed object
   * @returns {Promise<boolean>} - Success status
   */
  async sendEmbed(embed) {
    try {
      if (!this.webhookUrl) {
        logApi.warn('[DiscordWebhook] No webhook URL provided');
        return false;
      }

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ embeds: [embed] }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logApi.error(`[DiscordWebhook] Failed to send embed: ${errorText}`);
        return false;
      }

      return true;
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