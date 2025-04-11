import React, { useState, useEffect, useRef } from 'react';

/**
 * DegenDuel WebSocket API Guide and Demo
 * This component provides both documentation and interactive testing for the WebSocket API
 */
const WebSocketGuide = () => {
  const [connected, setConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [messages, setMessages] = useState([]);
  const [tokens, setTokens] = useState({});
  const [activeTab, setActiveTab] = useState('demo');
  const [topicSubscriptions, setTopicSubscriptions] = useState({
    'market-data': true,
    'portfolio': false,
    'system': true,
    'contest': false,
    'user': false,
    'admin': false,
    'wallet': false,
    'wallet-balance': false,
    'skyduel': false,
    'terminal': false
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
  
  // URL based on environment
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
  
  // Auto-scroll to bottom of message list on new messages
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

  // Code example for server-side broadcasting
  const serverSideCodeExample = `// APPROACH 1: Using service events (for service-to-WebSocket communication)
import serviceEvents from '../utils/service-suite/service-events.js';

// Broadcasting through the service events system
serviceEvents.emit('topic:broadcast', {
  type: 'DATA',
  subtype: 'category',
  action: 'action',
  data: payload
});

// APPROACH 2: Using WSBroadcaster (for advanced features)
import broadcaster from '../utils/websocket-suite/ws-broadcaster.js';

// Topic-based broadcasting
await broadcaster.broadcastToTopic(
  'topic',
  'category',
  'action',
  payload
);

// Role-based targeting
await broadcaster.broadcastToRole(
  'ADMIN',
  'category',
  'action',
  payload
);

// User-specific with persistence
await broadcaster.broadcastToUsers(
  ['wallet1', 'wallet2'],
  'category',
  'action',
  payload,
  { persist: true }
);`;

  return (
    <div className="websocket-guide">
      <h1>DegenDuel WebSocket API Guide</h1>
      
      <div className="tabs">
        <button 
          className={activeTab === 'demo' ? 'active' : ''} 
          onClick={() => setActiveTab('demo')}
        >
          Interactive Demo
        </button>
        <button 
          className={activeTab === 'docs' ? 'active' : ''} 
          onClick={() => setActiveTab('docs')}
        >
          Documentation
        </button>
        <button 
          className={activeTab === 'server' ? 'active' : ''} 
          onClick={() => setActiveTab('server')}
        >
          Server-Side Guide
        </button>
      </div>

      {activeTab === 'demo' && (
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
      )}

      {activeTab === 'docs' && (
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
              <tr>
                <td>terminal</td>
                <td>Terminal data and commands</td>
                <td>No</td>
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
          <p>DegenDuel supports WebAuthn for Face ID, Touch ID, and other FIDO2 compliant biometric authentication methods.</p>
          
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
  "requestId": "req-123"
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
        </div>
      )}

      {activeTab === 'server' && (
        <div className="documentation">
          <h2>Server-Side Broadcasting Guide</h2>
          
          <p>DegenDuel implements two complementary approaches for broadcasting WebSocket messages from the server:</p>
          
          <h3>Broadcasting Approaches</h3>
          
          <h4>1. Service Events (for Service-to-WebSocket Communication)</h4>
          <p>Service events provide a decoupled way for services to trigger WebSocket broadcasts:</p>
          
          <div className="code-example">
            <pre>{`import serviceEvents from '../utils/service-suite/service-events.js';

// Broadcasting through the service events system
serviceEvents.emit('topic:broadcast', {
  type: 'DATA',
  subtype: 'category',
  action: 'action',
  data: payload
});`}</pre>
          </div>
          
          <p><strong>When to use Service Events:</strong></p>
          <ul>
            <li>When broadcasting from a service</li>
            <li>For simple topic-based broadcasting</li>
            <li>When you want loose coupling between services and the WebSocket layer</li>
            <li>For broadcasts that don't need persistence or targeted delivery</li>
          </ul>
          
          <h4>2. WSBroadcaster (for Advanced Broadcasting Features)</h4>
          <p>The WebSocket Broadcaster provides advanced features for direct broadcasts:</p>
          
          <div className="code-example">
            <pre>{`import broadcaster from '../utils/websocket-suite/ws-broadcaster.js';

// Broadcasting with the dedicated utility
await broadcaster.broadcastToTopic(
  'topic',
  'category',
  'action',
  payload
);

// Or for targeting specific user roles
await broadcaster.broadcastToRole(
  'ADMIN',
  'category',
  'action',
  payload
);

// Or for targeting specific users by wallet address
await broadcaster.broadcastToUsers(
  ['wallet1', 'wallet2'],
  'category',
  'action',
  payload,
  { persist: true } // Store for offline delivery
);`}</pre>
          </div>
          
          <p><strong>When to use WSBroadcaster:</strong></p>
          <ul>
            <li>When you need message persistence for offline users</li>
            <li>For role-based or user-targeted broadcasting</li>
            <li>When you need delivery tracking or read receipts</li>
            <li>For high-priority messages that should be stored in the database</li>
          </ul>
          
          <h3>Complete Example</h3>
          
          <div className="code-example">
            <pre>{serverSideCodeExample}</pre>
          </div>
        </div>
      )}
      
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
        
        .tabs {
          display: flex;
          margin-bottom: 20px;
          border-bottom: 1px solid #ddd;
        }
        
        .tabs button {
          padding: 10px 20px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #7f8c8d;
          border-bottom: 3px solid transparent;
          transition: all 0.3s;
        }
        
        .tabs button:hover {
          color: #3498db;
        }
        
        .tabs button.active {
          color: #3498db;
          border-bottom: 3px solid #3498db;
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
        
        .disconnect-button:hover {
          background-color: #c0392b;
        }
        
        .subscribe-button {
          background-color: #2ecc71;
        }
        
        .subscribe-button:hover {
          background-color: #27ae60;
        }
        
        .unsubscribe-button {
          background-color: #f39c12;
        }
        
        .unsubscribe-button:hover {
          background-color: #d35400;
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
        .topic-wallet-balance { background-color: #16a085; }
        .topic-skyduel { background-color: #34495e; }
        .topic-terminal { background-color: #2c3e50; }
        
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
        
        .documentation {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          padding: 20px;
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

export default WebSocketGuide;