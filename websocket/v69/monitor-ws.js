/**
 * Monitor WebSocket (v69)
 * 
 * This WebSocket provides real-time system monitoring including:
 * - System status updates
 * - Maintenance mode status
 * - System settings
 * - Service health metrics
 * 
 * It replaces several HTTP polling endpoints with a single WebSocket connection
 * for more efficient real-time updates.
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';

// Log prefix for Monitor WebSocket
const LOG_PREFIX = `${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE} MONITOR-WS ${fancyColors.RESET}`;

// Constants for message types
const MESSAGE_TYPES = {
  // Server → Client messages
  SYSTEM_STATUS: 'SERVER_STATUS_UPDATE', // Changed to match frontend expectation
  MAINTENANCE_STATUS: 'maintenance_status',
  SYSTEM_SETTINGS: 'system_settings',
  SERVICE_STATUS: 'service_status',
  SERVICE_METRICS: 'service_metrics',
  ALL_SERVICES: 'all_services',
  NOTIFICATION: 'notification',
  
  // Client → Server messages
  GET_SYSTEM_STATUS: 'get_system_status',
  GET_MAINTENANCE_STATUS: 'get_maintenance_status',
  GET_SYSTEM_SETTINGS: 'get_system_settings',
  GET_SERVICE_STATUS: 'get_service_status',
  GET_ALL_SERVICES: 'get_all_services'
};

// Constants for channel names
const CHANNELS = {
  SYSTEM_STATUS: 'system.status',
  MAINTENANCE_STATUS: 'system.maintenance',
  SYSTEM_SETTINGS: 'system.settings',
  SERVICE_STATUS: 'service.status',
  SERVICES: 'services',
  // Special public channel for background scene
  BACKGROUND_SCENE: 'public.background_scene'
};

/**
 * Monitor WebSocket Server
 * Provides real-time monitoring of system status, maintenance mode, and services
 */
class MonitorWebSocketServer extends BaseWebSocketServer {
  /**
   * Create a new MonitorWebSocketServer
   * @param {http.Server} server - The HTTP server to attach to
   */
  constructor(server) {
    super(server, {
      path: '/api/v69/ws/monitor',
      requireAuth: true,
      publicEndpoints: [CHANNELS.BACKGROUND_SCENE],
      maxPayload: 64 * 1024, // 64KB should be plenty
      rateLimit: 120, // 2 messages per second
      heartbeatInterval: 30000 // 30s heartbeat
    });
    
    // Initialize data caches
    this.systemStatusCache = { status: 'initializing', updated_at: new Date() };
    this.maintenanceCache = { mode: false, message: null, updated_at: new Date() };
    this.systemSettingsCache = new Map();
    this.servicesCache = new Map();
    
    // Schedule regular updates
    this._setupDataUpdateIntervals();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.CYAN}Monitor WebSocket initialized on ${fancyColors.BOLD}${this.path}${fancyColors.RESET}`);
  }
  
  /**
   * Set up regular data update intervals
   * @private
   */
  _setupDataUpdateIntervals() {
    // Check system status every 5 seconds
    this._systemStatusInterval = setInterval(() => {
      this._updateSystemStatus();
    }, 5000);
    
    // Check maintenance status every 5 seconds
    this._maintenanceInterval = setInterval(() => {
      this._updateMaintenanceStatus();
    }, 5000);
    
    // Update system settings every 30 seconds
    this._systemSettingsInterval = setInterval(() => {
      this._updateSystemSettings();
    }, 30000);
    
    // Update service status every 10 seconds
    this._servicesInterval = setInterval(() => {
      this._updateServiceStatus();
    }, 10000);
  }
  
  /**
   * Initialize the monitor WebSocket
   */
  async onInitialize() {
    try {
      // Load initial data
      await Promise.all([
        this._updateSystemStatus(),
        this._updateMaintenanceStatus(),
        this._updateSystemSettings(),
        this._updateServiceStatus()
      ]);
      
      logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}${fancyColors.BOLD}Initialization complete${fancyColors.RESET} - data loaded successfully`);
      return true;
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Initialization failed: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  /**
   * Handle new WebSocket connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Generate wallet display string
    const walletDisplay = clientInfo.authenticated ? 
                       `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                         fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.wallet_address.substring(0,8)}...${fancyColors.RESET}` : 
                       `${fancyColors.LIGHT_GRAY}unauthenticated${fancyColors.RESET}`;
    
    const roleDisplay = clientInfo.authenticated ?
                      `${clientInfo.user.role === 'superadmin' || clientInfo.user.role === 'admin' ? 
                        fancyColors.RED : fancyColors.PURPLE}${clientInfo.user.role}${fancyColors.RESET}` :
                      `${fancyColors.LIGHT_GRAY}none${fancyColors.RESET}`;
    
    // Log connection
    logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}New connection${fancyColors.RESET} ID:${clientInfo.connectionId.substring(0,8)} ${walletDisplay} role:${roleDisplay}`, {
      connectionId: clientInfo.connectionId,
      authenticated: clientInfo.authenticated,
      wallet: clientInfo.authenticated ? clientInfo.user.wallet_address : 'unauthenticated',
      role: clientInfo.authenticated ? clientInfo.user.role : 'none'
    });
    
    // If this is a public endpoint access only, restrict subscription capabilities
    if (!clientInfo.authenticated && req.url.includes(CHANNELS.BACKGROUND_SCENE)) {
      // Subscribe to the background scene channel automatically
      await this.subscribeToChannel(ws, CHANNELS.BACKGROUND_SCENE);
      
      // Send current background scene setting
      const backgroundScene = this.systemSettingsCache.get('background_scene');
      if (backgroundScene) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SYSTEM_SETTINGS,
          subtype: 'background_scene',
          data: backgroundScene
        });
      }
      
      return;
    }
    
    // For authenticated users, send welcome message with capabilities
    if (clientInfo.authenticated) {
      this.sendToClient(ws, {
        type: 'welcome',
        message: 'Monitor WebSocket Connected',
        capabilities: {
          systemStatus: true,
          maintenanceStatus: true,
          systemSettings: true,
          serviceStatus: true,
          authenticated: true,
          role: clientInfo.user.role
        }
      });
      
      // Auto-subscribe to channels based on role
      if (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin') {
        // Admins get all channels
        await this.subscribeToChannel(ws, CHANNELS.SYSTEM_STATUS);
        await this.subscribeToChannel(ws, CHANNELS.MAINTENANCE_STATUS);
        await this.subscribeToChannel(ws, CHANNELS.SYSTEM_SETTINGS);
        await this.subscribeToChannel(ws, CHANNELS.SERVICES);
      } else {
        // Regular users get public info
        await this.subscribeToChannel(ws, CHANNELS.SYSTEM_STATUS);
        await this.subscribeToChannel(ws, CHANNELS.MAINTENANCE_STATUS);
        await this.subscribeToChannel(ws, CHANNELS.BACKGROUND_SCENE);
      }
      
      // Send initial data for subscribed channels
      this._sendInitialData(ws, clientInfo);
    }
  }
  
  /**
   * Send initial data to a newly connected client
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  _sendInitialData(ws, clientInfo) {
    // Send system status
    if (clientInfo.subscriptions.has(CHANNELS.SYSTEM_STATUS)) {
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.SYSTEM_STATUS,
        data: this.systemStatusCache
      });
    }
    
    // Send maintenance status
    if (clientInfo.subscriptions.has(CHANNELS.MAINTENANCE_STATUS)) {
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.MAINTENANCE_STATUS,
        data: this.maintenanceCache
      });
    }
    
    // Send background scene for public channel
    if (clientInfo.subscriptions.has(CHANNELS.BACKGROUND_SCENE)) {
      const backgroundScene = this.systemSettingsCache.get('background_scene');
      if (backgroundScene) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SYSTEM_SETTINGS,
          subtype: 'background_scene',
          data: backgroundScene
        });
      }
    }
    
    // Send all system settings for admins
    if (clientInfo.subscriptions.has(CHANNELS.SYSTEM_SETTINGS)) {
      const allSettings = {};
      for (const [key, value] of this.systemSettingsCache.entries()) {
        allSettings[key] = value;
      }
      
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.SYSTEM_SETTINGS,
        subtype: 'all',
        data: allSettings
      });
    }
    
    // Send service status for admins
    if (clientInfo.subscriptions.has(CHANNELS.SERVICES)) {
      const services = [];
      for (const [name, status] of this.servicesCache.entries()) {
        services.push({
          name,
          ...status
        });
      }
      
      this.sendToClient(ws, {
        type: MESSAGE_TYPES.ALL_SERVICES,
        data: services
      });
    }
  }
  
  /**
   * Handle messages from clients
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The message object
   */
  async onMessage(ws, message) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Handle message based on type
    try {
      switch (message.type) {
        case MESSAGE_TYPES.GET_SYSTEM_STATUS:
          this._handleGetSystemStatus(ws, clientInfo);
          break;
          
        case MESSAGE_TYPES.GET_MAINTENANCE_STATUS:
          this._handleGetMaintenanceStatus(ws, clientInfo);
          break;
          
        case MESSAGE_TYPES.GET_SYSTEM_SETTINGS:
          this._handleGetSystemSettings(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.GET_SERVICE_STATUS:
          this._handleGetServiceStatus(ws, clientInfo, message);
          break;
          
        case MESSAGE_TYPES.GET_ALL_SERVICES:
          this._handleGetAllServices(ws, clientInfo);
          break;
          
        default:
          this.sendError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
          break;
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Message handling failed: ${error.message}${fancyColors.RESET}`, error);
      this.sendError(ws, 'INTERNAL_ERROR', 'Error processing message');
    }
  }
  
  /**
   * Handle client subscription
   * @param {WebSocket} ws - The WebSocket connection
   * @param {string} channel - The channel name
   */
  async onSubscribe(ws, channel) {
    const clientInfo = this.clientInfoMap.get(ws);
    if (!clientInfo) return;
    
    // Send initial data for the subscribed channel
    switch (channel) {
      case CHANNELS.SYSTEM_STATUS:
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SYSTEM_STATUS,
          data: this.systemStatusCache
        });
        break;
        
      case CHANNELS.MAINTENANCE_STATUS:
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.MAINTENANCE_STATUS,
          data: this.maintenanceCache
        });
        break;
        
      case CHANNELS.SYSTEM_SETTINGS:
        const allSettings = {};
        for (const [key, value] of this.systemSettingsCache.entries()) {
          allSettings[key] = value;
        }
        
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SYSTEM_SETTINGS,
          subtype: 'all',
          data: allSettings
        });
        break;
        
      case CHANNELS.BACKGROUND_SCENE:
        const backgroundScene = this.systemSettingsCache.get('background_scene');
        if (backgroundScene) {
          this.sendToClient(ws, {
            type: MESSAGE_TYPES.SYSTEM_SETTINGS,
            subtype: 'background_scene',
            data: backgroundScene
          });
        }
        break;
        
      case CHANNELS.SERVICES:
        const services = [];
        for (const [name, status] of this.servicesCache.entries()) {
          services.push({
            name,
            ...status
          });
        }
        
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.ALL_SERVICES,
          data: services
        });
        break;
    }
  }
  
  /**
   * Handle get system status request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  _handleGetSystemStatus(ws, clientInfo) {
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.SYSTEM_STATUS,
      data: this.systemStatusCache
    });
  }
  
  /**
   * Handle get maintenance status request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  _handleGetMaintenanceStatus(ws, clientInfo) {
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.MAINTENANCE_STATUS,
      data: this.maintenanceCache
    });
  }
  
  /**
   * Handle get system settings request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  _handleGetSystemSettings(ws, clientInfo, message) {
    // Check if requesting a specific setting
    if (message.key) {
      const setting = this.systemSettingsCache.get(message.key);
      
      if (setting) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SYSTEM_SETTINGS,
          subtype: message.key,
          data: setting
        });
      } else {
        this.sendError(ws, 'SETTING_NOT_FOUND', `System setting not found: ${message.key}`);
      }
      return;
    }
    
    // If no specific key, send all settings
    const allSettings = {};
    for (const [key, value] of this.systemSettingsCache.entries()) {
      allSettings[key] = value;
    }
    
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.SYSTEM_SETTINGS,
      subtype: 'all',
      data: allSettings
    });
  }
  
  /**
   * Handle get service status request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @param {Object} message - The message object
   * @private
   */
  _handleGetServiceStatus(ws, clientInfo, message) {
    // Check if user is admin/superadmin
    const isAdmin = clientInfo.authenticated && 
                   (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    if (!isAdmin) {
      this.sendError(ws, 'UNAUTHORIZED', 'You do not have permission to access service status');
      return;
    }
    
    // Check if requesting a specific service
    if (message.service) {
      const serviceStatus = this.servicesCache.get(message.service);
      
      if (serviceStatus) {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.SERVICE_STATUS,
          service: message.service,
          data: serviceStatus
        });
      } else {
        this.sendError(ws, 'SERVICE_NOT_FOUND', `Service not found: ${message.service}`);
      }
      return;
    }
    
    // If no specific service, send error
    this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
  }
  
  /**
   * Handle get all services request
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} clientInfo - Client information
   * @private
   */
  _handleGetAllServices(ws, clientInfo) {
    // Check if user is admin/superadmin
    const isAdmin = clientInfo.authenticated && 
                   (clientInfo.user.role === 'admin' || clientInfo.user.role === 'superadmin');
    
    if (!isAdmin) {
      this.sendError(ws, 'UNAUTHORIZED', 'You do not have permission to access service status');
      return;
    }
    
    const services = [];
    for (const [name, status] of this.servicesCache.entries()) {
      services.push({
        name,
        ...status
      });
    }
    
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.ALL_SERVICES,
      data: services
    });
  }
  
  /**
   * Update system status from database or API
   * @private
   */
  async _updateSystemStatus() {
    try {
      // Get system status
      const status = await this._fetchSystemStatus();
      
      // Check if anything changed
      if (JSON.stringify(status) !== JSON.stringify(this.systemStatusCache)) {
        // Update cache
        this.systemStatusCache = status;
        
        // Broadcast to subscribers
        this.broadcastToChannel(CHANNELS.SYSTEM_STATUS, {
          type: MESSAGE_TYPES.SYSTEM_STATUS,
          data: status
        });
        
        logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}System status updated to ${fancyColors.BOLD}${status.status}${fancyColors.RESET} - ${status.message}`, {
          status: status.status,
          message: status.message
        });
      }
    } catch (error) {
      logApi.error(`${LOG_PREFIX} ${fancyColors.BG_RED}${fancyColors.WHITE} ERROR ${fancyColors.RESET} ${fancyColors.RED}Failed to update system status: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update maintenance status from database or API
   * @private
   */
  async _updateMaintenanceStatus() {
    try {
      // Get maintenance status
      const maintenance = await this._fetchMaintenanceStatus();
      
      // Check if anything changed
      if (JSON.stringify(maintenance) !== JSON.stringify(this.maintenanceCache)) {
        const oldMode = this.maintenanceCache.mode;
        
        // Update cache
        this.maintenanceCache = maintenance;
        
        // Broadcast to subscribers
        this.broadcastToChannel(CHANNELS.MAINTENANCE_STATUS, {
          type: MESSAGE_TYPES.MAINTENANCE_STATUS,
          data: maintenance
        });
        
        // Log a more prominent message if maintenance mode changed state
        if (oldMode !== maintenance.mode) {
          const modeColor = maintenance.mode ? fancyColors.RED : fancyColors.GREEN;
          const modeText = maintenance.mode ? 'ENABLED' : 'DISABLED';
          
          logApi.info(`${LOG_PREFIX} ${fancyColors.BG_LIGHT_YELLOW}${fancyColors.BLACK} MAINTENANCE ${fancyColors.RESET} ${modeColor}${fancyColors.BOLD}${modeText}${fancyColors.RESET} ${maintenance.message ? `"${maintenance.message}"` : ''}`, {
            message: maintenance.message || 'No message'
          });
        } else {
          logApi.debug(`${LOG_PREFIX} ${fancyColors.CYAN}Maintenance status updated${fancyColors.RESET} - mode:${maintenance.mode ? 'enabled' : 'disabled'}`, {
            mode: maintenance.mode,
            message: maintenance.message || 'No message'
          });
        }
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error updating maintenance status:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update system settings from database or API
   * @private
   */
  async _updateSystemSettings() {
    try {
      // Get system settings
      const settings = await this._fetchSystemSettings();
      
      // Check each setting for changes
      let hasChanges = false;
      const changedSettings = {};
      
      for (const [key, value] of Object.entries(settings)) {
        const currentValue = this.systemSettingsCache.get(key);
        
        // If setting changed or is new
        if (!currentValue || JSON.stringify(value) !== JSON.stringify(currentValue)) {
          // Update cache
          this.systemSettingsCache.set(key, value);
          changedSettings[key] = value;
          hasChanges = true;
          
          // Special handling for background_scene
          if (key === 'background_scene') {
            // Broadcast to public background scene channel
            this.broadcastToChannel(CHANNELS.BACKGROUND_SCENE, {
              type: MESSAGE_TYPES.SYSTEM_SETTINGS,
              subtype: 'background_scene',
              data: value
            });
            
            logApi.debug(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} Updated background scene setting`, {
              backgroundScene: typeof value === 'object' ? 'complex object' : value
            });
          }
        }
      }
      
      // If any settings changed, broadcast to admin subscribers
      if (hasChanges) {
        this.broadcastToChannel(CHANNELS.SYSTEM_SETTINGS, {
          type: MESSAGE_TYPES.SYSTEM_SETTINGS,
          subtype: 'update',
          data: changedSettings
        });
        
        logApi.debug(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} System settings updated`, {
          changedKeys: Object.keys(changedSettings)
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error updating system settings:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Update service status from services cache or API
   * @private
   */
  async _updateServiceStatus() {
    try {
      // Get service status
      const services = await this._fetchServiceStatus();
      
      // Check for changes
      let hasChanges = false;
      const changedServices = [];
      
      for (const [name, status] of Object.entries(services)) {
        const currentStatus = this.servicesCache.get(name);
        
        // If service status changed or is new
        if (!currentStatus || JSON.stringify(status) !== JSON.stringify(currentStatus)) {
          // Update cache
          this.servicesCache.set(name, status);
          changedServices.push({
            name,
            ...status
          });
          hasChanges = true;
          
          // Broadcast individual service update
          this.broadcastToChannel(CHANNELS.SERVICES, {
            type: MESSAGE_TYPES.SERVICE_STATUS,
            service: name,
            data: status
          });
        }
      }
      
      // If any services changed, broadcast to admin subscribers
      if (hasChanges) {
        logApi.debug(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} Service status updated`, {
          changedServices: changedServices.map(s => s.name)
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error updating service status:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Fetch system status from database or API
   * @returns {Promise<Object>} - System status
   * @private
   */
  async _fetchSystemStatus() {
    // For now, return a simple status
    // This would typically query internal APIs or databases
    
    // Check if in maintenance mode
    let statusValue = 'online'; // Default status
    let message = 'Server is operating normally';
    
    if (this.maintenanceCache && this.maintenanceCache.mode === true) {
      statusValue = 'maintenance';
      message = this.maintenanceCache.message || 'System is under maintenance';
    }
    
    // Format according to frontend team's expectations
    return {
      status: statusValue, // 'online', 'maintenance', or 'offline'
      message: message,
      timestamp: new Date().toISOString(),
      // Keep these for backward compatibility if needed
      _version: process.env.npm_package_version || '0.0.0',
      _uptime: process.uptime()
    };
  }
  
  /**
   * Fetch maintenance status from database
   * @returns {Promise<Object>} - Maintenance status
   * @private
   */
  async _fetchMaintenanceStatus() {
    try {
      // Query the maintenance mode from database
      const maintenanceRecord = await prisma.system_settings.findUnique({
        where: { key: 'maintenance_mode' }
      });
      
      if (!maintenanceRecord) {
        return {
          mode: false,
          message: null,
          updated_at: new Date().toISOString()
        };
      }
      
      // Parse the value
      let maintenanceData;
      try {
        maintenanceData = typeof maintenanceRecord.value === 'string' 
          ? JSON.parse(maintenanceRecord.value)
          : maintenanceRecord.value;
      } catch (e) {
        // If parsing fails, use the value directly
        maintenanceData = {
          enabled: maintenanceRecord.value === true || maintenanceRecord.value === 'true',
          message: 'Maintenance in progress'
        };
      }
      
      return {
        mode: maintenanceData.enabled === true,
        message: maintenanceData.message || null,
        updated_at: maintenanceRecord.updated_at?.toISOString() || new Date().toISOString()
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching maintenance status:${fancyColors.RESET}`, error);
      
      // Return last known status
      return this.maintenanceCache;
    }
  }
  
  /**
   * Fetch system settings from database
   * @returns {Promise<Object>} - System settings
   * @private
   */
  async _fetchSystemSettings() {
    try {
      // Query all system settings from database
      const settingsRecords = await prisma.system_settings.findMany();
      
      // Convert to object
      const settings = {};
      
      for (const record of settingsRecords) {
        // Parse the value if it's a JSON string
        let value;
        try {
          value = typeof record.value === 'string' 
            ? JSON.parse(record.value)
            : record.value;
        } catch (e) {
          // If parsing fails, use the value directly
          value = record.value;
        }
        
        settings[record.key] = value;
      }
      
      return settings;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error fetching system settings:${fancyColors.RESET}`, error);
      
      // Return empty object
      return {};
    }
  }
  
  /**
   * Fetch service status from global services or API
   * @returns {Promise<Object>} - Service status
   * @private
   */
  async _fetchServiceStatus() {
    // Get global WebSocket services
    const services = {};
    
    // Check if global WebSocket services exist
    if (global.wsServers) {
      // Get metrics from each WebSocket server
      for (const [name, server] of Object.entries(global.wsServers)) {
        if (server && typeof server.getMetrics === 'function') {
          try {
            const metrics = server.getMetrics();
            services[name] = metrics;
          } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[MonitorWS]${fancyColors.RESET} ${fancyColors.RED}Error getting metrics for ${name}:${fancyColors.RESET}`, error);
            services[name] = {
              status: 'error',
              error: error.message
            };
          }
        }
      }
    }
    
    // Add other services as needed
    // This is where you would add database status, external APIs, etc.
    
    return services;
  }
  
  /**
   * Clean up resources before shutdown
   */
  async onCleanup() {
    // Clear intervals
    if (this._systemStatusInterval) {
      clearInterval(this._systemStatusInterval);
      this._systemStatusInterval = null;
    }
    
    if (this._maintenanceInterval) {
      clearInterval(this._maintenanceInterval);
      this._maintenanceInterval = null;
    }
    
    if (this._systemSettingsInterval) {
      clearInterval(this._systemSettingsInterval);
      this._systemSettingsInterval = null;
    }
    
    if (this._servicesInterval) {
      clearInterval(this._servicesInterval);
      this._servicesInterval = null;
    }
    
    // Clear caches
    this.systemStatusCache = {};
    this.maintenanceCache = {};
    this.systemSettingsCache.clear();
    this.servicesCache.clear();
    
    logApi.info(`${LOG_PREFIX} ${fancyColors.GREEN}Cleanup complete${fancyColors.RESET} - all data caches cleared`);
  }
  
  /**
   * Get server metrics for monitoring
   * @returns {Object} - Server metrics
   */
  getMetrics() {
    return {
      name: 'Monitor WebSocket v69',
      status: 'operational',
      metrics: {
        ...this.stats,
        channels: {
          systemStatus: this.channelSubscriptions.get(CHANNELS.SYSTEM_STATUS)?.size || 0,
          maintenanceStatus: this.channelSubscriptions.get(CHANNELS.MAINTENANCE_STATUS)?.size || 0,
          systemSettings: this.channelSubscriptions.get(CHANNELS.SYSTEM_SETTINGS)?.size || 0,
          serviceStatus: this.channelSubscriptions.get(CHANNELS.SERVICES)?.size || 0,
          backgroundScene: this.channelSubscriptions.get(CHANNELS.BACKGROUND_SCENE)?.size || 0
        },
        lastUpdate: new Date().toISOString()
      }
    };
  }
}

// Export singleton instance
let instance = null;

/**
 * Create monitor WebSocket server instance
 * @param {http.Server} server - HTTP server
 * @returns {MonitorWebSocketServer} - Monitor WebSocket server instance
 */
export function createMonitorWebSocket(server) {
  if (!instance) {
    instance = new MonitorWebSocketServer(server);
  }
  return instance;
}

export { MonitorWebSocketServer };
export default instance;