// _WEBSOCKET_API_GUIDE.jsx
// This is a React component that serves as both documentation and a demo for the WebSocket API
// Import this component into your React application to test and understand the WebSocket API

import React, { useState, useEffect, useRef } from 'react';

// You can replace this with your actual authentication token handling
const useAuthToken = () => {
  // This is just a placeholder - replace with your actual auth token management
  return localStorage.getItem('auth_token') || '';
};

// WebSocket API Guide component
const WebSocketAPIGuide = () => {
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [messages, setMessages] = useState([]);
  const [tokens, setTokens] = useState({});
  const [topicSubscriptions, setTopicSubscriptions] = useState({
    'market-data': true,
    'portfolio': false,
    'system': true,
    'contest': false,
    'user': false,
    'admin': false,
    'wallet': false,
    'wallet-balance': false,
    'skyduel': false
  });
  const [manualMessage, setManualMessage] = useState(
`{
  "type": "REQUEST",
  "topic": "market-data",
  "action": "getToken",
  "symbol": "BTC"
}`);
  
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const authToken = useAuthToken();
  
  // Connection URL
  const socketUrl = process.env.NODE_ENV === 'production' 
    ? 'wss://degenduel.me/api/v69/ws'
    : `ws://${window.location.hostname}:${window.location.port}/api/v69/ws`;
  
  // Message types constants
  const MESSAGE_TYPES = {
    SUBSCRIBE: 'SUBSCRIBE',
    UNSUBSCRIBE: 'UNSUBSCRIBE',
    REQUEST: 'REQUEST',
    COMMAND: 'COMMAND',
    DATA: 'DATA',
    ERROR: 'ERROR',
    SYSTEM: 'SYSTEM',
    ACKNOWLEDGMENT: 'ACKNOWLEDGMENT'
  };
  
  // Scroll to bottom of message list on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  
  // Connect to WebSocket
  const connect = () => {
    if (socketRef.current) {
      addMessage('Already connected', 'outgoing', 'error');
      return;
    }
    
    try {
      setConnectionStatus('connecting');
      addMessage(`Connecting to ${socketUrl}...`, 'outgoing');
      
      socketRef.current = new WebSocket(socketUrl);
      
      socketRef.current.onopen = handleOpen;
      socketRef.current.onmessage = handleMessage;
      socketRef.current.onclose = handleClose;
      socketRef.current.onerror = handleError;
    } catch (error) {
      addMessage(`Connection error: ${error.message}`, 'outgoing', 'error');
      setConnectionStatus('error');
    }
  };
  
  // Disconnect from WebSocket
  const disconnect = () => {
    if (!socketRef.current) {
      addMessage('Not connected', 'outgoing', 'error');
      return;
    }
    
    try {
      socketRef.current.close(1000, 'User disconnected');
      addMessage('Disconnecting...', 'outgoing');
    } catch (error) {
      addMessage(`Disconnect error: ${error.message}`, 'outgoing', 'error');
    }
  };
  
  // Handle WebSocket open event
  const handleOpen = () => {
    setConnectionStatus('connected');
    setConnected(true);
    addMessage('Connected to server', 'incoming');
  };
  
  // Handle WebSocket message event
  const handleMessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      
      // Format the message for display
      const formattedMessage = JSON.stringify(message, null, 2);
      
      // Add the message to the list
      const topicClass = message.topic ? `topic-${message.topic}` : '';
      addMessage(formattedMessage, 'incoming', topicClass);
      
      // Process token data if present
      if (message.type === MESSAGE_TYPES.DATA && message.topic === 'market-data') {
        processTokenData(message);
      }
    } catch (error) {
      addMessage(`Parse error: ${error.message}. Raw data: ${event.data}`, 'incoming', 'error');
    }
  };
  
  // Handle WebSocket close event
  const handleClose = (event) => {
    setConnectionStatus('disconnected');
    setConnected(false);
    addMessage(`Disconnected from server: ${event.code} ${event.reason}`, 'incoming');
    socketRef.current = null;
  };
  
  // Handle WebSocket error event
  const handleError = (error) => {
    setConnectionStatus('error');
    addMessage(`WebSocket error: ${error.message || 'Unknown error'}`, 'incoming', 'error');
  };
  
  // Add message to message list
  const addMessage = (content, direction, className = '') => {
    const now = new Date();
    const timestamp = now.toTimeString().split(' ')[0];
    
    // Try to identify message type
    let messageType = 'Unknown';
    let topicName = null;
    
    if (typeof content === 'string' && content.includes('"type":')) {
      try {
        const parsed = JSON.parse(content);
        messageType = parsed.type || 'Unknown';
        topicName = parsed.topic || null;
      } catch (e) {
        // Just a fallback
        messageType = content.includes('"type":"') 
          ? content.split('"type":"')[1].split('"')[0] 
          : 'Unknown';
      }
    }
    
    const newMessage = {
      id: Date.now(),
      content,
      direction,
      className,
      timestamp,
      messageType,
      topicName
    };
    
    setMessages(prev => [...prev, newMessage]);
  };
  
  // Process token data message
  const processTokenData = (message) => {
    try {
      if (Array.isArray(message.data)) {
        // Bulk update (initial data)
        const newTokens = { ...tokens };
        message.data.forEach(token => {
          newTokens[token.symbol] = token;
        });
        setTokens(newTokens);
      } else if (message.data && message.data.symbol) {
        // Single token update
        setTokens(prev => ({
          ...prev,
          [message.data.symbol]: message.data
        }));
      }
    } catch (error) {
      console.error('Error processing token data:', error);
    }
  };
  
  // Send message to WebSocket server
  const sendMessage = (message) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      addMessage('Not connected to server', 'outgoing', 'error');
      return;
    }
    
    try {
      const messageString = JSON.stringify(message);
      socketRef.current.send(messageString);
      addMessage(messageString, 'outgoing');
    } catch (error) {
      addMessage(`Send error: ${error.message}`, 'outgoing', 'error');
    }
  };
  
  // Subscribe to selected topics
  const subscribeToTopics = () => {
    const selectedTopics = Object.entries(topicSubscriptions)
      .filter(([_, isSelected]) => isSelected)
      .map(([topic]) => topic);
      
    if (selectedTopics.length === 0) {
      addMessage('No topics selected', 'outgoing', 'error');
      return;
    }
    
    const message = {
      type: MESSAGE_TYPES.SUBSCRIBE,
      topics: selectedTopics,
    };
    
    // Add auth token if provided and needed
    const restrictedTopics = ['portfolio', 'user', 'admin', 'wallet', 'wallet-balance'];
    const hasRestrictedTopic = selectedTopics.some(topic => restrictedTopics.includes(topic));
    
    if (hasRestrictedTopic && authToken) {
      message.authToken = authToken;
    }
    
    sendMessage(message);
  };
  
  // Unsubscribe from selected topics
  const unsubscribeFromTopics = () => {
    const selectedTopics = Object.entries(topicSubscriptions)
      .filter(([_, isSelected]) => isSelected)
      .map(([topic]) => topic);
      
    if (selectedTopics.length === 0) {
      addMessage('No topics selected', 'outgoing', 'error');
      return;
    }
    
    sendMessage({
      type: MESSAGE_TYPES.UNSUBSCRIBE,
      topics: selectedTopics
    });
  };
  
  // Send manual message
  const sendManualMessage = () => {
    try {
      const message = JSON.parse(manualMessage);
      sendMessage(message);
    } catch (error) {
      addMessage(`Error parsing JSON: ${error.message}`, 'outgoing', 'error');
    }
  };
  
  // Clear messages
  const clearMessages = () => {
    setMessages([]);
  };
  
  // Handle topic checkbox change
  const handleTopicChange = (topic) => {
    setTopicSubscriptions(prev => ({
      ...prev,
      [topic]: !prev[topic]
    }));
  };
  
  // Render token list
  const renderTokenList = () => {
    const sortedTokens = Object.values(tokens).sort((a, b) => 
      a.symbol.localeCompare(b.symbol)
    );
    
    return (
      <div className="token-list">
        {sortedTokens.map(token => (
          <div key={token.symbol} className="token-item">
            <div className="token-symbol">{token.symbol}</div>
            <div className="token-price">
              ${typeof token.price === 'number' 
                ? token.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : 'N/A'}
            </div>
            <div className={`token-change ${(token.change24h || 0) >= 0 ? 'positive' : 'negative'}`}>
              {token.change24h 
                ? `${token.change24h >= 0 ? '+' : ''}${token.change24h.toFixed(2)}%` 
                : 'N/A'}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="websocket-guide">
      <h1>DegenDuel WebSocket API Guide</h1>
      
      <div className="container">
        {/* Control Panel */}
        <div className="panel controls">
          <h2>Connection Controls</h2>
          <div className="form-group">
            <label>Status:</label>
            <span className={`status-${connectionStatus}`}>
              {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </span>
          </div>
          
          <div className="button-group">
            <button 
              className="connect-button" 
              onClick={connect}
              disabled={connected}>
              Connect
            </button>
            <button 
              className="disconnect-button" 
              onClick={disconnect}
              disabled={!connected}>
              Disconnect
            </button>
          </div>
          
          <h3>Topic Subscriptions</h3>
          <div className="checkbox-container">
            {Object.entries(topicSubscriptions).map(([topic, isChecked]) => (
              <div key={topic} className="checkbox-item">
                <input
                  type="checkbox"
                  id={`topic-${topic}`}
                  checked={isChecked}
                  onChange={() => handleTopicChange(topic)}
                />
                <label htmlFor={`topic-${topic}`}>{topic}</label>
              </div>
            ))}
          </div>
          
          <div className="button-group">
            <button 
              className="subscribe-button" 
              onClick={subscribeToTopics}
              disabled={!connected}>
              Subscribe
            </button>
            <button 
              className="unsubscribe-button" 
              onClick={unsubscribeFromTopics}
              disabled={!connected}>
              Unsubscribe
            </button>
          </div>
          
          <h3>Manual Commands</h3>
          <div className="form-group">
            <label>Custom Message JSON:</label>
            <textarea
              value={manualMessage}
              onChange={(e) => setManualMessage(e.target.value)}
              rows={6}
              className="message-input"
            />
          </div>
          <button 
            className="send-button" 
            onClick={sendManualMessage}
            disabled={!connected}>
            Send Message
          </button>
        </div>
        
        {/* Message Panel */}
        <div className="panel messages">
          <h2>WebSocket Messages</h2>
          <button 
            className="clear-button" 
            onClick={clearMessages}>
            Clear Messages
          </button>
          <div className="message-list">
            {messages.map(message => (
              <div 
                key={message.id} 
                className={`message message-${message.direction} ${message.className}`}>
                <div className="timestamp">{message.timestamp}</div>
                
                {message.topicName && (
                  <span className={`topic-label topic-${message.topicName}`}>
                    {message.topicName}
                  </span>
                )}
                
                <div className="message-type">{message.messageType}</div>
                <pre className="message-content">{message.content}</pre>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        {/* Data Display Panel */}
        <div className="panel data-display">
          <h2>Token Data</h2>
          <div className="token-count">
            {Object.keys(tokens).length > 0 
              ? `${Object.keys(tokens).length} tokens received` 
              : 'No tokens received'}
          </div>
          {renderTokenList()}
        </div>
      </div>
      
      {/* Documentation Section */}
      <div className="documentation">
        <h2>WebSocket API Documentation</h2>
        
        <h3>Connection Information</h3>
        <p><strong>Endpoint:</strong> /api/v69/ws</p>
        <p>This WebSocket API provides real-time data from the DegenDuel platform through a unified WebSocket implementation with topic-based subscriptions.</p>
        
        <h3>Available Topics</h3>
        <table className="topics-table">
          <thead>
            <tr>
              <th>Topic</th>
              <th>Description</th>
              <th>Auth Required</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>market-data</td>
              <td>Real-time market data including token prices and stats</td>
              <td>No</td>
            </tr>
            <tr>
              <td>portfolio</td>
              <td>User's portfolio updates and performance</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>system</td>
              <td>System status, announcements and heartbeats</td>
              <td>No</td>
            </tr>
            <tr>
              <td>contest</td>
              <td>Contest updates, entries and results</td>
              <td>No (public), Yes (personal)</td>
            </tr>
            <tr>
              <td>user</td>
              <td>User-specific notifications and data</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>admin</td>
              <td>Administrative information</td>
              <td>Yes (admin role)</td>
            </tr>
            <tr>
              <td>wallet</td>
              <td>Wallet updates and transaction information</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>wallet-balance</td>
              <td>Real-time balance updates</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>skyduel</td>
              <td>Game-specific information</td>
              <td>No (public), Yes (personal)</td>
            </tr>
          </tbody>
        </table>

        <h3>Authentication Methods</h3>
        <p>DegenDuel supports multiple authentication methods that all work with the WebSocket API:</p>
        
        <h4>1. Session Cookie Authentication</h4>
        <p>This is the default method where the JWT token is stored in a secure HTTP-only cookie named <code>session</code>. The WebSocket connection will automatically use this cookie for authentication.</p>
        
        <h4>2. Manual Token Authentication</h4>
        <p>Include an authToken in your subscription message for topics that require authentication:</p>
        <div className="code-example">
          <pre>{`{
  "type": "SUBSCRIBE",
  "topics": ["portfolio", "user"],
  "authToken": "your-jwt-token"
}`}</pre>
        </div>
        
        <h4>3. Biometric Authentication</h4>
        <p>DegenDuel now supports WebAuthn for Face ID, Touch ID, and other FIDO2 compliant biometric authentication methods. The flow is:</p>
        <ol>
          <li>Register a biometric credential:
            <ul>
              <li><code>POST /api/auth/biometric/register-options</code></li>
              <li><code>POST /api/auth/biometric/register-verify</code></li>
            </ul>
          </li>
          <li>Authenticate using the biometric credential:
            <ul>
              <li><code>POST /api/auth/biometric/auth-options</code></li>
              <li><code>POST /api/auth/biometric/auth-verify</code></li>
            </ul>
          </li>
        </ol>
        <p>After successful biometric authentication, a JWT token is stored in the session cookie, which the WebSocket connection can use.</p>
        
        <h4>4. Device Authentication</h4>
        <p>Some operations require device authentication. Include the device ID in your WebSocket connection via HTTP headers:</p>
        <ul>
          <li><code>x-device-id</code>: Unique identifier for the client device</li>
        </ul>
        
        <h3>Message Types</h3>
        
        <h4>Client → Server</h4>
        <div className="code-example">
          <h5>SUBSCRIBE</h5>
          <pre>{`{
  "type": "SUBSCRIBE",
  "topics": ["market-data", "system"]
}`}</pre>
          
          <h5>UNSUBSCRIBE</h5>
          <pre>{`{
  "type": "UNSUBSCRIBE",
  "topics": ["portfolio"]
}`}</pre>
          
          <h5>REQUEST</h5>
          <pre>{`{
  "type": "REQUEST",
  "topic": "market-data",
  "action": "getToken",
  "symbol": "btc",
  "requestId": "123"
}`}</pre>
          
          <h5>COMMAND</h5>
          <pre>{`{
  "type": "COMMAND",
  "topic": "portfolio",
  "action": "refreshBalance"
}`}</pre>
        </div>
        
        <h4>Server → Client</h4>
        <div className="code-example">
          <h5>DATA</h5>
          <pre>{`{
  "type": "DATA",
  "topic": "market-data",
  "action": "getToken",
  "requestId": "123",
  "data": { /* token data */ },
  "timestamp": "2025-04-07T15:30:00Z"
}`}</pre>
          
          <h5>ERROR</h5>
          <pre>{`{
  "type": "ERROR",
  "code": 4010,
  "message": "Authentication required for restricted topics",
  "timestamp": "2025-04-07T15:30:00Z"
}`}</pre>
          
          <h5>SYSTEM</h5>
          <pre>{`{
  "type": "SYSTEM",
  "action": "heartbeat",
  "timestamp": "2025-04-07T15:30:00Z"
}`}</pre>
          
          <h5>ACKNOWLEDGMENT</h5>
          <pre>{`{
  "type": "ACKNOWLEDGMENT",
  "operation": "subscribe",
  "topics": ["market-data", "system"],
  "timestamp": "2025-04-07T15:30:00Z"
}`}</pre>
        </div>
        
        <h3>Error Codes</h3>
        <table className="error-codes-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>4000</td>
              <td>Invalid message format</td>
            </tr>
            <tr>
              <td>4001</td>
              <td>Missing message type</td>
            </tr>
            <tr>
              <td>4003</td>
              <td>Subscription requires at least one topic</td>
            </tr>
            <tr>
              <td>4010</td>
              <td>Authentication required for restricted topics</td>
            </tr>
            <tr>
              <td>4011</td>
              <td>Invalid authentication token</td>
            </tr>
            <tr>
              <td>4012</td>
              <td>Admin role required for admin topics</td>
            </tr>
            <tr>
              <td>4040</td>
              <td>Resource not found</td>
            </tr>
            <tr>
              <td>4050</td>
              <td>Connection state invalid</td>
            </tr>
            <tr>
              <td>4401</td>
              <td>Token expired</td>
            </tr>
            <tr>
              <td>5000</td>
              <td>Internal server error</td>
            </tr>
          </tbody>
        </table>

        <h3>Reconnection Strategy</h3>
        <p>Implementing a robust reconnection strategy is crucial for reliable WebSocket usage:</p>
        <div className="code-example">
          <pre>{`const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // milliseconds
let reconnectAttempt = 0;

function connectWebSocket() {
  const socket = new WebSocket('wss://degenduel.me/api/v69/ws');
  
  socket.onopen = () => {
    console.log('Connected to DegenDuel WebSocket');
    reconnectAttempt = 0;
    // Subscribe to topics...
  };
  
  socket.onclose = (event) => {
    if (reconnectAttempt < RECONNECT_DELAYS.length) {
      const delay = RECONNECT_DELAYS[reconnectAttempt];
      console.log(\`Reconnecting in \${delay}ms...\`);
      setTimeout(() => {
        reconnectAttempt++;
        connectWebSocket();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  };
  
  // Other event handlers...
  
  return socket;
}

const socket = connectWebSocket();`}</pre>
        </div>
      </div>
      
      {/* CSS Styles for the component */}
      <style jsx>{`
        .websocket-guide {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          padding: 20px;
          max-width: 1600px;
          margin: 0 auto;
          color: #333;
        }
        
        h1, h2, h3, h4, h5 {
          color: #2c3e50;
        }
        
        .container {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          margin-bottom: 40px;
        }
        
        .panel {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          padding: 20px;
          position: relative;
        }
        
        .controls {
          flex: 1;
          min-width: 300px;
        }
        
        .messages {
          flex: 2;
          min-width: 400px;
        }
        
        .data-display {
          flex: 1;
          min-width: 300px;
        }
        
        .form-group {
          margin-bottom: 15px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }
        
        .message-input {
          width: 100%;
          font-family: monospace;
          padding: 8px;
          border-radius: 4px;
          border: 1px solid #ddd;
        }
        
        button {
          background-color: #3498db;
          color: white;
          border: none;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          margin: 5px;
        }
        
        button:hover {
          background-color: #2980b9;
        }
        
        button:disabled {
          background-color: #95a5a6;
          cursor: not-allowed;
        }
        
        .connect-button {
          background-color: #3498db;
        }
        
        .disconnect-button {
          background-color: #e74c3c;
        }
        
        .subscribe-button {
          background-color: #2ecc71;
        }
        
        .unsubscribe-button {
          background-color: #f39c12;
        }
        
        .clear-button {
          position: absolute;
          top: 20px;
          right: 20px;
          background-color: #7f8c8d;
        }
        
        .button-group {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .checkbox-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 15px;
        }
        
        .checkbox-item {
          display: flex;
          align-items: center;
        }
        
        .checkbox-item input {
          margin-right: 5px;
        }
        
        .message-list {
          max-height: 500px;
          overflow-y: auto;
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 4px;
          background-color: #f9f9f9;
        }
        
        .message {
          padding: 10px;
          margin-bottom: 10px;
          border-radius: 4px;
          position: relative;
        }
        
        .message-incoming {
          background-color: #e8f4fd;
          border-left: 4px solid #3498db;
        }
        
        .message-outgoing {
          background-color: #f0fff4;
          border-left: 4px solid #2ecc71;
        }
        
        .message-error {
          background-color: #ffeaea;
          border-left: 4px solid #e74c3c;
        }
        
        .timestamp {
          font-size: 0.7em;
          color: #7f8c8d;
          position: absolute;
          top: 8px;
          right: 8px;
        }
        
        .message-type {
          font-weight: bold;
          color: #3498db;
          margin-bottom: 5px;
        }
        
        .message-content {
          font-family: monospace;
          white-space: pre-wrap;
          word-break: break-word;
          margin: 0;
          overflow-x: auto;
        }
        
        .topic-label {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.8em;
          margin-right: 5px;
          color: white;
          background-color: #7f8c8d;
        }
        
        .topic-market-data { background-color: #3498db; }
        .topic-portfolio { background-color: #2ecc71; }
        .topic-system { background-color: #9b59b6; }
        .topic-contest { background-color: #f1c40f; }
        .topic-user { background-color: #e67e22; }
        .topic-admin { background-color: #e74c3c; }
        .topic-wallet { background-color: #1abc9c; }
        .topic-skyduel { background-color: #34495e; }
        
        .status-connected, .status-operational {
          color: #2ecc71;
          font-weight: bold;
        }
        
        .status-disconnected, .status-error {
          color: #e74c3c;
          font-weight: bold;
        }
        
        .status-connecting {
          color: #f39c12;
          font-weight: bold;
        }
        
        .token-list {
          max-height: 400px;
          overflow-y: auto;
          margin-top: 10px;
        }
        
        .token-item {
          padding: 8px;
          border-bottom: 1px solid #eee;
          display: flex;
          align-items: center;
        }
        
        .token-item:hover {
          background-color: #f9f9f9;
        }
        
        .token-symbol {
          font-weight: bold;
          width: 80px;
        }
        
        .token-price {
          width: 100px;
          text-align: right;
        }
        
        .token-change {
          width: 80px;
          text-align: right;
          padding: 0 5px;
        }
        
        .token-change.positive {
          color: #2ecc71;
        }
        
        .token-change.negative {
          color: #e74c3c;
        }
        
        .token-count {
          margin-top: 5px;
          font-style: italic;
          color: #7f8c8d;
          margin-bottom: 10px;
        }
        
        /* Documentation Styles */
        .documentation {
          padding: 20px;
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .topics-table, .error-codes-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        
        .topics-table th, .topics-table td,
        .error-codes-table th, .error-codes-table td {
          border: 1px solid #ddd;
          padding: 10px;
          text-align: left;
        }
        
        .topics-table th, .error-codes-table th {
          background-color: #f2f2f2;
        }
        
        .code-example {
          margin: 20px 0;
        }
        
        .code-example h5 {
          margin: 10px 0 5px;
        }
        
        .code-example pre {
          background-color: #f8f8f8;
          padding: 10px;
          border-radius: 4px;
          border-left: 4px solid #3498db;
          font-family: monospace;
          overflow-x: auto;
        }
        
        @media (max-width: 1200px) {
          .container {
            flex-direction: column;
          }
          .controls, .messages, .data-display {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default WebSocketAPIGuide;

/*
   WEBSOCKET IMPLEMENTATION EXAMPLES

   Here are some practical examples for implementing WebSocket connections in your React application:

   1. Enhanced WebSocket Hook with Authentication Support:
   ```jsx
   import { useState, useEffect, useRef, useCallback } from 'react';

   // Configuration
   const WS_URL = process.env.NODE_ENV === 'production' 
     ? 'wss://degenduel.me/api/v69/ws'
     : `ws://${window.location.hostname}:${window.location.port}/api/v69/ws`;

   const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000]; // Exponential backoff

   /**
    * DegenDuel WebSocket Hook
    * 
    * This custom hook provides a complete WebSocket implementation with:
    * - Connection management
    * - Authentication (session cookie, token, or biometric)
    * - Topic subscription
    * - Automatic reconnection
    * - Request/response handling
    */
   export const useDegenDuelWebSocket = (options = {}) => {
     const {
       initialTopics = [],
       autoConnect = true,
       authToken = null,
       deviceId = null,
       onError = null,
       onTokenExpired = null,
     } = options;

     // WebSocket connection state
     const [status, setStatus] = useState('disconnected');
     const [data, setData] = useState({});
     const [error, setError] = useState(null);

     // Refs for WebSocket instance and reconnection
     const wsRef = useRef(null);
     const reconnectCountRef = useRef(0);
     const reconnectTimerRef = useRef(null);
     const subscriptionsRef = useRef(new Set(initialTopics));
     const pendingRequestsRef = useRef(new Map());

     // Connect to WebSocket
     const connect = useCallback(() => {
       if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || 
                           wsRef.current.readyState === WebSocket.CONNECTING)) {
         return;
       }
       
       setStatus('connecting');
       
       try {
         // Create WebSocket connection
         wsRef.current = new WebSocket(WS_URL);
         
         // Handle connection open
         wsRef.current.onopen = () => {
           setStatus('connected');
           setError(null);
           reconnectCountRef.current = 0;
           console.log('WebSocket connected');
           
           // Subscribe to initial topics
           if (subscriptionsRef.current.size > 0) {
             const message = {
               type: 'SUBSCRIBE',
               topics: [...subscriptionsRef.current]
             };
             
             // Add auth token if provided
             if (authToken) {
               message.authToken = authToken;
             }
             
             sendRawMessage(message);
           }
         };
         
         // Handle messages
         wsRef.current.onmessage = (event) => {
           try {
             const message = JSON.parse(event.data);
             console.log('WebSocket message:', message);
             
             // Handle different message types
             if (message.type === 'DATA') {
               // Store data by topic
               setData(prevData => ({
                 ...prevData,
                 [message.topic]: message.data
               }));
             } else if (message.type === 'ERROR') {
               setError(message);
               
               // Handle token expiration
               if (message.code === 4401 && message.reason === 'token_expired') {
                 if (onTokenExpired) {
                   onTokenExpired(message);
                 }
               }
               
               if (onError) {
                 onError(message);
               }
             }
             
             // Handle response to a request
             if (message.requestId && pendingRequestsRef.current.has(message.requestId)) {
               const { resolve, reject } = pendingRequestsRef.current.get(message.requestId);
               
               if (message.type === 'ERROR') {
                 reject(message);
               } else {
                 resolve(message);
               }
               
               pendingRequestsRef.current.delete(message.requestId);
             }
           } catch (error) {
             console.error('Error parsing WebSocket message:', error);
           }
         };
         
         // Handle connection close
         wsRef.current.onclose = (event) => {
           setStatus('disconnected');
           wsRef.current = null;
           console.log('WebSocket disconnected:', event.code, event.reason);
           
           // Attempt reconnection with exponential backoff
           if (event.code !== 1000) {
             attemptReconnect();
           }
         };
         
         // Handle connection error
         wsRef.current.onerror = (error) => {
           console.error('WebSocket error:', error);
           setStatus('error');
           setError({
             code: 'CONN_ERROR',
             message: 'Connection error',
             error
           });
           
           if (onError) {
             onError(error);
           }
         };
       } catch (error) {
         console.error('Error creating WebSocket:', error);
         setStatus('error');
         setError({
           code: 'CONN_ERROR',
           message: 'Failed to create WebSocket connection',
           error
         });
         
         if (onError) {
           onError(error);
         }
       }
     }, [authToken, onError, onTokenExpired]);
     
     // Attempt to reconnect with exponential backoff
     const attemptReconnect = useCallback(() => {
       // Clear any existing timer
       if (reconnectTimerRef.current) {
         clearTimeout(reconnectTimerRef.current);
       }
       
       // Check if we've reached max retries
       if (reconnectCountRef.current >= RECONNECT_DELAYS.length) {
         console.log('Maximum reconnection attempts reached');
         setError({
           code: 'MAX_RECONNECT',
           message: 'Maximum reconnection attempts reached'
         });
         return;
       }
       
       // Get delay based on retry count
       const delay = RECONNECT_DELAYS[reconnectCountRef.current];
       console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectCountRef.current + 1}/${RECONNECT_DELAYS.length})`);
       
       // Set timer for reconnection
       reconnectTimerRef.current = setTimeout(() => {
         reconnectCountRef.current++;
         connect();
       }, delay);
     }, [connect]);
     
     // Disconnect from WebSocket
     const disconnect = useCallback(() => {
       // Clear reconnection timer
       if (reconnectTimerRef.current) {
         clearTimeout(reconnectTimerRef.current);
         reconnectTimerRef.current = null;
       }
       
       // Close connection if open
       if (wsRef.current) {
         wsRef.current.close(1000, 'User initiated disconnect');
       }
     }, []);
     
     // Send a raw message to the WebSocket
     const sendRawMessage = useCallback((message) => {
       if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
         console.error('WebSocket not connected');
         return false;
       }
       
       try {
         wsRef.current.send(JSON.stringify(message));
         return true;
       } catch (error) {
         console.error('Error sending WebSocket message:', error);
         return false;
       }
     }, []);
     
     // Subscribe to topics
     const subscribe = useCallback((topics) => {
       if (!Array.isArray(topics)) {
         topics = [topics];
       }
       
       // Store subscriptions
       topics.forEach(topic => {
         subscriptionsRef.current.add(topic);
       });
       
       // Send subscription message if connected
       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         const message = {
           type: 'SUBSCRIBE',
           topics
         };
         
         // Add auth token if provided
         if (authToken) {
           message.authToken = authToken;
         }
         
         return sendRawMessage(message);
       }
       
       return false;
     }, [authToken, sendRawMessage]);
     
     // Unsubscribe from topics
     const unsubscribe = useCallback((topics) => {
       if (!Array.isArray(topics)) {
         topics = [topics];
       }
       
       // Remove from subscriptions
       topics.forEach(topic => {
         subscriptionsRef.current.delete(topic);
       });
       
       // Send unsubscription message if connected
       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         return sendRawMessage({
           type: 'UNSUBSCRIBE',
           topics
         });
       }
       
       return false;
     }, [sendRawMessage]);
     
     // Send a request and get a response
     const request = useCallback((topic, action, params = {}) => {
       return new Promise((resolve, reject) => {
         if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
           reject(new Error('WebSocket not connected'));
           return;
         }
         
         // Generate unique request ID
         const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
         
         // Store the promise handlers
         pendingRequestsRef.current.set(requestId, { resolve, reject });
         
         // Set a timeout to prevent hanging promises
         const timeout = setTimeout(() => {
           if (pendingRequestsRef.current.has(requestId)) {
             pendingRequestsRef.current.delete(requestId);
             reject(new Error('Request timeout'));
           }
         }, 10000); // 10 second timeout
         
         // Send the request
         const success = sendRawMessage({
           type: 'REQUEST',
           topic,
           action,
           requestId,
           ...params
         });
         
         if (!success) {
           clearTimeout(timeout);
           pendingRequestsRef.current.delete(requestId);
           reject(new Error('Failed to send request'));
         }
       });
     }, [sendRawMessage]);
     
     // Send a command (authenticated action)
     const command = useCallback((topic, action, params = {}) => {
       if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
         return Promise.reject(new Error('WebSocket not connected'));
       }
       
       return new Promise((resolve, reject) => {
         const requestId = `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
         
         // Store the promise handlers
         pendingRequestsRef.current.set(requestId, { resolve, reject });
         
         // Set a timeout to prevent hanging promises
         const timeout = setTimeout(() => {
           if (pendingRequestsRef.current.has(requestId)) {
             pendingRequestsRef.current.delete(requestId);
             reject(new Error('Command timeout'));
           }
         }, 10000); // 10 second timeout
         
         // Send the command
         const success = sendRawMessage({
           type: 'COMMAND',
           topic,
           action,
           requestId,
           ...params
         });
         
         if (!success) {
           clearTimeout(timeout);
           pendingRequestsRef.current.delete(requestId);
           reject(new Error('Failed to send command'));
         }
       });
     }, [sendRawMessage]);
     
     // Auto-connect on mount if specified
     useEffect(() => {
       if (autoConnect) {
         connect();
       }
       
       // Clean up on unmount
       return () => {
         disconnect();
       };
     }, [autoConnect, connect, disconnect]);
     
     // Add device ID header if provided
     useEffect(() => {
       if (deviceId && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         // For future connections, we'll need to inject the header somewhere
         console.log('Device ID provided:', deviceId);
       }
     }, [deviceId]);
     
     return {
       status,
       connected: status === 'connected',
       connecting: status === 'connecting',
       data,
       error,
       connect,
       disconnect,
       subscribe,
       unsubscribe,
       request,
       command,
       send: sendRawMessage
     };
   };
   ```

   2. Biometric Authentication Component:
   ```jsx
   import React, { useState } from 'react';
   import { useDegenDuelWebSocket } from './hooks/useDegenDuelWebSocket';

   // Mock for biometric auth API
   const biometricAuth = {
     isBiometricAvailable: async () => {
       try {
         return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
       } catch (error) {
         console.error('Error checking biometric availability:', error);
         return false;
       }
     },
     
     getAuthOptions: async (userId) => {
       const response = await fetch('/api/auth/biometric/auth-options', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json'
         },
         body: JSON.stringify({ userId })
       });
       
       if (!response.ok) {
         throw new Error('Failed to get auth options');
       }
       
       return response.json();
     },
     
     verifyAuth: async (credential, userId) => {
       const response = await fetch('/api/auth/biometric/auth-verify', {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json'
         },
         body: JSON.stringify({
           ...credential,
           userId
         })
       });
       
       if (!response.ok) {
         throw new Error('Failed to verify biometric authentication');
       }
       
       return response.json();
     }
   };

   const BiometricAuthPortfolio = ({ userId }) => {
     const [biometricAvailable, setBiometricAvailable] = useState(false);
     const [authenticating, setAuthenticating] = useState(false);
     const [authenticated, setAuthenticated] = useState(false);
     const [error, setError] = useState(null);
     
     const { 
       connected,
       status, 
       data, 
       connect, 
       subscribe, 
       request 
     } = useDegenDuelWebSocket({
       autoConnect: false,
       initialTopics: [],
       onTokenExpired: () => {
         // Handle token expiration
         setAuthenticated(false);
         setError('Your session has expired. Please authenticate again.');
       }
     });
     
     // Check biometric availability on mount
     React.useEffect(() => {
       biometricAuth.isBiometricAvailable()
         .then(available => {
           setBiometricAvailable(available);
         });
     }, []);
     
     // Handle biometric authentication
     const handleBiometricAuth = async () => {
       if (!userId) {
         setError('User ID is required');
         return;
       }
       
       setAuthenticating(true);
       setError(null);
       
       try {
         // Get authentication options from server
         const options = await biometricAuth.getAuthOptions(userId);
         
         // Convert base64 challenge to ArrayBuffer
         options.challenge = Uint8Array.from(
           atob(options.challenge.replace(/-/g, '+').replace(/_/g, '/')),
           c => c.charCodeAt(0)
         );
         
         // Convert allowed credentials
         if (options.allowCredentials) {
           options.allowCredentials = options.allowCredentials.map(credential => ({
             ...credential,
             id: Uint8Array.from(
               atob(credential.id.replace(/-/g, '+').replace(/_/g, '/')),
               c => c.charCodeAt(0)
             )
           }));
         }
         
         // Prompt user for biometric verification
         const credential = await navigator.credentials.get({
           publicKey: options
         });
         
         // Prepare credential for sending to server
         const authResult = {
           id: credential.id,
           rawId: Array.from(new Uint8Array(credential.rawId)),
           type: credential.type,
           response: {
             authenticatorData: btoa(
               String.fromCharCode(...new Uint8Array(credential.response.authenticatorData))
             ),
             clientDataJSON: btoa(
               String.fromCharCode(...new Uint8Array(credential.response.clientDataJSON))
             ),
             signature: btoa(
               String.fromCharCode(...new Uint8Array(credential.response.signature))
             ),
             userHandle: credential.response.userHandle
               ? btoa(String.fromCharCode(...new Uint8Array(credential.response.userHandle)))
               : null
           }
         };
         
         // Verify with server
         const result = await biometricAuth.verifyAuth(authResult, userId);
         
         if (result.verified) {
           setAuthenticated(true);
           
           // Now we can connect to WebSocket - the cookie is set by the server
           connect();
           
           // Subscribe to portfolio data
           subscribe(['portfolio', 'user']);
           
           // Get initial portfolio data
           request('portfolio', 'getProfile');
         } else {
           setError('Biometric authentication failed');
         }
       } catch (error) {
         console.error('Biometric auth error:', error);
         setError(error.message || 'Authentication failed');
       } finally {
         setAuthenticating(false);
       }
     };
     
     if (!biometricAvailable) {
       return <div>Biometric authentication is not available on this device.</div>;
     }
     
     if (!authenticated) {
       return (
         <div className="biometric-auth">
           <h2>Authenticate with Biometrics</h2>
           {error && <div className="error">{error}</div>}
           <button 
             onClick={handleBiometricAuth} 
             disabled={authenticating}
             className="biometric-button"
           >
             {authenticating ? 'Authenticating...' : 'Authenticate with Face ID / Touch ID'}
           </button>
         </div>
       );
     }
     
     // Show loading state while connecting
     if (status !== 'connected') {
       return <div>Connecting to portfolio data...</div>;
     }
     
     // Get portfolio data from WebSocket
     const portfolio = data.portfolio || null;
     
     if (!portfolio) {
       return <div>Loading portfolio...</div>;
     }
     
     return (
       <div className="portfolio">
         <h2>Your Portfolio</h2>
         <div className="user-info">
           <p>Welcome, {data.user?.nickname || userId}</p>
         </div>
         
         <div className="portfolio-value">
           <h3>Total Value</h3>
           <div className="value">${portfolio.totalValue?.toFixed(2) || '0.00'}</div>
         </div>
         
         <h3>Holdings</h3>
         <div className="holdings">
           {portfolio.holdings?.map(holding => (
             <div className="holding" key={holding.symbol}>
               <div className="symbol">{holding.symbol}</div>
               <div className="amount">{holding.amount}</div>
               <div className="value">${holding.value.toFixed(2)}</div>
             </div>
           ))}
           {(!portfolio.holdings || portfolio.holdings.length === 0) && (
             <div className="empty">No holdings yet</div>
           )}
         </div>
       </div>
     );
   };

   export default BiometricAuthPortfolio;
   ```

   3. Market Data Component Example:
   ```jsx
   import React, { useEffect } from 'react';
   import { useDegenDuelWebSocket } from './hooks/useDegenDuelWebSocket';

   const MarketDataComponent = () => {
     const { 
       status, 
       data, 
       error, 
       request 
     } = useDegenDuelWebSocket({
       initialTopics: ['market-data', 'system']
     });
     
     // Request initial data when connected
     useEffect(() => {
       if (status === 'connected') {
         request('market-data', 'getAllTokens')
           .catch(error => console.error('Error fetching tokens:', error));
         
         request('system', 'getStatus')
           .catch(error => console.error('Error fetching system status:', error));
       }
     }, [status, request]);
     
     // Extract market data from WebSocket data
     const marketData = data['market-data'] || [];
     const systemStatus = data['system'] || { status: 'unknown' };
     
     return (
       <div className="market-data">
         <h2>DegenDuel Market Data</h2>
         
         <div className="connection-status">
           <div className="status-indicator">
             WebSocket: <span className={`status-${status}`}>{status}</span>
           </div>
           
           <div className="system-status">
             System: <span className={`status-${systemStatus.status}`}>
               {systemStatus.status || 'unknown'}
             </span>
           </div>
           
           {error && (
             <div className="error-message">
               Error: {error.message || 'Unknown error'}
             </div>
           )}
         </div>
         
         <h3>Token Prices</h3>
         {Array.isArray(marketData) && marketData.length > 0 ? (
           <div className="token-table">
             <table>
               <thead>
                 <tr>
                   <th>Symbol</th>
                   <th>Price</th>
                   <th>24h Change</th>
                   <th>Market Cap</th>
                 </tr>
               </thead>
               <tbody>
                 {marketData.map(token => (
                   <tr key={token.symbol}>
                     <td>{token.symbol}</td>
                     <td>${Number(token.price).toLocaleString()}</td>
                     <td className={token.change24h >= 0 ? 'positive' : 'negative'}>
                       {token.change24h >= 0 ? '+' : ''}{token.change24h}%
                     </td>
                     <td>${Number(token.marketCap).toLocaleString()}</td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
         ) : (
           <div className="loading">Loading market data...</div>
         )}
       </div>
     );
   };

   export default MarketDataComponent;
   ```

   4. Redux Integration with Authentication Support:
   ```jsx
   // websocketSlice.js
   import { createSlice } from '@reduxjs/toolkit';

   const initialState = {
     status: 'disconnected',
     data: {},
     error: null,
     reconnectCount: 0,
     authStatus: {
       authenticated: false,
       method: null, // 'cookie', 'token', 'biometric'
       tokenExpired: false
     }
   };

   export const websocketSlice = createSlice({
     name: 'websocket',
     initialState,
     reducers: {
       connectionStatusChanged: (state, action) => {
         state.status = action.payload;
       },
       dataReceived: (state, action) => {
         const { topic, data } = action.payload;
         state.data[topic] = data;
       },
       errorReceived: (state, action) => {
         state.error = action.payload;
         
         // Handle token expiration
         if (action.payload.code === 4401) {
           state.authStatus.tokenExpired = true;
         }
       },
       reconnectCountChanged: (state, action) => {
         state.reconnectCount = action.payload;
       },
       authStatusChanged: (state, action) => {
         state.authStatus = {
           ...state.authStatus,
           ...action.payload
         };
       },
       clearError: (state) => {
         state.error = null;
       }
     }
   });

   export const { 
     connectionStatusChanged,
     dataReceived,
     errorReceived,
     reconnectCountChanged,
     authStatusChanged,
     clearError
   } = websocketSlice.actions;

   export default websocketSlice.reducer;

   // websocketMiddleware.js
   const createWebSocketMiddleware = () => {
     let socket = null;
     let subscriptions = new Set();
     let reconnectTimer = null;
     let reconnectCount = 0;
     let pendingRequests = new Map();
     
     const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
     
     // Connect to WebSocket
     const connect = ({ dispatch, getState }, options = {}) => {
       const { url, authToken, deviceId } = options;
       
       if (socket) {
         socket.close();
       }
       
       dispatch(connectionStatusChanged('connecting'));
       
       // Create WebSocket connection
       socket = new WebSocket(url);
       
       // Connection opened
       socket.onopen = () => {
         dispatch(connectionStatusChanged('connected'));
         reconnectCount = 0;
         dispatch(reconnectCountChanged(0));
         console.log('WebSocket connected');
         
         // Resubscribe to topics
         if (subscriptions.size > 0) {
           const message = {
             type: 'SUBSCRIBE',
             topics: [...subscriptions]
           };
           
           if (authToken) {
             message.authToken = authToken;
           }
           
           socket.send(JSON.stringify(message));
         }
       };
       
       // Listen for messages
       socket.onmessage = (event) => {
         try {
           const message = JSON.parse(event.data);
           
           // Handle different message types
           switch (message.type) {
             case 'DATA':
               dispatch(dataReceived({ 
                 topic: message.topic, 
                 data: message.data 
               }));
               break;
             
             case 'ERROR':
               dispatch(errorReceived(message));
               
               // Handle token expiration
               if (message.code === 4401 && message.reason === 'token_expired') {
                 dispatch(authStatusChanged({ 
                   authenticated: false,
                   tokenExpired: true 
                 }));
               }
               break;
             
             case 'SYSTEM':
               // Handle system messages if needed
               break;
             
             case 'ACKNOWLEDGMENT':
               // Handle acknowledgments if needed
               break;
           }
           
           // Resolve pending requests
           if (message.requestId && pendingRequests.has(message.requestId)) {
             const { resolve, reject } = pendingRequests.get(message.requestId);
             
             if (message.type === 'ERROR') {
               reject(message);
             } else {
               resolve(message);
             }
             
             pendingRequests.delete(message.requestId);
           }
           
         } catch (error) {
           console.error('Error parsing WebSocket message:', error);
         }
       };
       
       // Connection closed
       socket.onclose = (event) => {
         dispatch(connectionStatusChanged('disconnected'));
         socket = null;
         console.log('WebSocket disconnected:', event.code, event.reason);
         
         // Attempt reconnection for unexpected closes
         if (event.code !== 1000 && reconnectCount < RECONNECT_DELAYS.length) {
           clearTimeout(reconnectTimer);
           
           const delay = RECONNECT_DELAYS[reconnectCount];
           console.log(`Reconnecting in ${delay}ms (attempt ${reconnectCount + 1}/${RECONNECT_DELAYS.length})`);
           
           reconnectTimer = setTimeout(() => {
             reconnectCount++;
             dispatch(reconnectCountChanged(reconnectCount));
             connect({ dispatch, getState }, options);
           }, delay);
         }
       };
       
       // Handle errors
       socket.onerror = (error) => {
         dispatch(errorReceived({
           code: 'CONN_ERROR',
           message: 'WebSocket connection error',
           error
         }));
       };
     };
     
     // Send a message to the WebSocket
     const sendMessage = (message) => {
       if (!socket || socket.readyState !== WebSocket.OPEN) {
         console.error('WebSocket not connected, message not sent');
         return false;
       }
       
       try {
         socket.send(JSON.stringify(message));
         return true;
       } catch (error) {
         console.error('Error sending message:', error);
         return false;
       }
     };
     
     // Core middleware function
     return store => next => action => {
       switch (action.type) {
         case 'WS_CONNECT':
           connect(store, action.payload);
           break;
           
         case 'WS_DISCONNECT':
           if (socket) {
             socket.close(1000, 'User initiated disconnect');
           }
           
           if (reconnectTimer) {
             clearTimeout(reconnectTimer);
           }
           break;
           
         case 'WS_SUBSCRIBE':
           const topics = Array.isArray(action.payload) 
             ? action.payload 
             : [action.payload];
           
           // Add to subscriptions set
           topics.forEach(topic => subscriptions.add(topic));
           
           if (socket && socket.readyState === WebSocket.OPEN) {
             sendMessage({
               type: 'SUBSCRIBE',
               topics,
               authToken: action.authToken
             });
           }
           break;
           
         case 'WS_UNSUBSCRIBE':
           const unsubTopics = Array.isArray(action.payload) 
             ? action.payload 
             : [action.payload];
           
           // Remove from subscriptions set
           unsubTopics.forEach(topic => subscriptions.delete(topic));
           
           if (socket && socket.readyState === WebSocket.OPEN) {
             sendMessage({
               type: 'UNSUBSCRIBE',
               topics: unsubTopics
             });
           }
           break;
           
         case 'WS_REQUEST':
           // Return a promise that resolves when the response is received
           return new Promise((resolve, reject) => {
             if (!socket || socket.readyState !== WebSocket.OPEN) {
               reject(new Error('WebSocket not connected'));
               return;
             }
             
             const { topic, action: wsAction, params = {} } = action;
             const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
             
             // Store promise handlers
             pendingRequests.set(requestId, { resolve, reject });
             
             // Set timeout to prevent hanging promises
             setTimeout(() => {
               if (pendingRequests.has(requestId)) {
                 pendingRequests.delete(requestId);
                 reject(new Error('Request timeout'));
               }
             }, 10000);
             
             // Send request
             const success = sendMessage({
               type: 'REQUEST',
               topic,
               action: wsAction,
               requestId,
               ...params
             });
             
             if (!success) {
               pendingRequests.delete(requestId);
               reject(new Error('Failed to send request'));
             }
           });
           
         case 'WS_COMMAND':
           // Similar to request but for commands
           return new Promise((resolve, reject) => {
             if (!socket || socket.readyState !== WebSocket.OPEN) {
               reject(new Error('WebSocket not connected'));
               return;
             }
             
             const { topic, action: wsAction, params = {} } = action;
             const requestId = `cmd-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
             
             // Store promise handlers
             pendingRequests.set(requestId, { resolve, reject });
             
             // Set timeout
             setTimeout(() => {
               if (pendingRequests.has(requestId)) {
                 pendingRequests.delete(requestId);
                 reject(new Error('Command timeout'));
               }
             }, 10000);
             
             // Send command
             const success = sendMessage({
               type: 'COMMAND',
               topic,
               action: wsAction,
               requestId,
               ...params
             });
             
             if (!success) {
               pendingRequests.delete(requestId);
               reject(new Error('Failed to send command'));
             }
           });
           
         case 'WS_AUTHENTICATE_BIOMETRIC':
           // Handle biometric authentication
           const { userId } = action.payload;
           
           // This would need to be implemented with the WebAuthn API
           // For this example, we'll just mark as authenticated
           store.dispatch(authStatusChanged({
             authenticated: true,
             method: 'biometric'
           }));
           break;
           
         default:
           return next(action);
       }
     };
   };

   // Action creators
   export const connectWebSocket = (url, authToken, deviceId) => ({
     type: 'WS_CONNECT',
     payload: { url, authToken, deviceId }
   });

   export const disconnectWebSocket = () => ({
     type: 'WS_DISCONNECT'
   });

   export const subscribeToTopics = (topics, authToken) => ({
     type: 'WS_SUBSCRIBE',
     payload: topics,
     authToken
   });

   export const unsubscribeFromTopics = (topics) => ({
     type: 'WS_UNSUBSCRIBE',
     payload: topics
   });

   export const sendRequest = (topic, action, params) => ({
     type: 'WS_REQUEST',
     topic,
     action,
     params
   });

   export const sendCommand = (topic, action, params) => ({
     type: 'WS_COMMAND',
     topic,
     action,
     params
   });

   export const authenticateWithBiometric = (userId) => ({
     type: 'WS_AUTHENTICATE_BIOMETRIC',
     payload: { userId }
   });

   export default createWebSocketMiddleware;
   ```

   5. Context API Integration:
   ```jsx
   import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';

   // WebSocket context
   const WebSocketContext = createContext(null);

   // Initial state
   const initialState = {
     status: 'disconnected',
     data: {},
     error: null,
     authenticated: false
   };

   // Action types
   const WS_CONNECTING = 'WS_CONNECTING';
   const WS_CONNECTED = 'WS_CONNECTED';
   const WS_DISCONNECTED = 'WS_DISCONNECTED';
   const WS_ERROR = 'WS_ERROR';
   const WS_DATA_RECEIVED = 'WS_DATA_RECEIVED';
   const WS_AUTHENTICATED = 'WS_AUTHENTICATED';
   const WS_AUTH_FAILED = 'WS_AUTH_FAILED';

   // Reducer
   function wsReducer(state, action) {
     switch (action.type) {
       case WS_CONNECTING:
         return { ...state, status: 'connecting' };
       case WS_CONNECTED:
         return { ...state, status: 'connected', error: null };
       case WS_DISCONNECTED:
         return { ...state, status: 'disconnected' };
       case WS_ERROR:
         return { ...state, error: action.payload };
       case WS_DATA_RECEIVED:
         return { 
           ...state, 
           data: { 
             ...state.data, 
             [action.payload.topic]: action.payload.data 
           } 
         };
       case WS_AUTHENTICATED:
         return { ...state, authenticated: true };
       case WS_AUTH_FAILED:
         return { ...state, authenticated: false, error: action.payload };
       default:
         return state;
     }
   }

   // WebSocket provider component
   export function WebSocketProvider({ children, url }) {
     const [state, dispatch] = useReducer(wsReducer, initialState);
     const wsRef = React.useRef(null);
     const authTokenRef = React.useRef(null);
     const subscriptionsRef = React.useRef(new Set());
     const pendingRequestsRef = React.useRef(new Map());
     
     // Connect to WebSocket
     const connect = useCallback(() => {
       if (wsRef.current) return;
       
       dispatch({ type: WS_CONNECTING });
       
       try {
         wsRef.current = new WebSocket(url);
         
         wsRef.current.onopen = () => {
           dispatch({ type: WS_CONNECTED });
           
           // Resubscribe to topics
           if (subscriptionsRef.current.size > 0) {
             const message = {
               type: 'SUBSCRIBE',
               topics: [...subscriptionsRef.current]
             };
             
             if (authTokenRef.current) {
               message.authToken = authTokenRef.current;
             }
             
             send(message);
           }
         };
         
         wsRef.current.onclose = () => {
           dispatch({ type: WS_DISCONNECTED });
           wsRef.current = null;
         };
         
         wsRef.current.onerror = (error) => {
           dispatch({ 
             type: WS_ERROR, 
             payload: { message: 'WebSocket error', error } 
           });
         };
         
         wsRef.current.onmessage = (event) => {
           try {
             const message = JSON.parse(event.data);
             
             // Handle different message types
             switch (message.type) {
               case 'DATA':
                 dispatch({ 
                   type: WS_DATA_RECEIVED, 
                   payload: { 
                     topic: message.topic, 
                     data: message.data 
                   } 
                 });
                 break;
               
               case 'ERROR':
                 dispatch({ type: WS_ERROR, payload: message });
                 
                 // Handle authentication errors
                 if (message.code === 4010 || message.code === 4401) {
                   dispatch({ type: WS_AUTH_FAILED, payload: message });
                 }
                 break;
             }
             
             // Resolve pending requests
             if (message.requestId && pendingRequestsRef.current.has(message.requestId)) {
               const { resolve, reject } = pendingRequestsRef.current.get(message.requestId);
               
               if (message.type === 'ERROR') {
                 reject(message);
               } else {
                 resolve(message);
               }
               
               pendingRequestsRef.current.delete(message.requestId);
             }
           } catch (error) {
             console.error('Error parsing WebSocket message:', error);
           }
         };
       } catch (error) {
         dispatch({ 
           type: WS_ERROR, 
           payload: { message: 'Failed to connect', error } 
         });
       }
     }, [url]);
     
     // Disconnect from WebSocket
     const disconnect = useCallback(() => {
       if (wsRef.current) {
         wsRef.current.close();
         wsRef.current = null;
       }
     }, []);
     
     // Send a message
     const send = useCallback((message) => {
       if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
         console.error('WebSocket not connected');
         return false;
       }
       
       try {
         wsRef.current.send(JSON.stringify(message));
         return true;
       } catch (error) {
         console.error('Error sending message:', error);
         return false;
       }
     }, []);
     
     // Subscribe to topics
     const subscribe = useCallback((topics, authToken) => {
       if (authToken) {
         authTokenRef.current = authToken;
       }
       
       const topicsArray = Array.isArray(topics) ? topics : [topics];
       
       // Add to subscriptions
       topicsArray.forEach(topic => {
         subscriptionsRef.current.add(topic);
       });
       
       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         const message = {
           type: 'SUBSCRIBE',
           topics: topicsArray
         };
         
         if (authTokenRef.current) {
           message.authToken = authTokenRef.current;
         }
         
         return send(message);
       }
       
       return false;
     }, [send]);
     
     // Unsubscribe from topics
     const unsubscribe = useCallback((topics) => {
       const topicsArray = Array.isArray(topics) ? topics : [topics];
       
       // Remove from subscriptions
       topicsArray.forEach(topic => {
         subscriptionsRef.current.delete(topic);
       });
       
       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         return send({
           type: 'UNSUBSCRIBE',
           topics: topicsArray
         });
       }
       
       return false;
     }, [send]);
     
     // Send a request
     const request = useCallback((topic, action, params = {}) => {
       return new Promise((resolve, reject) => {
         if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
           reject(new Error('WebSocket not connected'));
           return;
         }
         
         const requestId = `req-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
         
         // Store promise handlers
         pendingRequestsRef.current.set(requestId, { resolve, reject });
         
         // Set timeout
         setTimeout(() => {
           if (pendingRequestsRef.current.has(requestId)) {
             pendingRequestsRef.current.delete(requestId);
             reject(new Error('Request timeout'));
           }
         }, 10000);
         
         // Send request
         const success = send({
           type: 'REQUEST',
           topic,
           action,
           requestId,
           ...params
         });
         
         if (!success) {
           pendingRequestsRef.current.delete(requestId);
           reject(new Error('Failed to send request'));
         }
       });
     }, [send]);
     
     // Set authentication token
     const setAuthToken = useCallback((token) => {
       authTokenRef.current = token;
       
       // If already connected, try to authenticate
       if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
         // Just a ping to test authentication
         request('user', 'getProfile')
           .then(() => {
             dispatch({ type: WS_AUTHENTICATED });
           })
           .catch((error) => {
             dispatch({ 
               type: WS_AUTH_FAILED, 
               payload: { message: 'Authentication failed', error } 
             });
           });
       }
     }, [request]);
     
     // Clean up on unmount
     useEffect(() => {
       return () => {
         disconnect();
       };
     }, [disconnect]);
     
     // Context value
     const contextValue = {
       ...state,
       connect,
       disconnect,
       subscribe,
       unsubscribe,
       request,
       send,
       setAuthToken
     };
     
     return (
       <WebSocketContext.Provider value={contextValue}>
         {children}
       </WebSocketContext.Provider>
     );
   }

   // Hook to use WebSocket context
   export function useWebSocket() {
     const context = useContext(WebSocketContext);
     
     if (!context) {
       throw new Error('useWebSocket must be used within a WebSocketProvider');
     }
     
     return context;
   }

   // Usage example
   function App() {
     return (
       <WebSocketProvider url="wss://degenduel.me/api/v69/ws">
         <MarketDataDisplay />
         <AuthenticatedContent />
       </WebSocketProvider>
     );
   }

   function MarketDataDisplay() {
     const { status, data, subscribe, request } = useWebSocket();
     
     // Subscribe to market data
     useEffect(() => {
       if (status === 'connected') {
         subscribe('market-data');
         request('market-data', 'getAllTokens');
       }
     }, [status, subscribe, request]);
     
     const marketData = data['market-data'] || [];
     
     return (
       <div>
         <h2>Market Data</h2>
         <div>Status: {status}</div>
         <ul>
           {marketData.map(token => (
             <li key={token.symbol}>
               {token.symbol}: ${token.price}
             </li>
           ))}
         </ul>
       </div>
     );
   }

   function AuthenticatedContent() {
     const { status, authenticated, setAuthToken } = useWebSocket();
     const [token, setToken] = useState('');
     
     const handleLogin = () => {
       setAuthToken(token);
     };
     
     if (!authenticated) {
       return (
         <div>
           <h2>Login</h2>
           <input 
             type="text" 
             value={token} 
             onChange={e => setToken(e.target.value)} 
             placeholder="Enter JWT token" 
           />
           <button onClick={handleLogin} disabled={status !== 'connected'}>
             Login
           </button>
         </div>
       );
     }
     
     return <PortfolioDisplay />;
   }

   function PortfolioDisplay() {
     const { data, subscribe, request } = useWebSocket();
     
     useEffect(() => {
       subscribe('portfolio');
       request('portfolio', 'getProfile');
     }, [subscribe, request]);
     
     const portfolio = data.portfolio || null;
     
     if (!portfolio) {
       return <div>Loading portfolio...</div>;
     }
     
     return (
       <div>
         <h2>Portfolio</h2>
         <div>Total Value: ${portfolio.totalValue}</div>
         {/* More portfolio data... */}
       </div>
     );
   }
   ```
*/

/* 
   How to use this component in your React app:
   
   1. Copy this file to your project.
   2. Import it in a route or page where you want to show the WebSocket guide and demo:
      
      import WebSocketAPIGuide from './path/to/_WEBSOCKET_API_GUIDE';
      
      function WebSocketTestPage() {
        return (
          <div>
            <h1>WebSocket API Test</h1>
            <WebSocketAPIGuide />
          </div>
        );
      }
      
      export default WebSocketTestPage;
      
   3. Add it to your router:
      
      <Route path="/websocket-api" element={<WebSocketTestPage />} />
      
   4. Now you can access it at /websocket-api in your app.
*/