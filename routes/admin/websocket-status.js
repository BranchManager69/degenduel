import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import fetch from 'node-fetch';
import serviceEvents from '../../utils/service-suite/service-events.js';
import config from '../../config/config.js';

const router = express.Router();

/**
 * Check a WebSocket endpoint's availability
 */
router.post('/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { socketType, url, endpoint } = req.body;
    
    if (!socketType || !url || !endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
      });
    }

    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_STATUS_CHECK',
      {
        socketType,
        url,
        endpoint,
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    // Check the WebSocket endpoint availability
    const isAvailable = await checkEndpointAvailability(url, endpoint, socketType);
    
    return res.json({
      success: true,
      socketType,
      status: isAvailable ? 'online' : 'offline',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logApi.error('[WebSocket Status] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check WebSocket status',
    });
  }
});

/**
 * Test WebSocket message sending (for the testing panel)
 */
router.post('/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { socketType, messageType, payload } = req.body;
    
    if (!socketType || !messageType || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
      });
    }

    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_TEST_MESSAGE',
      {
        socketType,
        messageType,
        payload
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );

    // Try to find the WebSocket server and send the message
    let messageSent = false;
    let targetServer = null;
    let system = 'legacy';
    
    // Check if the socketType includes a system prefix
    const isV69 = socketType.toLowerCase().startsWith('v69_') || socketType.toLowerCase().startsWith('v69:');
    if (isV69) {
      socketType = socketType.replace(/^v69[_:]/, '');
      system = 'v69';
    }
    
    // We only have the unified WebSocket now, so simpler logic
    if (socketType.toLowerCase() === 'unified' || socketType.toLowerCase() === 'v69' || 
        socketType.toLowerCase().includes('market') || socketType.toLowerCase().includes('token')) {
      if (config.websocket?.unifiedWebSocket) {
        targetServer = config.websocket.unifiedWebSocket;
        system = 'unified';
      }
    }
    
    // If we found a server, try to broadcast the message
    if (targetServer && typeof targetServer.broadcast === 'function') {
      try {
        targetServer.broadcast({
          type: messageType,
          data: payload,
          testMessage: true,
          timestamp: new Date().toISOString()
        });
        messageSent = true;
        
        logApi.info(`[WebSocket Test] Admin ${req.user.username} sent ${messageType} to ${system}:${socketType}:`, payload);
      } catch (broadcastError) {
        logApi.error(`[WebSocket Test] Error broadcasting to ${system}:${socketType}:`, broadcastError);
      }
    }
    
    if (!messageSent) {
      // If we couldn't send the message, just log it
      logApi.info(`[WebSocket Test] Admin ${req.user.username} attempted to send ${messageType} to ${socketType}, but server not found:`, payload);
    }
    
    return res.json({
      success: true,
      socketType,
      messageType,
      messageSent,
      targetServer: targetServer ? targetServer.name || 'Unknown' : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logApi.error('[WebSocket Test] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send test message',
    });
  }
});

/**
 * WebSocket health check endpoint (publicly accessible)
 */
router.get('/healthcheck', (req, res) => {
  try {
    const { endpoint } = req.query;
    
    if (!endpoint) {
      return res.status(400).json({
        success: false,
        error: 'Missing endpoint parameter',
      });
    }
    
    // Check if endpoint is for unified WebSocket
    let serviceStatus = 'unknown';
    let isAvailable = false;
    
    // All endpoints now go through the unified WebSocket
    if (endpoint.toLowerCase().includes('/api/v69/ws') || 
        endpoint.toLowerCase().includes('unified')) {
        
      // Check the unified WebSocket
      if (config.websocket?.unifiedWebSocket) {
        const ws = config.websocket.unifiedWebSocket;
        if (ws && ws.path && 
            (endpoint.includes(ws.path) || endpoint.toLowerCase().includes('unified'))) {
          serviceStatus = ws.isInitialized ? 'operational' : 'initializing';
          isAvailable = ws.isInitialized;
        }
      }
    }
    
    return res.json({
      success: true,
      endpoint,
      status: isAvailable ? 'available' : 'unavailable',
      serviceStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logApi.error('[WebSocket Healthcheck] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check WebSocket health',
    });
  }
});

/**
 * Get list of available WebSocket endpoints
 */
router.get('/endpoints', requireAuth, requireAdmin, async (req, res) => {
  try {
    const endpoints = [];
    
    // We only have the unified WebSocket now
    const ws = config.websocket?.unifiedWebSocket;
    if (ws && ws.path) {
      // Get connection count
      const connectionsCount = ws.wss?.clients?.size || 0;
      
      // Add the unified WebSocket to the list
      endpoints.push({
        name: 'Unified WebSocket',
        type: 'unified',
        path: ws.path,
        status: ws.isInitialized ? 'operational' : 'initializing',
        clients: connectionsCount,
        requiresAuth: false, // Base endpoint doesn't require auth, only specific topics
        system: 'unified',
        topics: Object.values(config.websocket.topics || {}).length
      });
      
      // Add each topic as a virtual endpoint for better UI display
      Object.entries(config.websocket.topics || {}).forEach(([key, topic]) => {
        // Get count of subscribers to this topic
        const subscribers = ws.topicSubscribers?.get(topic)?.size || 0;
        
        endpoints.push({
          name: `Topic: ${topic}`,
          type: 'topic',
          path: `${ws.path}#${topic}`,
          status: ws.isInitialized ? 'operational' : 'initializing',
          clients: subscribers,
          requiresAuth: ['PORTFOLIO', 'USER', 'ADMIN', 'WALLET'].includes(key),
          system: 'unified',
          parentEndpoint: 'unified'
        });
      });
    }
    
    return res.json({
      success: true,
      endpoints,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logApi.error('[WebSocket Endpoints] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket endpoints',
    });
  }
});

/**
 * Report a test WebSocket error (for testing the error reporting system)
 */
router.post('/report-error', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { service, error, source } = req.body;
    
    if (!service || !error) {
      return res.status(400).json({
        success: false,
        error: 'Service name and error message are required',
      });
    }
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_TEST_ERROR',
      {
        service,
        error,
        source: source || 'admin_api'
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    // Create error data
    const errorData = {
      name: service,
      source: source || 'admin_api',
      status: 'error',
      error: error,
      details: {
        reportedBy: req.user.wallet_address,
        timestamp: new Date().toISOString(),
        type: 'manual_test',
        message: error
      }
    };
    
    // Emit error event
    serviceEvents.emit('service:error', errorData);
    
    logApi.warn(`[WebSocket Test] Admin ${req.user.username || req.user.wallet_address} reported test error: ${error} for service: ${service}`);
    
    return res.json({
      success: true,
      service,
      error,
      timestamp: new Date().toISOString(),
      message: 'Test error reported successfully'
    });
  } catch (error) {
    logApi.error('[WebSocket Test Error] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to report test error',
    });
  }
});

/**
 * Get recent WebSocket errors
 */
router.get('/errors', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { limit = 20, source, service } = req.query;
    
    // Log admin action
    await AdminLogger.logAction(
      req.user.wallet_address,
      'WEBSOCKET_ERROR_CHECK',
      {
        limit,
        source,
        service
      },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    let errors = [];
    
    // Try to get errors from v69 monitor WebSocket if available
    if (global.wsServersV69?.monitor && global.wsServersV69.monitor.errorsCache) {
      errors = [...global.wsServersV69.monitor.errorsCache];
      
      // Apply filters
      if (source) {
        errors = errors.filter(error => error.source === source || 
                                       (error.source && error.source.includes(source)));
      }
      
      if (service) {
        errors = errors.filter(error => error.service === service || 
                                      (error.service && error.service.includes(service)));
      }
      
      // Apply limit
      const parsedLimit = parseInt(limit);
      if (!isNaN(parsedLimit) && parsedLimit > 0) {
        errors = errors.slice(0, parsedLimit);
      }
    }
    
    // With unified approach, error tracking has been simplified
    // No more monitor-specific error tracking
    return res.json({
      success: true,
      errors,
      counts: {
        total: errors.length,
        filtered: errors.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logApi.error('[WebSocket Errors] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket errors',
    });
  }
});

/**
 * Check if a WebSocket endpoint is available
 */
async function checkEndpointAvailability(wsUrl, endpoint, socketType) {
  try {
    // Remove websocket protocol prefix for HTTP checks
    const httpUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    
    // For dynamic endpoints with path parameters (like :contestId), replace with a test value
    const processedEndpoint = endpoint.replace(/:(\w+)/g, '123');
    
    // Determine which system we're checking (v69 or legacy)
    const isV69 = socketType.toLowerCase().startsWith('v69_') || 
                 socketType.toLowerCase().startsWith('v69:') ||
                 processedEndpoint.toLowerCase().startsWith('/api/v69/') || 
                 processedEndpoint.toLowerCase().includes('v69');
    const system = isV69 ? 'v69' : 'legacy';
    
    // Clean up socketType if it has a prefix
    if (socketType.toLowerCase().startsWith('v69_') || socketType.toLowerCase().startsWith('v69:')) {
      socketType = socketType.replace(/^v69[_:]/, '');
    }
    
    // Check if the WebSocket server exists by checking the monitor server
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Access the WebSocket metrics from the monitor service
      const wsMonitor = global.wsServers['monitor'];
      if (wsMonitor) {
        const services = wsMonitor.monitorService?.getServiceMetrics() || [];
        
        // Look for a matching service in the metrics, filtered by system
        const matchingService = services.find(service => 
          service.name && 
          (service.name.toLowerCase().includes(socketType?.toLowerCase() || '') ||
           processedEndpoint.toLowerCase().includes(service.name.toLowerCase().replace(' websocket', ''))) &&
          (!service.system || service.system === system)
        );
        
        if (matchingService) {
          return matchingService.status === 'operational';
        }
      }
    }
    
    // Direct check in v69 WebSockets if applicable
    if (system === 'v69' && global.wsServersV69) {
      for (const [name, server] of Object.entries(global.wsServersV69)) {
        if (server && server.path && 
            (processedEndpoint.includes(server.path) || 
             name.toLowerCase() === socketType.toLowerCase() ||
             name.toLowerCase() === processedEndpoint.toLowerCase().replace(/^\/api\/v69\/ws\//, ''))) {
          return server.isInitialized;
        }
      }
    }
    
    // Check using the WebSocket healthcheck endpoint
    try {
      const response = await fetch(`${httpUrl}/api/admin/websocket/healthcheck?endpoint=${encodeURIComponent(processedEndpoint)}`);
      
      if (response.ok) {
        const data = await response.json();
        return data.status === 'available';
      }
    } catch (healthErr) {
      logApi.debug('[WebSocket Status] Health check failed, trying fallback:', healthErr);
    }
    
    // Final fallback - basic HTTP check
    try {
      const response = await fetch(`${httpUrl}/api/health`);
      return response.ok;
    } catch (err) {
      return false;
    }
  } catch (error) {
    logApi.error('[WebSocket Status] Error checking availability:', error);
    return false;
  }
}

export default router;