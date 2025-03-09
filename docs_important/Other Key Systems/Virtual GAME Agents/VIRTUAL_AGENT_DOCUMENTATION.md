# Virtual Game Agent Documentation

## Overview

The Virtual Game Agent is an interactive AI character that users can chat with to get help, advice, and information about DegenDuel. The agent is powered by the VIRTUAL Protocol and is integrated into the DegenDuel platform through the `@virtual-protocol/react-virtual-ai` library.

## Technical Implementation

### Component Structure

The Virtual Agent is implemented as a standalone page component:

```
/src/pages/public/game/VirtualAgent.tsx
```

This component uses the `CharacterRoom` component from the VIRTUAL Protocol React SDK to render the 3D character and chat interface.

### Dependencies

- `@virtual-protocol/react-virtual-ai`: The main SDK for the virtual agent
- `VIRTUALS_GAME_SDK_API_KEY`: API key from environment variables

### Configuration

The Virtual Agent uses the following configuration:

```typescript
<CharacterRoom
  initAccessToken={UNSAFE_initAccessToken}
  userName={userName}
  virtualId={1}
  virtualName="Virtual Branch"
  metadata={{
    apiKey: VIRTUALS_GAME_SDK_API_KEY,
    apiSecret: "", // Should be implemented on the backend
    userUid: user?.wallet_address || "guest-user",
    userName: userName,
  }}
/>
```

### Security Considerations

The current implementation uses the `UNSAFE_initAccessToken` function, which is not recommended for production. A server-side token generation approach should be implemented for security.

## Backend Implementation Requirements

To properly secure the Virtual Agent implementation, the backend needs to implement a token generation service. Below are detailed requirements:

### 1. Token Generation Endpoint

Create a new API endpoint that will generate secure tokens for the VIRTUAL Protocol:

```
POST /api/virtual-agent/token
```

**Request body:**
```json
{
  "virtualId": 1,
  "userUid": "user-wallet-address",
  "userName": "User Display Name"
}
```

**Response:**
```json
{
  "token": "[REDACTED_JWT_HEADER]...",
  "expiresAt": "2025-03-01T12:00:00Z"
}
```

### 2. Token Generation Process

1. **Securely store API credentials**:
   - Store the VIRTUAL Protocol API key and secret in secure environment variables on the server
   - NEVER expose these credentials to the client

2. **Authenticate with VIRTUAL API**:
   - Make a server-to-server request to the VIRTUAL Protocol authentication endpoint
   - Use the API key and secret to obtain a runner token
   - VIRTUAL API endpoint: `https://api.virtual.xyz/v1/auth/token`

3. **Generate and sign token**:
   - The token should include:
     - `virtualId`: The ID of the virtual character
     - `userUid`: Unique identifier for the user (wallet address)
     - `userName`: Display name for the user
     - `exp`: Expiration timestamp (recommended: 1 hour)
   - Sign the token using a secure algorithm (HMAC-SHA256 recommended)

4. **Implement caching**:
   - Cache tokens to reduce API calls to the VIRTUAL service
   - Invalidate cache when tokens approach expiration
   - Use a distributed cache if running multiple server instances

### 3. Security Measures

- Use rate limiting to prevent abuse of the token generation endpoint
- Implement proper authentication to ensure only legitimate users can request tokens
- Log all token generation requests for audit purposes
- Rotate secrets periodically

### 4. Error Handling

Implement proper error handling with descriptive error messages:

```json
{
  "error": "token_generation_failed",
  "message": "Failed to generate virtual agent token",
  "details": "Authentication with VIRTUAL API failed"
}
```

### 5. Implementation Example (Node.js)

```javascript
// Example backend implementation (Express.js)
const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Environment variables
const VIRTUAL_API_KEY = process.env.VIRTUAL_API_KEY;
const VIRTUAL_API_SECRET = process.env.VIRTUAL_API_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

// Token cache
const tokenCache = new Map();

router.post('/virtual-agent/token', async (req, res) => {
  try {
    const { virtualId, userUid, userName } = req.body;
    
    // Input validation
    if (!virtualId || !userUid) {
      return res.status(400).json({ 
        error: 'invalid_request', 
        message: 'virtualId and userUid are required' 
      });
    }
    
    // Check cache first
    const cacheKey = `${virtualId}-${userUid}`;
    const cachedToken = tokenCache.get(cacheKey);
    if (cachedToken && new Date(cachedToken.expiresAt) > new Date()) {
      return res.json({ token: cachedToken.token, expiresAt: cachedToken.expiresAt });
    }
    
    // Request new token from VIRTUAL API
    const virtualResponse = await axios.post('https://api.virtual.xyz/v1/auth/token', {
      apiKey: VIRTUAL_API_KEY,
      apiSecret: VIRTUAL_API_SECRET,
      virtualId,
      metadata: {
        userUid,
        userName
      }
    });
    
    if (!virtualResponse.data.token) {
      throw new Error('Failed to get token from VIRTUAL API');
    }
    
    const token = virtualResponse.data.token;
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
    
    // Cache the token
    tokenCache.set(cacheKey, { token, expiresAt });
    
    // Return the token to the client
    return res.json({ token, expiresAt });
    
  } catch (error) {
    console.error('Virtual agent token generation failed:', error);
    return res.status(500).json({
      error: 'token_generation_failed',
      message: 'Failed to generate virtual agent token',
      details: error.message
    });
  }
});

module.exports = router;
```

## Frontend Implementation Updates

Once the backend endpoint is implemented, update the frontend code:

```typescript
// Custom token fetching function for CharacterRoom
const initAccessToken = async (virtualId: number, metadata?: any) => {
  try {
    // Get current user from store
    const { user } = useStore.getState();
    
    // Make request to our backend endpoint
    const response = await fetch('/api/virtual-agent/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        virtualId,
        userUid: user?.wallet_address || 'guest-user',
        userName: user?.nickname || 'Trader'
      }),
      credentials: 'include'
    });
    
    if (!response.ok) {
      throw new Error(`Token generation failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error('Failed to get virtual agent token:', error);
    return '';
  }
};

// Then use this function instead of UNSAFE_initAccessToken
<CharacterRoom
  initAccessToken={initAccessToken}
  userName={userName}
  virtualId={1}
  virtualName="Virtual Branch"
/>
```

## Usage Guidelines

### What the Virtual Agent Can Do

The Virtual Agent is trained to assist users with:

1. **Platform Guidance**: Explaining how to use DegenDuel, navigate the platform, and understand its features
2. **Trading Strategies**: Providing basic trading advice and explaining concepts
3. **Contest Information**: Helping users understand how contests work
4. **User Support**: Answering common questions about the platform

### Administrative Tasks

#### Personality Training

To customize the agent's personality:

1. Access the VIRTUAL Protocol dashboard
2. Navigate to "Virtuals" > "ID: 1" (or your configured virtualId)
3. Update the "Persona" field with a new character description
4. Save changes

#### Knowledge Base Updates

To update what the agent knows:

1. Access the VIRTUAL Protocol dashboard
2. Navigate to "Virtuals" > "ID: 1" > "Knowledge Base"
3. Add or edit entries in the knowledge base
4. Save changes

## Implementation Roadmap

### Phase 1: Basic Implementation (Current)
- 3D character visualization
- Text-based chat interface
- Basic knowledge about DegenDuel

### Phase 2: Enhanced Capabilities
- Personalization based on user history
- Integration with contest data
- Ability to fetch real-time token information

### Phase 3: Advanced Features
- Voice interaction
- Custom animations for different responses
- Integration with other platform features

## Troubleshooting

### Common Issues

1. **Agent Not Loading**
   - Check if the API key is correctly set in the environment variables
   - Verify network connectivity to the VIRTUAL Protocol servers

2. **Agent Not Responding Correctly**
   - Review the knowledge base to ensure it has the correct information
   - Check the console for API errors

3. **3D Model Issues**
   - Ensure WebGL is enabled in the browser
   - Check for console errors related to model loading

## Resource Links

- [VIRTUAL Protocol Documentation](https://virtualprotocol.gitbook.io/whitepaper/)
- [React SDK GitHub Repository](https://github.com/Virtual-Protocol/react-virtual-ai)
- [3D Character Customization Options](https://virtualprotocol.gitbook.io/whitepaper/characters)

## Support

For issues with the Virtual Agent implementation, contact:
- VIRTUAL Protocol Support: support@virtualprotocol.com
- Internal DegenDuel Development Team