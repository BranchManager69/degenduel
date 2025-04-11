// Test WS Broadcaster logging fixes
import broadcaster from './utils/websocket-suite/ws-broadcaster.js';
import { logApi } from './utils/logger-suite/logger.js';

// Set up a mock unified WebSocket
import config from './config/config.js';

// Mock a simple WS server
config.websocket = {
  unifiedWebSocket: {
    authenticatedClients: new Map(),
    topicSubscribers: new Map(),
    send: (client, message) => {
      console.log(`Would send message to client: ${message.action}`);
      return true;
    },
    broadcastToRole: (role, message) => {
      console.log(`Broadcasting to role ${role}: ${message.action}`);
      return 0; // No clients connected
    }
  }
};

// Test broadcasting
async function runTest() {
  try {
    console.log('Testing role broadcast:');
    await broadcaster.broadcastToRole('ADMIN', 'ai_analysis', 'new_service_log_analysis', { message: 'Test message' });
    
    console.log('\nTesting topic broadcast:');
    await broadcaster.broadcastToTopic('admin', 'test', 'sample_action', { data: 'Test data' });
    
    console.log('\nDone - check logs for proper formatting');
  } catch (error) {
    console.error('Test error:', error);
  }
}

runTest();