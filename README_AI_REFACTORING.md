# AI Service Refactoring

This document outlines the changes made to refactor the AI service, moving from the "terminal" terminology to the more appropriate "ai" naming. This refactoring helps decouple the AI functionality from the UI concept of a terminal, making it more modular and reusable across different UI components.

## Key Changes

### 1. API Endpoint Renaming

| Old Endpoint | New Endpoint | Description |
|--------------|--------------|-------------|
| `/api/terminal/ai-chat` | `/api/ai/response` | Standard AI response endpoint (non-streaming) |
| N/A | `/api/ai/stream` | New streaming endpoint for real-time responses |
| `/api/terminal/token-info/:addressOrSymbol` | `/api/ai/data/:addressOrSymbol` | Direct token data access |

### 2. WebSocket Topic Change

The WebSocket topic has been changed from "terminal" to "ai" to reflect that the API is about AI functionality, not UI concepts:

| Old | New |
|-----|-----|
| `topic: 'terminal'` | `topic: 'ai'` |
| `action: 'ai-query'` | `action: 'query'` |
| N/A | `action: 'stream'` |

### 3. Route File Changes

| Old File | New File | Status |
|----------|----------|--------|
| `/routes/terminal-routes.js` | `/routes/ai-routes.js` | Renamed and updated |
| `/routes/ai.js` | `/routes/ai.js` | Unchanged, kept for backward compatibility |

### 4. Important Implementation Details

1. **Legacy Compatibility**:
   - Legacy `/api/ai` routes remain mounted under `/api/ai` with the maintenance middleware
   - New AI routes are mounted at the same path but without maintenance middleware
   - This means the new AI endpoints will remain available even during site maintenance

2. **Response Structure**:
   - The `usage` property is now stripped from the response objects before being sent to clients
   - This prevents leaking information about our OpenAI API usage and costs

3. **WebSocket Integration**:
   - Added a transition example in `/websocket/v69/transition-examples/ai-transition.js`
   - This demonstrates how to migrate from the old terminal WebSocket to the new unified "ai" topic

## Usage Examples

### HTTP Requests

#### Non-streaming Response
```javascript
// Using fetch API
const response = await fetch('/api/ai/response', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'What is the current price of Solana?' }],
    conversationId: 'optional-conversation-id',
    context: 'terminal' // Options: 'default', 'trading', 'terminal'
  })
});

const result = await response.json();
console.log(result.content); // AI response
```

#### Streaming Response
```javascript
// Using fetch API with streaming
const response = await fetch('/api/ai/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'What is the current price of Solana?' }],
    conversationId: 'optional-conversation-id',
    context: 'terminal'
  })
});

// Create a reader for the stream
const reader = response.body.getReader();
let result = '';

// Process the stream chunks
while (true) {
  const {done, value} = await reader.read();
  if (done) break;
  
  // Convert chunk to text
  const chunk = new TextDecoder().decode(value);
  
  // Update UI with this chunk
  result += chunk;
  updateUI(result); // Your function to update the UI
}
```

#### Direct Token Data
```javascript
// Using fetch API
const response = await fetch('/api/ai/data/SOL');
const tokenData = await response.json();
console.log(tokenData); // Token data object
```

### WebSocket Communication

#### Subscribe to AI Topic
```javascript
// Connect to WebSocket
const ws = new WebSocket('/api/v69/ws');

// Subscribe to AI topic
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  topic: 'ai'
}));
```

#### Send AI Query
```javascript
// Send AI query
ws.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'ai',
  action: 'query',
  data: {
    messages: [{ role: 'user', content: 'What is the current price of Solana?' }],
    conversationId: 'optional-conversation-id',
    context: 'terminal'
  }
}));
```

#### Send Streaming AI Query
```javascript
// Send streaming AI query
ws.send(JSON.stringify({
  type: 'REQUEST',
  topic: 'ai',
  action: 'stream',
  data: {
    messages: [{ role: 'user', content: 'What is the current price of Solana?' }],
    conversationId: 'optional-conversation-id',
    context: 'terminal'
  }
}));
```

#### Handle Response
```javascript
// Handle AI responses
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.topic === 'ai') {
    if (message.subtype === 'response') {
      console.log('AI response:', message.data.content);
    } else if (message.action === 'stream-chunk') {
      console.log('Stream chunk:', message.data.content);
    }
  }
};
```

## Implementation Notes

1. The streaming implementation uses server-sent events (SSE) for HTTP and continuous messages for WebSocket
2. All endpoint responses follow the same error format for consistency
3. Authentication is required for the `/api/ai/response` and `/api/ai/stream` endpoints, but not for `/api/ai/data/:addressOrSymbol`

## Next Steps

1. Update frontend code to use the new endpoints
2. Update WebSocket client code to use the "ai" topic instead of "terminal"
3. Migrate any backend services that call the old endpoints to use the new ones
4. Add deprecation notices to the old endpoint implementations