/**
 * Re-exporting the unified WebSocket system
 * This file ensures backward compatibility while organizing the new implementation
 */

import { 
    createUnifiedWebSocket, 
    UnifiedWebSocketServer, 
    messageTypes, 
    topics 
} from './unified';

export {
    createUnifiedWebSocket,
    UnifiedWebSocketServer,
    messageTypes,
    topics
};