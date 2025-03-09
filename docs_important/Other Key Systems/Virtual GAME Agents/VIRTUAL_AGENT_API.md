# Virtual Agent API Documentation

## Overview

This document provides technical details for the DegenDuel Virtual Agent API endpoints. These endpoints are used to securely interact with the VIRTUAL Protocol for the interactive AI characters used in the platform.

## API Endpoints

### Token Generation

**Endpoint:** `POST /api/virtual-agent/token`

Generates a secure token for the VIRTUAL Protocol to authenticate user interactions with virtual agents.

**Authentication Required:** Yes

**Request Body:**
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
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2025-03-01T12:00:00Z"
}
```

**Error Responses:**

- 400 Bad Request: Missing required fields
  ```json
  {
    "error": "invalid_request",
    "message": "virtualId and userUid are required"
  }
  ```

- 401 Unauthorized: User is not authenticated

- 500 Internal Server Error: Failed to generate token
  ```json
  {
    "error": "token_generation_failed",
    "message": "Failed to generate virtual agent token",
    "details": "Error message"
  }
  ```

- 502 Bad Gateway: Virtual API service unavailable
  ```json
  {
    "error": "virtual_api_unavailable",
    "message": "Virtual API service unavailable",
    "details": "No response received from Virtual API"
  }
  ```

### Health Check

**Endpoint:** `GET /api/virtual-agent/health`

Checks the health and connectivity of the VIRTUAL Protocol integration.

**Authentication Required:** No

**Response:**
```json
{
  "status": "healthy",
  "message": "Successfully connected to Virtual API",
  "timestamp": "2025-02-25T12:00:00Z"
}
```

**Possible Status Values:**
- `healthy`: Successfully connected to VIRTUAL API
- `warning`: Connection successful but missing some credentials
- `unhealthy`: Failed to connect to VIRTUAL API

## Implementation Details

### Caching

Token generation requests are cached to reduce API calls to the VIRTUAL service:

- Cache Key Format: `virtual:token:{virtualId}:{userUid}`
- Default TTL: 3500 seconds (just under 1 hour)
- Cache Invalidation: Automatic expiration

### Security Measures

1. **Authentication Requirement**
   - All token generation requests require authenticated users
   - Rate limiting automatically applied via application middleware

2. **API Credentials Security**
   - VIRTUAL API credentials stored as environment variables
   - Never exposed to client-side code

3. **Token Expiration**
   - All generated tokens expire after 1 hour
   - System automatically handles token refreshes

## Configuration

The Virtual Agent system requires the following environment variables:

- `VIRTUAL_API_KEY`: API key for the VIRTUAL Protocol
- `VIRTUAL_API_SECRET`: API secret for the VIRTUAL Protocol

## Frontend Integration

The token generation endpoint should be called by the frontend when initializing the CharacterRoom component:

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

// Then use this function with the CharacterRoom component
<CharacterRoom
  initAccessToken={initAccessToken}
  userName={userName}
  virtualId={1}
  virtualName="Virtual Branch"
/>
```

## Troubleshooting

### Common Issues

1. **"Missing VIRTUAL API credentials" Warning**
   - Solution: Set the `VIRTUAL_API_KEY` and `VIRTUAL_API_SECRET` environment variables

2. **"Token generation failed" Error**
   - Check VIRTUAL API credentials
   - Verify network connectivity to VIRTUAL Protocol API
   - Check API rate limits

3. **Frontend Failing to Connect**
   - Ensure user is authenticated
   - Check browser console for API errors
   - Verify CORS configuration if accessing from different domain