/**
 * WebSocketManager.jsx
 * 
 * Central WebSocket management component that:
 * - Handles authentication
 * - Maintains connections to multiple WebSocket endpoints
 * - Provides connection status monitoring
 * - Ensures reliable reconnection
 */

import React, { useState, useEffect, useContext, createContext } from 'react';
import { useWebSocket } from './useWebSocket';
import { useAuth } from './useAuth'; // Import your auth hook

// Create context for WebSocket connections
const WebSocketContext = createContext(null);

// WebSocket endpoints to connect to
const WEBSOCKET_ENDPOINTS = {
  monitor: 'monitor',
  tokenData: 'token-data',
  market: 'market-data',
  circuit: 'circuit-breaker',
  contest: 'contest',
  notifications: 'notifications'
};

/**
 * WebSocket Provider component
 * Sets up and manages all WebSocket connections
 */
export const WebSocketProvider = ({ children }) => {
  const { token, isAuthenticated } = useAuth();
  const [connections, setConnections] = useState({});
  
  // Create a WebSocket connection for the monitor endpoint
  const monitorWs = useWebSocket(WEBSOCKET_ENDPOINTS.monitor, {
    token,
    reconnect: true,
    maxReconnectAttempts: 15,
    debug: true,
    onConnect: () => console.log('Monitor WebSocket connected'),
    onDisconnect: () => console.log('Monitor WebSocket disconnected')
  });
  
  // Create a WebSocket connection for the token data endpoint
  const tokenDataWs = useWebSocket(WEBSOCKET_ENDPOINTS.tokenData, {
    token, 
    reconnect: true,
    maxReconnectAttempts: 15,
    debug: true,
    onConnect: () => console.log('Token Data WebSocket connected'),
    onDisconnect: () => console.log('Token Data WebSocket disconnected')
  });
  
  // Track all connections for monitoring
  useEffect(() => {
    // Update connections status for monitoring
    setConnections({
      total: Object.values(WEBSOCKET_ENDPOINTS).length,
      monitor: monitorWs.isConnected,
      tokenData: tokenDataWs.isConnected,
      market: false, // Add other connections as needed
      portfolio: false,
      contest: false,
      circuit: false,
      achievements: false
    });
    
    // Log connection status changes
    console.log('[WebSocketManager] WebSocket Connections:', connections);
  }, [
    monitorWs.isConnected,
    tokenDataWs.isConnected
  ]);
  
  // Provide WebSocket connections to children
  const wsContextValue = {
    // WebSocket connections
    monitor: monitorWs,
    tokenData: tokenDataWs,
    
    // Connection status
    isConnected: {
      monitor: monitorWs.isConnected,
      tokenData: tokenDataWs.isConnected
    },
    
    // Overall status
    connections,
    
    // Helper function to reconnect all sockets
    reconnectAll: () => {
      monitorWs.connect();
      tokenDataWs.connect();
      // Add other connections as needed
    }
  };
  
  return (
    <WebSocketContext.Provider value={wsContextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

/**
 * Hook to use WebSocket connections from any component
 */
export const useWebSocketManager = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocketManager must be used within a WebSocketProvider');
  }
  return context;
};

export default WebSocketContext;