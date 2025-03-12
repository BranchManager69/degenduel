import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import fetch from 'node-fetch';
import serviceEvents from '../../utils/service-suite/service-events.js';

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
    
    // First check the specified system (v69 or legacy)
    if (system === 'v69' && global.wsServersV69 && Object.keys(global.wsServersV69).length > 0) {
      // Try to find a matching V69 WebSocket server
      for (const [serverName, server] of Object.entries(global.wsServersV69)) {
        if (serverName.toLowerCase().includes(socketType.toLowerCase()) ||
            (server.name && server.name.toLowerCase().includes(socketType.toLowerCase()))) {
          targetServer = server;
          break;
        }
      }
    } else if (system === 'legacy' && global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Try to find a matching legacy WebSocket server
      for (const [serverName, server] of Object.entries(global.wsServers)) {
        if (serverName.toLowerCase().includes(socketType.toLowerCase()) ||
            (server.name && server.name.toLowerCase().includes(socketType.toLowerCase()))) {
          targetServer = server;
          break;
        }
      }
    }
    
    // If we couldn't find a server in the specified system, check the other system
    if (!targetServer) {
      if (system === 'v69' && global.wsServers && Object.keys(global.wsServers).length > 0) {
        // Try to find a matching legacy WebSocket server
        for (const [serverName, server] of Object.entries(global.wsServers)) {
          if (serverName.toLowerCase().includes(socketType.toLowerCase()) ||
              (server.name && server.name.toLowerCase().includes(socketType.toLowerCase()))) {
            targetServer = server;
            system = 'legacy';
            break;
          }
        }
      } else if (system === 'legacy' && global.wsServersV69 && Object.keys(global.wsServersV69).length > 0) {
        // Try to find a matching V69 WebSocket server
        for (const [serverName, server] of Object.entries(global.wsServersV69)) {
          if (serverName.toLowerCase().includes(socketType.toLowerCase()) ||
              (server.name && server.name.toLowerCase().includes(socketType.toLowerCase()))) {
            targetServer = server;
            system = 'v69';
            break;
          }
        }
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
    
    // Look up the WebSocket service status
    let serviceStatus = 'unknown';
    let isAvailable = false;
    let system = 'legacy';
    
    // Check if the endpoint includes a system prefix
    const isV69 = endpoint.toLowerCase().startsWith('/api/v69/') || 
                 endpoint.toLowerCase().includes('v69');
    if (isV69) {
      system = 'v69';
    }
    
    // Check if we can find this endpoint in our WebSocket services
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Find a WebSocket server that might handle this endpoint
      const wsMonitor = global.wsServers['monitor'];
      if (wsMonitor) {
        const services = wsMonitor.monitorService?.getServiceMetrics() || [];
        
        // Find matching service
        const matchingService = services.find(service => 
          service.name && 
          endpoint.toLowerCase().includes(service.name.toLowerCase().replace(' websocket', '')) &&
          (!service.system || service.system === system)
        );
        
        if (matchingService) {
          serviceStatus = matchingService.status;
          isAvailable = serviceStatus === 'operational';
        }
      }
    }
    
    // If not found and this is a v69 endpoint, check directly in v69 WebSockets
    if (!isAvailable && system === 'v69' && global.wsServersV69) {
      for (const [name, server] of Object.entries(global.wsServersV69)) {
        if (server && server.path && 
            (endpoint.includes(server.path) || 
             name.toLowerCase() === endpoint.toLowerCase().replace(/^\/api\/v69\/ws\//, ''))) {
          serviceStatus = server.isInitialized ? 'operational' : 'initializing';
          isAvailable = server.isInitialized;
          break;
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
    
    // Get list of WebSocket servers
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      for (const [serverName, server] of Object.entries(global.wsServers)) {
        if (server && server.path) {
          endpoints.push({
            name: server.name || serverName,
            type: serverName,
            path: server.path,
            status: server.isInitialized ? 'operational' : 'initializing',
            clients: server.getConnectionsCount ? server.getConnectionsCount() : 0,
            requiresAuth: server.requireAuth || false,
            system: 'legacy'
          });
        }
      }
    }
    
    // Get list of V69 WebSocket servers
    if (global.wsServersV69 && Object.keys(global.wsServersV69).length > 0) {
      for (const [serverName, server] of Object.entries(global.wsServersV69)) {
        if (server && server.path) {
          endpoints.push({
            name: `V69 ${server.name || serverName}`,
            type: serverName,
            path: server.path,
            status: server.isInitialized ? 'operational' : 'initializing',
            clients: server.getConnectionsCount ? server.getConnectionsCount() : 0,
            requiresAuth: server.requireAuth || false,
            system: 'v69'
          });
        }
      }
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
    
    // Get error counts by source if available
    let errorCounts = {};
    if (global.wsServersV69?.monitor && typeof global.wsServersV69.monitor._getErrorCountsBySource === 'function') {
      errorCounts = global.wsServersV69.monitor._getErrorCountsBySource();
    }
    
    return res.json({
      success: true,
      errors,
      counts: {
        total: global.wsServersV69?.monitor?.errorsCache?.length || 0,
        filtered: errors.length,
        bySource: errorCounts
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