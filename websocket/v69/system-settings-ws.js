// websocket/v69/system-settings-ws.js

/**
 * SystemSettingsWebSocket (v69)
 * 
 * Real-time system settings management with:
 * - Admin-controlled system settings updates
 * - Live settings propagation
 * - Setting categories and namespaces
 * - Validation and history tracking
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import { PrismaClient } from '@prisma/client';
import AdminLogger from '../../utils/admin-logger.js';

// Initialize Prisma client directly to avoid import issues
const prisma = new PrismaClient();

// Configuration
const WSS_PATH = '/api/v69/ws/system-settings';
const WSS_REQUIRE_AUTH = true;
const WSS_MAX_PAYLOAD = 2 * 1024 * 1024; // 2MB for settings
const WSS_PER_MESSAGE_DEFLATE = false;
const WSS_RATE_LIMIT = 100;

class SystemSettingsWebSocket extends BaseWebSocketServer {
  /**
   * Create a new SystemSettingsWebSocket
   * @param {http.Server} server - The HTTP server to attach the WebSocket to
   */
  constructor(server) {
    super(server, {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH,
      maxPayload: WSS_MAX_PAYLOAD,
      perMessageDeflate: WSS_PER_MESSAGE_DEFLATE,
      rateLimit: WSS_RATE_LIMIT
    });
    
    // Initialize settings state
    this.cachedSettings = {};
    this.settingsSubscribers = new Map(); // Map of setting name to set of connection IDs
    this.categorySubscribers = new Map(); // Map of category to set of connection IDs
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} V69 WEBSOCKET ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}System Settings WebSocket initialized${fancyColors.RESET}`);
  }
  
  /**
   * Initialize the system settings WebSocket
   */
  async onInitialize() {
    try {
      // Load all settings into cache
      await this.refreshSettingsCache();
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.CYAN}System Settings WebSocket initialized with ${Object.keys(this.cachedSettings).length} settings${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 INIT ${fancyColors.RESET} ${fancyColors.RED}Failed to initialize System Settings WebSocket:${fancyColors.RESET} ${error.message}`);
      return false;
    }
  }
  
  /**
   * Refresh the settings cache from the database
   */
  async refreshSettingsCache() {
    try {
      // Verify prisma is available
      if (!prisma || typeof prisma.systemSettings?.findMany !== 'function') {
        logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.YELLOW}Prisma client not fully initialized, using empty settings cache${fancyColors.RESET}`);
        this.cachedSettings = {};
        return false;
      }
      
      const settings = await prisma.systemSettings.findMany();
      
      // Clear existing cache and rebuild
      this.cachedSettings = {};
      
      // Group settings by category for efficient lookup
      for (const setting of settings) {
        // Normalize key format to category.name
        const key = setting.category 
          ? `${setting.category}.${setting.name}` 
          : setting.name;
          
        // Parse value (handle JSON values)
        let value = setting.value;
        if (setting.value_type === 'json' && typeof setting.value === 'string') {
          try {
            value = JSON.parse(setting.value);
          } catch (error) {
            logApi.warn(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.YELLOW}Failed to parse JSON for setting ${key}:${fancyColors.RESET} ${error.message}`);
          }
        }
        
        // Store in cache
        this.cachedSettings[key] = {
          id: setting.id,
          name: setting.name,
          category: setting.category,
          value,
          value_type: setting.value_type,
          description: setting.description,
          updatedAt: setting.updatedAt
        };
      }
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.GREEN}Refreshed settings cache with ${Object.keys(this.cachedSettings).length} settings${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.RED}Failed to refresh settings cache:${fancyColors.RESET} ${error.message}`);
      this.cachedSettings = {}; // Ensure we at least have an empty cache
      return false;
    }
  }
  
  /**
   * Handle new client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Only admins and superadmins can perform writes
    const canWrite = clientInfo.authenticated && 
      (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    // Send welcome message
    this.sendToClient(ws, {
      type: 'welcome',
      message: 'Connected to System Settings WebSocket',
      canWrite,
      timestamp: new Date().toISOString()
    });
    
    // Send all settings by default (for initial state)
    this.sendToClient(ws, {
      type: 'all_settings',
      settings: this.cachedSettings,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Handle incoming message from client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The parsed message object
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Check if user can write (admin/superadmin only)
    const canWrite = clientInfo.authenticated && 
      (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    switch (message.type) {
      case 'get_all_settings':
        // Send all settings
        this.sendToClient(ws, {
          type: 'all_settings',
          settings: this.cachedSettings,
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'get_setting':
        // Get a specific setting
        if (message.key && this.cachedSettings[message.key]) {
          this.sendToClient(ws, {
            type: 'setting',
            key: message.key,
            setting: this.cachedSettings[message.key],
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'SETTING_NOT_FOUND', `Setting "${message.key}" not found`);
        }
        break;
        
      case 'get_category_settings':
        // Get all settings in a category
        if (message.category) {
          const categorySettings = {};
          
          for (const [key, setting] of Object.entries(this.cachedSettings)) {
            if (setting.category === message.category) {
              categorySettings[key] = setting;
            }
          }
          
          this.sendToClient(ws, {
            type: 'category_settings',
            category: message.category,
            settings: categorySettings,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Category is required');
        }
        break;
        
      case 'subscribe_setting':
        // Subscribe to updates for a specific setting
        if (message.key) {
          if (!this.settingsSubscribers.has(message.key)) {
            this.settingsSubscribers.set(message.key, new Set());
          }
          
          this.settingsSubscribers.get(message.key).add(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'subscribed',
            key: message.key,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Setting key is required');
        }
        break;
        
      case 'subscribe_category':
        // Subscribe to updates for all settings in a category
        if (message.category) {
          if (!this.categorySubscribers.has(message.category)) {
            this.categorySubscribers.set(message.category, new Set());
          }
          
          this.categorySubscribers.get(message.category).add(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'subscribed_category',
            category: message.category,
            timestamp: new Date().toISOString()
          });
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Category is required');
        }
        break;
        
      case 'unsubscribe_setting':
        // Unsubscribe from a specific setting
        if (message.key && this.settingsSubscribers.has(message.key)) {
          this.settingsSubscribers.get(message.key).delete(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'unsubscribed',
            key: message.key,
            timestamp: new Date().toISOString()
          });
        }
        break;
        
      case 'unsubscribe_category':
        // Unsubscribe from a category
        if (message.category && this.categorySubscribers.has(message.category)) {
          this.categorySubscribers.get(message.category).delete(clientInfo.connectionId);
          
          this.sendToClient(ws, {
            type: 'unsubscribed_category',
            category: message.category,
            timestamp: new Date().toISOString()
          });
        }
        break;
        
      case 'update_setting':
        // Update a setting (admin/superadmin only)
        if (!canWrite) {
          this.sendError(ws, 'PERMISSION_DENIED', 'Only admins can update settings');
          return;
        }
        
        if (message.key && message.value !== undefined) {
          try {
            const parts = message.key.split('.');
            let category = null;
            let name = message.key;
            
            // If key contains a dot, parse category and name
            if (parts.length > 1) {
              category = parts[0];
              name = parts.slice(1).join('.');
            }
            
            // Determine value type
            let valueType = typeof message.value;
            let serializedValue = message.value;
            
            if (valueType === 'object') {
              valueType = 'json';
              serializedValue = JSON.stringify(message.value);
            }
            
            // Update in database
            let updatedSetting;
            
            // Check if setting exists
            if (this.cachedSettings[message.key]) {
              // Update existing setting
              updatedSetting = await prisma.systemSettings.update({
                where: { id: this.cachedSettings[message.key].id },
                data: {
                  value: serializedValue,
                  value_type: valueType,
                  updatedAt: new Date()
                }
              });
              
              logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} Setting "${message.key}" updated by ${clientInfo.user.username || clientInfo.user.wallet_address}`);
            } else {
              // Create new setting
              updatedSetting = await prisma.systemSettings.create({
                data: {
                  name,
                  category,
                  value: serializedValue,
                  value_type: valueType,
                  description: message.description || `Added by ${clientInfo.user.username || clientInfo.user.wallet_address}`
                }
              });
              
              logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} New setting "${message.key}" created by ${clientInfo.user.username || clientInfo.user.wallet_address}`);
            }
            
            // Log admin action
            AdminLogger.logAction(clientInfo.user, 'SETTING_UPDATE', {
              key: message.key,
              value: message.value,
              previous: this.cachedSettings[message.key]?.value
            });
            
            // Update cache
            this.cachedSettings[message.key] = {
              id: updatedSetting.id,
              name: updatedSetting.name,
              category: updatedSetting.category,
              value: valueType === 'json' ? JSON.parse(updatedSetting.value) : updatedSetting.value,
              value_type: updatedSetting.value_type,
              description: updatedSetting.description,
              updatedAt: updatedSetting.updatedAt
            };
            
            // Notify client of success
            this.sendToClient(ws, {
              type: 'setting_updated',
              key: message.key,
              setting: this.cachedSettings[message.key],
              timestamp: new Date().toISOString()
            });
            
            // Broadcast update to subscribers
            this.broadcastSettingUpdate(message.key, this.cachedSettings[message.key]);
          } catch (error) {
            logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.RED}Failed to update setting "${message.key}":${fancyColors.RESET} ${error.message}`);
            this.sendError(ws, 'UPDATE_FAILED', `Failed to update setting: ${error.message}`);
          }
        } else {
          this.sendError(ws, 'INVALID_REQUEST', 'Setting key and value are required');
        }
        break;
        
      default:
        logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.YELLOW}Unknown message type: ${message.type}${fancyColors.RESET}`);
    }
  }
  
  /**
   * Broadcast setting update to all subscribers
   * @param {string} key - The setting key
   * @param {Object} setting - The updated setting
   */
  broadcastSettingUpdate(key, setting) {
    // Notify subscribers of this specific setting
    if (this.settingsSubscribers.has(key)) {
      for (const connectionId of this.settingsSubscribers.get(key)) {
        const client = this.findClientByConnectionId(connectionId);
        if (client) {
          this.sendToClient(client, {
            type: 'setting_update',
            key,
            setting,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    
    // Notify subscribers of this setting's category
    if (setting.category && this.categorySubscribers.has(setting.category)) {
      for (const connectionId of this.categorySubscribers.get(setting.category)) {
        const client = this.findClientByConnectionId(connectionId);
        if (client) {
          this.sendToClient(client, {
            type: 'setting_update',
            key,
            setting,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    
    logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} V69 SETTINGS ${fancyColors.RESET} ${fancyColors.GREEN}Broadcasted update for setting "${key}"${fancyColors.RESET}`);
  }
  
  /**
   * Find client by connection ID
   * @param {string} connectionId - The connection ID
   * @returns {WebSocket|null} - The WebSocket client or null if not found
   */
  findClientByConnectionId(connectionId) {
    for (const [client, info] of this.clientInfoMap.entries()) {
      if (info.connectionId === connectionId) {
        return client;
      }
    }
    return null;
  }
  
  /**
   * Handle client disconnection
   * @param {WebSocket} ws - The WebSocket connection
   */
  onDisconnection(ws) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Remove from subscribers
    for (const subscribers of this.settingsSubscribers.values()) {
      subscribers.delete(clientInfo.connectionId);
    }
    
    for (const subscribers of this.categorySubscribers.values()) {
      subscribers.delete(clientInfo.connectionId);
    }
  }
  
  /**
   * Clean up resources when shutting down
   */
  async onCleanup() {
    this.settingsSubscribers.clear();
    this.categorySubscribers.clear();
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} V69 CLEANUP ${fancyColors.RESET} ${fancyColors.CYAN}System Settings WebSocket cleaned up${fancyColors.RESET}`);
  }
  
  /**
   * Get custom metrics for this WebSocket
   * @returns {Object} - Custom metrics
   */
  getCustomMetrics() {
    return {
      settingsCount: Object.keys(this.cachedSettings).length,
      subscriptions: {
        settings: Array.from(this.settingsSubscribers.entries())
          .map(([key, subs]) => ({ key, subscribers: subs.size }))
          .filter(s => s.subscribers > 0),
        categories: Array.from(this.categorySubscribers.entries())
          .map(([category, subs]) => ({ category, subscribers: subs.size }))
          .filter(c => c.subscribers > 0)
      },
      activeConnections: this.clientInfoMap.size
    };
  }
}

export function createSystemSettingsWebSocket(server) {
  return new SystemSettingsWebSocket(server);
}