/**
 * Enhanced WebSocket hook for DegenDuel
 * 
 * This hook provides a reliable connection mechanism that:
 * 1. Uses query parameters for authentication (works across all browsers)
 * 2. Handles reconnection gracefully
 * 3. Provides detailed logging for debugging
 * 4. Properly manages connection state
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Custom WebSocket hook with enhanced reliability
 * @param {string} endpoint - WebSocket endpoint path (e.g. 'monitor', 'token-data')
 * @param {Object} options - Configuration options
 * @param {string} options.token - JWT token for authentication
 * @param {boolean} options.autoConnect - Whether to connect automatically (default: true)
 * @param {boolean} options.reconnect - Whether to reconnect on disconnect (default: true)
 * @param {number} options.maxReconnectAttempts - Maximum reconnect attempts (default: 10)
 * @param {number} options.reconnectInterval - Base interval for reconnect in ms (default: 1000)
 * @param {number} options.maxReconnectInterval - Maximum reconnect interval in ms (default: 30000)
 * @param {Function} options.onMessage - Message handler (optional)
 * @param {Function} options.onConnect - Connect handler (optional)
 * @param {Function} options.onDisconnect - Disconnect handler (optional)
 * @param {Function} options.onError - Error handler (optional)
 * @returns {Object} WebSocket state and control functions
 */
export const useWebSocket = (endpoint, options = {}) => {
  // Extract options with defaults
  const {
    token,
    autoConnect = true,
    reconnect = true,
    maxReconnectAttempts = 10,
    reconnectInterval = 1000,
    maxReconnectInterval = 30000,
    debug = false,
    onMessage,
    onConnect,
    onDisconnect,
    onError
  } = options;

  // State
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs to hold current state in callbacks
  const socketRef = useRef(null);
  const reconnectTimer = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  /**
   * Log messages for debugging
   * @param {string} message - The message to log
   * @param {string} type - Log type (connection, message, error)
   */
  const log = useCallback((message, type = 'info', data = {}) => {
    // Always log errors
    const shouldLog = debug || type === 'error';
    
    if (shouldLog) {
      console.log(`[WebSocket:${endpoint}] [${type.toUpperCase()}] ${message}`, data);
    }
  }, [debug, endpoint]);

  /**
   * Calculate exponential backoff time for reconnection
   * @returns {number} - Time to wait in milliseconds
   */
  const getBackoffTime = useCallback(() => {
    // Implement exponential backoff with jitter
    const maxExponent = Math.min(reconnectAttemptsRef.current, 10); // Cap at 2^10
    const baseTime = reconnectInterval * Math.pow(1.5, maxExponent);
    const jitter = 0.2 * baseTime * Math.random(); // Add 0-20% jitter
    return Math.min(baseTime + jitter, maxReconnectInterval);
  }, [reconnectInterval, maxReconnectInterval]);

  /**
   * Connect to the WebSocket server
   */
  const connect = useCallback(() => {
    // Clean up any existing connection
    if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
      log('Closing existing connection before reconnecting', 'connection');
      socketRef.current.close();
    }

    // Clear any pending reconnect timers
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    // Start connecting
    setIsConnecting(true);
    setError(null);

    try {
      // Construct WebSocket URL with proper token authentication via query param
      const apiUrl = window.location.origin.replace('http', 'ws');
      let wsUrl = `${apiUrl}/api/v69/ws/${endpoint}`;
      
      // IMPORTANT: Add token as query parameter for most reliable authentication
      if (token) {
        // Use encodeURIComponent to safely handle token values
        wsUrl += `?token=${encodeURIComponent(token)}`;
      }
      
      // Log the connection URL (without full token for security)
      const logUrl = token 
        ? `${wsUrl.substring(0, wsUrl.indexOf('?token=') + 7)}...` 
        : wsUrl;
      log(`Creating connection to ${logUrl}`, 'connection');
      
      // For dev environments, include the dev access token in the URL
      // We can't use headers directly with WebSocket API
      if (window.location.hostname.includes('dev.')) {
        const devAccessToken = localStorage.getItem('devAccessToken') || 'e8c863e6222ca385db44bd5f68925c6159c393c6f8a349955eb4e77892470970';
        wsUrl += wsUrl.includes('?') ? '&' : '?';
        wsUrl += `devAccess=${encodeURIComponent(devAccessToken)}`;
      }
      
      // Create the WebSocket connection
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;
      setSocket(ws);

      // Set up event handlers
      ws.onopen = () => {
        log(`Connection opened`, 'connection');
        setIsConnected(true);
        setIsConnecting(false);
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);
        
        // Call user-provided callback
        if (onConnect) onConnect();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle error messages from server
          if (data.type === 'error') {
            log(`Error from server: ${data.message} (${data.code})`, 'error', data);
            setError(data);
            // Call user-provided error handler
            if (onError) onError(data);
          } 
          // Handle all other messages
          else {
            // Only log non-heartbeat messages to reduce noise
            if (data.type !== 'heartbeat' && data.type !== 'heartbeat_ack') {
              log(`Received: ${data.type}`, 'message', data);
            }
            
            // Call user-provided message handler
            if (onMessage) onMessage(data);
          }
        } catch (parseError) {
          log(`Failed to parse message: ${parseError.message}`, 'error', {
            rawData: event.data,
            error: parseError
          });
        }
      };

      ws.onclose = (event) => {
        // Clean up the reference
        socketRef.current = null;
        setIsConnected(false);
        setIsConnecting(false);

        // Log closure with code and reason
        log(`Closed [Code: ${event.code}] [Reason: ${event.reason || 'No reason provided'}]`, 'close', {
          code: event.code,
          reason: event.reason
        });
        
        // Call user-provided callback
        if (onDisconnect) onDisconnect(event);

        // Handle reconnection for abnormal closures
        const isAbnormalClosure = event.code === 1006;
        if (reconnect && (isAbnormalClosure || event.code >= 1001 && event.code <= 1015)) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            const backoffTime = getBackoffTime();
            reconnectAttemptsRef.current++;
            setReconnectAttempts(reconnectAttemptsRef.current);
            
            log(`reconnect attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts} in ${Math.round(backoffTime)}ms`, 'reconnect');
            
            // Schedule reconnection
            reconnectTimer.current = setTimeout(() => {
              log(`Attempting reconnection...`, 'reconnect');
              connect();
            }, backoffTime);
          } else {
            log(`Maximum reconnect attempts (${maxReconnectAttempts}) reached`, 'error');
            setError(new Error(`Maximum reconnect attempts (${maxReconnectAttempts}) reached`));
          }
        }
      };

      ws.onerror = (event) => {
        log(`Error: ${event}`, 'error', event);
        setError(event);
        
        // Call user-provided callback
        if (onError) onError(event);
      };
    } catch (error) {
      log(`Connection error: ${error.message}`, 'error', error);
      setError(error);
      setIsConnecting(false);
      
      // Call user-provided callback
      if (onError) onError(error);
    }
  }, [endpoint, token, reconnect, maxReconnectAttempts, getBackoffTime, log, onConnect, onDisconnect, onMessage, onError]);

  /**
   * Disconnect from the WebSocket server
   */
  const disconnect = useCallback(() => {
    log('Manually disconnecting', 'connection');
    
    // Clear any pending reconnect timers
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    
    // Close the connection if it exists
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close(1000, 'Manual disconnection');
      }
      socketRef.current = null;
      setSocket(null);
    }
    
    setIsConnected(false);
    setIsConnecting(false);
  }, [log]);

  /**
   * Send a message to the WebSocket server
   * @param {object|string} message - The message to send
   */
  const sendMessage = useCallback((message) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      log('Cannot send message: socket not connected', 'error');
      return false;
    }

    try {
      const messageString = typeof message === 'string' ? message : JSON.stringify(message);
      socketRef.current.send(messageString);
      log(`Sent: ${typeof message === 'string' ? message : message.type}`, 'message', message);
      return true;
    } catch (error) {
      log(`Failed to send message: ${error.message}`, 'error', {
        message,
        error
      });
      return false;
    }
  }, [log]);
  
  /**
   * Subscribe to a WebSocket channel
   * @param {string} channel - The channel name to subscribe to
   */
  const subscribe = useCallback((channel) => {
    return sendMessage({
      type: 'subscribe',
      channel
    });
  }, [sendMessage]);
  
  /**
   * Unsubscribe from a WebSocket channel
   * @param {string} channel - The channel to unsubscribe from
   */
  const unsubscribe = useCallback((channel) => {
    return sendMessage({
      type: 'unsubscribe',
      channel
    });
  }, [sendMessage]);

  // Connect automatically when component mounts if autoConnect is true
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Clean up on unmount
    return () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      
      if (socketRef.current) {
        socketRef.current.close(1000, 'Component unmounted');
      }
    };
  }, [autoConnect, connect]);

  // Return WebSocket state and control functions
  return {
    socket,
    isConnected,
    isConnecting,
    error,
    reconnectAttempts,
    connect,
    disconnect,
    sendMessage,
    subscribe,
    unsubscribe
  };
};

export default useWebSocket;