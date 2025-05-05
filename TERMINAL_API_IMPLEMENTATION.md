# Terminal API Implementation Guide

## Overview

This document provides implementation guidelines for frontend integration with DegenDuel API's Terminal AI service functionality.

## API Endpoints

### 1. Terminal AI Chat Endpoint

```
POST /api/terminal/ai-chat
```

This is the primary endpoint for interacting with "Didi" the AI assistant. It provides token data, platform information, user data, and more through natural language queries.

#### Authentication
- **Required**: Yes, JWT token authentication
- **Header**: `Authorization: Bearer <jwt_token>`

#### Rate Limiting
- 100 requests per 5-minute window (higher for admin/superadmin)

#### Request Format

```typescript
interface TerminalAIChatRequest {
  messages: {
    role: "user" | "assistant";
    content: string;
  }[];
  conversationId?: string; // Optional UUID for continuing conversations
  context?: "default" | "trading" | "terminal"; // Defaults to "terminal"
}
```

#### Example Request

```json
{
  "messages": [
    { "role": "user", "content": "What is the current price of Solana?" }
  ],
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "context": "terminal"
}
```

#### Response Format

```typescript
interface TerminalAIChatResponse {
  content: string;
  functionCalled?: string; // Optional, included if a function was called
  conversationId: string;
}
```

#### Example Response

```json
{
  "content": "The current price of Solana (SOL) is $45.37 USD with a market cap of $18.75B. In the last 24 hours, the price has increased by 3.7% with a trading volume of $750M.",
  "functionCalled": "getTokenPrice",
  "conversationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Error Response Format

```typescript
interface TerminalAIErrorResponse {
  error: string;
  type: "invalid_request" | "authentication" | "rate_limit" | "server" | "unknown";
}
```

### 2. Direct Token Info Endpoint

```
GET /api/terminal/token-info/:addressOrSymbol
```

This endpoint provides token information directly without using natural language processing.

#### Authentication
- **Required**: No
- **Rate Limiting**: Standard platform rate limits apply

#### Request Parameters
- `addressOrSymbol` (path parameter) - Token address or symbol to look up

#### Example Request
```
GET /api/terminal/token-info/SOL
```

#### Response Format

```typescript
interface TokenInfoResponse {
  symbol: string;
  name: string;
  address: string;
  price?: string;
  price_change_24h?: string;
  market_cap?: string;
  volume_24h?: string;
  social_links?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
  tags?: string[];
  is_monitored?: boolean;
}
```

#### Example Response

```json
{
  "symbol": "SOL",
  "name": "Solana",
  "address": "So11111111111111111111111111111111111111112",
  "price": "45.37",
  "price_change_24h": "3.7",
  "market_cap": "18.75B",
  "volume_24h": "750M",
  "social_links": {
    "website": "https://solana.com",
    "twitter": "https://twitter.com/solana",
    "telegram": "https://t.me/solana",
    "discord": "https://discord.com/invite/solana"
  },
  "tags": ["layer1", "smart-contracts"],
  "is_monitored": true
}
```

## WebSocket Integration

For real-time AI responses, you can use the unified WebSocket system:

### Connection

```
WebSocket /api/v69/ws
```

### Subscribe to Terminal Topic

```javascript
// Subscribe to terminal topic
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topic: 'terminal'
}));
```

### Send AI Query via WebSocket

```javascript
// Send AI query
ws.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'terminal',
  action: 'ai-query',
  data: {
    messages: [
      { role: 'user', content: 'What is the current price of Solana?' }
    ],
    conversationId: '550e8400-e29b-41d4-a716-446655440000'
  }
}));
```

### WebSocket Response Format

```javascript
{
  type: 'DATA',
  topic: 'terminal',
  subtype: 'ai-response',
  action: 'query-result',
  data: {
    content: "The current price of Solana (SOL) is $45.37...",
    functionCalled: "getTokenPrice",
    conversationId: "550e8400-e29b-41d4-a716-446655440000"
  },
  timestamp: "2025-05-02T12:34:56.789Z"
}
```

## Frontend Implementation Guide

### Implementation Examples

#### Basic HTTP Implementation

```typescript
/**
 * Terminal Service
 * 
 * This service handles communication with the DegenDuel Terminal AI API.
 */

// Get API URL from environment variables
const API_URL = import.meta.env.VITE_API_URL || 'https://degenduel.me';

// Cache for conversations
const conversationCache = new Map();

/**
 * Send a message to the Terminal AI
 * 
 * @param message The message to send
 * @param conversationId Optional conversation ID to continue a conversation
 * @returns Promise that resolves to the AI response
 */
export const sendTerminalMessage = async (
  message: string, 
  conversationId?: string
): Promise<{
  content: string;
  functionCalled?: string;
  conversationId: string;
}> => {
  try {
    // Get auth token from your auth system
    const token = await getAuthToken();
    
    // Build conversation history
    const messages = [];
    
    // Add previous messages if this is a continuation
    if (conversationId && conversationCache.has(conversationId)) {
      messages.push(...conversationCache.get(conversationId));
    }
    
    // Add the new message
    messages.push({ role: 'user', content: message });
    
    // Send request to Terminal AI API
    const response = await fetch(`${API_URL}/api/terminal/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        messages,
        conversationId,
        context: 'terminal'
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get AI response');
    }
    
    const result = await response.json();
    
    // Update conversation cache
    const newConversationId = result.conversationId || conversationId;
    if (newConversationId) {
      const updatedMessages = [...messages];
      updatedMessages.push({ role: 'assistant', content: result.content });
      conversationCache.set(newConversationId, updatedMessages);
    }
    
    return result;
  } catch (error) {
    console.error('Terminal AI Error:', error);
    throw error;
  }
};

/**
 * Get direct token information
 * 
 * @param tokenAddressOrSymbol Token address or symbol
 * @returns Promise that resolves to token information
 */
export const getTokenInfo = async (tokenAddressOrSymbol: string) => {
  try {
    const response = await fetch(`${API_URL}/api/terminal/token-info/${tokenAddressOrSymbol}`);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to get token information');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Token Info Error:', error);
    throw error;
  }
};
```

#### WebSocket Implementation

```typescript
/**
 * Terminal WebSocket Service
 * 
 * This service handles WebSocket communication with the DegenDuel Terminal.
 */

// Get API URL from environment variables
const API_URL = import.meta.env.VITE_API_URL || 'https://degenduel.me';

// WebSocket connection
let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let messageHandlers: Map<string, (data: any) => void> = new Map();

/**
 * Initialize WebSocket connection
 */
export const initWebSocket = () => {
  try {
    // Check if WebSocket is already connected
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }
    
    // Create WebSocket connection
    ws = new WebSocket(`${API_URL.replace('http', 'ws')}/api/v69/ws`);
    
    // Set event handlers
    ws.onopen = handleOpen;
    ws.onmessage = handleMessage;
    ws.onclose = handleClose;
    ws.onerror = handleError;
  } catch (error) {
    console.error('WebSocket initialization error:', error);
  }
};

/**
 * Send a message to the Terminal AI via WebSocket
 * 
 * @param message The message to send
 * @param conversationId Optional conversation ID to continue a conversation
 * @returns Promise that resolves to the AI response
 */
export const sendTerminalMessageWS = (
  message: string, 
  conversationId?: string
): Promise<{
  content: string;
  functionCalled?: string;
  conversationId: string;
}> => {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }
    
    // Generate request ID
    const requestId = crypto.randomUUID();
    
    // Register message handler
    messageHandlers.set(requestId, (data) => {
      resolve(data);
    });
    
    // Send request
    ws.send(JSON.stringify({
      type: 'REQUEST',
      topic: 'terminal',
      action: 'ai-query',
      requestId,
      data: {
        messages: [{ role: 'user', content: message }],
        conversationId
      }
    }));
    
    // Set timeout for response
    setTimeout(() => {
      messageHandlers.delete(requestId);
      reject(new Error('WebSocket request timed out'));
    }, 30000);
  });
};

// WebSocket event handlers
const handleOpen = () => {
  console.log('WebSocket connected');
  
  // Clear reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  // Subscribe to terminal topic
  if (ws) {
    ws.send(JSON.stringify({
      type: 'SUBSCRIBE',
      topic: 'terminal'
    }));
  }
};

const handleMessage = (event: MessageEvent) => {
  try {
    const message = JSON.parse(event.data);
    
    // Handle terminal messages
    if (message.topic === 'terminal' && message.subtype === 'ai-response') {
      const requestId = message.requestId;
      
      // Find and call the message handler
      if (requestId && messageHandlers.has(requestId)) {
        const handler = messageHandlers.get(requestId);
        messageHandlers.delete(requestId);
        
        if (handler) {
          handler(message.data);
        }
      }
    }
  } catch (error) {
    console.error('WebSocket message handling error:', error);
  }
};

const handleClose = () => {
  console.log('WebSocket closed');
  
  // Reconnect after delay
  reconnectTimeout = setTimeout(() => {
    initWebSocket();
  }, 5000);
};

const handleError = (error: Event) => {
  console.error('WebSocket error:', error);
};
```

### React Component Example

```tsx
import React, { useState, useEffect } from 'react';
import { sendTerminalMessage, getTokenInfo } from '../services/terminalService';

const TerminalChat: React.FC = () => {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  
  useEffect(() => {
    // Add welcome message
    setMessages([
      { 
        role: 'assistant', 
        content: 'Hi, I\'m Didi! I can help you with token information, contests, user profiles, and more. How can I assist you today?' 
      }
    ]);
  }, []);
  
  const handleSendMessage = async () => {
    if (!input.trim()) return;
    
    // Add user message to chat
    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    
    try {
      // Send message to Terminal AI
      const response = await sendTerminalMessage(input, conversationId);
      
      // Add AI response to chat
      setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
      
      // Save conversation ID for continuation
      setConversationId(response.conversationId);
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error processing your request. Please try again later.' 
      }]);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="terminal-chat">
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="loading">Didi is thinking...</div>}
      </div>
      
      <div className="chat-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="Ask Didi about tokens, contests, or platform features..."
          disabled={loading}
        />
        <button onClick={handleSendMessage} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
};

export default TerminalChat;
```

## Available Functions

The Terminal AI service can access rich platform data through these functions:

### Token Data
- Get current price and details for tokens
- Access historical price data for charting
- View liquidity pool information
- Analyze historical metrics

### Contest Information
- View active contests and upcoming events
- Get contest details and prize pools
- Check entry requirements

### User Profiles
- View profiles and achievements
- Access leaderboards by different metrics
- Check contest participation history

### Platform Activity
- View recent transactions and platform events
- Get achievement information
- Track contest results

## Asking For Data

The beauty of the Terminal API is that your frontend doesn't need to know all the available functions - users can simply ask for information in natural language:

### Example Queries

- "What is the current price of Solana?"
- "Show me the top 5 active contests"
- "Who are the top users by contest wins?"
- "What's the trading volume for BONK in the last 24 hours?"
- "Tell me about my recent contest participation"
- "What are the trending tokens today?"

## Error Handling

All terminal endpoints use consistent error response formats:

```typescript
{
  "error": "Error message description",
  "type": "error_type" // One of: invalid_request, authentication, rate_limit, server, unknown
}
```

Common error types:
- `invalid_request`: Malformed request or missing required parameters
- `authentication`: Authentication failed or insufficient permissions
- `rate_limit`: Too many requests in a given timeframe
- `server`: Internal server error processing the request
- `not_found`: Requested resource (e.g., token) not found

## Best Practices

1. **Conversation History**: Maintain conversation history for a better user experience
2. **Error Handling**: Implement robust error handling with user-friendly messages
3. **Loading States**: Show loading indicators during API calls
4. **Caching**: Cache token data to reduce API calls
5. **Suggested Queries**: Provide suggested queries to help users discover functionality
6. **User Context**: When authenticated, provide user context to the AI for personalized responses
7. **WebSocket Preference**: For real-time data, prefer WebSocket connections over HTTP

For questions about this implementation, contact the backend team.