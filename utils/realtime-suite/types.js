/**
 * @file Type definitions for realtime events
 * @description Provides standardized event types for type checking
 */

/**
 * Common metadata added to all events
 * @typedef {Object} EventMetadata
 * @property {number} timestamp - Timestamp when event was created
 * @property {string} channel - Channel the event was published on
 */

/**
 * Base event interface all events extend
 * @typedef {Object} BaseEvent
 * @property {EventMetadata} _meta - Event metadata
 */

/**
 * Token price change event
 * @typedef {Object} TokenPriceEvent
 * @property {number} id - Token ID
 * @property {string} address - Token address
 * @property {number|string} price - New token price
 * @property {number|string} previousPrice - Previous token price
 * @property {number|string} [changePercent] - Percent change
 * @property {number} [timestamp] - Time of price change
 * @property {string} [source] - Source of price update (jupiter, helius, etc)
 */

/**
 * Token metadata update event
 * @typedef {Object} TokenMetadataEvent
 * @property {number} id - Token ID
 * @property {string} address - Token address
 * @property {string} [name] - Token name
 * @property {string} [symbol] - Token symbol
 * @property {number} [decimals] - Token decimals
 * @property {string} [imageUrl] - Token image URL
 * @property {object} [socialLinks] - Token social links
 * @property {string} [description] - Token description
 */

/**
 * Contest status change event
 * @typedef {Object} ContestStatusEvent
 * @property {number} id - Contest ID
 * @property {string} code - Contest code
 * @property {string} previousStatus - Previous status
 * @property {string} status - New status
 * @property {number} [participantCount] - Current participant count
 * @property {string|number} [prizePool] - Current prize pool
 */

/**
 * User balance update event
 * @typedef {Object} UserBalanceEvent
 * @property {string} walletAddress - User wallet address
 * @property {string|number} previousBalance - Previous balance
 * @property {string|number} balance - New balance
 * @property {string} [currency] - Currency (SOL, DUEL, etc)
 */

/**
 * System status event
 * @typedef {Object} SystemStatusEvent
 * @property {string} status - System status
 * @property {string} [component] - System component
 * @property {string} [message] - Status message
 * @property {number} [uptime] - System uptime in seconds
 */

export const EventTypes = {
  TOKEN_PRICE: 'TokenPriceEvent',
  TOKEN_METADATA: 'TokenMetadataEvent',
  CONTEST_STATUS: 'ContestStatusEvent',
  USER_BALANCE: 'UserBalanceEvent',
  SYSTEM_STATUS: 'SystemStatusEvent'
};