/**
 * @file Complete example setup for realtime suite
 * @description How to set up the realtime suite in your application
 */

import prisma from '../../config/prisma.js';
import realtime from './index.js';
import { setupPrismaRealtimeHooks } from './integration/prisma-hooks.js';
import { integrateWithWebSocketServer } from './integration/websocket-server.js';
import { createTokenRefreshQueue, createTokenRefreshWorker, shutdownBullMQInstances } from './integration/bull-queue.js';
import { TOKEN_CHANNELS, SYSTEM_CHANNELS, SERVICE_CHANNELS } from './channels.js';
import { logApi } from '../logger-suite/logger.js';

// Import your actual dependencies
// import { UnifiedWebSocketServer } from '../../websocket/v69/unified/UnifiedWebSocketServer.js';
// import { refreshTokenData } from '../../services/token-enrichment/tokenEnrichmentService.js';

/**
 * Initialize the realtime system in the application
 */
export async function initializeRealtimeSystem() {
  try {
    // 1. Set up Prisma middleware hooks for automatic event publishing
    setupPrismaRealtimeHooks(prisma);
    
    // 2. Set up WebSocket integration
    // const wsServer = UnifiedWebSocketServer.getInstance();
    // const wsCleanup = await integrateWithWebSocketServer(wsServer);
    
    // 3. Set up background job queues with BullMQ
    // const tokenRefreshQueue = createTokenRefreshQueue();
    // const tokenRefreshWorker = createTokenRefreshWorker(refreshTokenData);
    
    // 4. Listen for system events
    await realtime.subscribe(SYSTEM_CHANNELS.HEARTBEAT, (data) => {
      logApi.debug(`System heartbeat received from ${data.instance} at ${new Date(data.timestamp).toISOString()}`);
    });
    
    // 5. Publish system startup event
    await realtime.publish(SYSTEM_CHANNELS.STATUS, {
      status: 'online',
      component: 'api-server',
      message: 'System initialized',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
    
    logApi.info('🔄 Realtime system initialized successfully');
    
    // 6. Set up graceful shutdown
    const cleanupRealtime = async () => {
      try {
        // Stop background job processing
        // await shutdownBullMQInstances([tokenRefreshQueue, tokenRefreshWorker]);
        
        // Clean up WebSocket integration
        // await wsCleanup();
        
        // Publish shutdown event
        await realtime.publish(SYSTEM_CHANNELS.STATUS, {
          status: 'offline',
          component: 'api-server',
          message: 'System shutting down',
          timestamp: Date.now()
        });
        
        // Wait a moment for final messages to be delivered
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Shutdown realtime manager
        await realtime.shutdown();
        
        logApi.info('🔄 Realtime system shutdown complete');
      } catch (err) {
        logApi.error('Error during realtime system shutdown:', err);
      }
    };
    
    // Return the cleanup function for use in app shutdown
    return cleanupRealtime;
  } catch (err) {
    logApi.error('Failed to initialize realtime system:', err);
    throw err;
  }
}

/**
 * Example of how to use in your main application
 */
async function exampleAppStartup() {
  // Early in your app startup
  const cleanupRealtime = await initializeRealtimeSystem();
  
  // Store for graceful shutdown
  const cleanup = async () => {
    await cleanupRealtime();
    // Other cleanup...
  };
  
  // Set up process signal handlers
  process.on('SIGTERM', async () => {
    logApi.info('SIGTERM received, shutting down gracefully');
    await cleanup();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    logApi.info('SIGINT received, shutting down gracefully');
    await cleanup();
    process.exit(0);
  });
}

// Don't actually run this code - it's just an example
// exampleAppStartup().catch(console.error);