import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import fetch from 'node-fetch';

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
    
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Try to find a matching WebSocket server
      for (const [serverName, server] of Object.entries(global.wsServers)) {
        if (serverName.toLowerCase().includes(socketType.toLowerCase()) ||
            (server.name && server.name.toLowerCase().includes(socketType.toLowerCase()))) {
          targetServer = server;
          break;
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
          
          logApi.info(`[WebSocket Test] Admin ${req.user.username} sent ${messageType} to ${socketType}:`, payload);
        } catch (broadcastError) {
          logApi.error(`[WebSocket Test] Error broadcasting to ${socketType}:`, broadcastError);
        }
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
    
    // Check if we can find this endpoint in our WebSocket services
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Find a WebSocket server that might handle this endpoint
      const wsMonitor = global.wsServers['monitor'];
      if (wsMonitor) {
        const services = wsMonitor.monitorService?.getServiceMetrics() || [];
        
        // Find matching service
        const matchingService = services.find(service => 
          service.name && endpoint.toLowerCase().includes(service.name.toLowerCase().replace(' websocket', ''))
        );
        
        if (matchingService) {
          serviceStatus = matchingService.status;
          isAvailable = serviceStatus === 'operational';
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
            requiresAuth: server.requireAuth || false
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
 * Check if a WebSocket endpoint is available
 */
async function checkEndpointAvailability(wsUrl, endpoint, socketType) {
  try {
    // Remove websocket protocol prefix for HTTP checks
    const httpUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
    
    // For dynamic endpoints with path parameters (like :contestId), replace with a test value
    const processedEndpoint = endpoint.replace(/:(\w+)/g, '123');
    
    // Check if the WebSocket server exists by checking the monitor server
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      // Access the WebSocket metrics from the monitor service
      const wsMonitor = global.wsServers['monitor'];
      if (wsMonitor) {
        const services = wsMonitor.monitorService?.getServiceMetrics() || [];
        
        // Look for a matching service in the metrics
        const matchingService = services.find(service => 
          service.name && 
          (service.name.toLowerCase().includes(socketType?.toLowerCase() || '') ||
           processedEndpoint.toLowerCase().includes(service.name.toLowerCase().replace(' websocket', '')))
        );
        
        if (matchingService) {
          return matchingService.status === 'operational';
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