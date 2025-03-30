import prisma from '../config/prisma.js';
import express from 'express';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import fetch from 'node-fetch';
import path from 'path';
import { fileURLToPath } from 'url';

// Import route modules
import serviceConfigRoutes from './admin/service-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Mount the service configuration routes
router.use('/admin/service-config', serviceConfigRoutes);

/**
 * Check a WebSocket endpoint's availability
 */
router.post('/api/admin/websocket/status', async (req, res) => {
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
    const isAvailable = await checkEndpointAvailability(url, endpoint);
    
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
router.post('/api/admin/websocket/test', async (req, res) => {
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
router.get('/api/admin/websocket/healthcheck', (req, res) => {
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

/**
 * WebSocket System Settings Test Page
 * Provides a simple HTML interface for testing WebSocket connections
 * and diagnosing header issues.
 */
router.get('/admin/websocket/test/system-settings', (req, res) => {
  try {
    // Serve the WebSocket test page
    res.sendFile(path.join(path.dirname(__dirname), 'public', 'system-settings-ws-test.html'));
    
    // Log access to the test page
    logApi.info(`[WebSocket Test] Admin accessed system settings WebSocket test page from ${req.ip}`);
  } catch (error) {
    logApi.error('[WebSocket Test] Error serving test page:', error);
    res.status(500).send('Error serving test page');
  }
});

/**
 * General WebSocket Test Page - No authentication required
 * Provides a simple HTML interface for testing all WebSocket endpoints.
 */
router.get('/admin/websocket/test', (req, res) => {
  try {
    // Serve the WebSocket test page
    res.sendFile(path.join(path.dirname(__dirname), 'public', 'test-ws.html'));
    
    // Log access to the test page
    logApi.info(`[WebSocket Test] User accessed general WebSocket test page from ${req.ip}`);
  } catch (error) {
    logApi.error('[WebSocket Test] Error serving test page:', error);
    res.status(500).send('Error serving test page');
  }
});

/**
 * WebSocket Test API - get the list of available WebSocket endpoints
 */
router.get('/api/admin/websocket/test/endpoints', (req, res) => {
  try {
    // Get list of available WebSocket endpoints from global.wsServers
    const endpoints = [];
    
    if (global.wsServers && Object.keys(global.wsServers).length > 0) {
      for (const [name, server] of Object.entries(global.wsServers)) {
        if (server && server.path) {
          endpoints.push({
            name: name,
            path: server.path,
            requireAuth: !!server.requireAuth,
            publicPath: server.publicEndpoints && server.publicEndpoints.length > 0 
              ? server.publicEndpoints[0] 
              : server.path
          });
        }
      }
    }
    
    return res.json({
      success: true,
      endpoints: endpoints,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logApi.error('[WebSocket Endpoints] Error:', error);
    return res.status(500).json({
      success: false, 
      error: 'Failed to retrieve WebSocket endpoints'
    });
  }
});

export default router;