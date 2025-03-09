# Admin API Overview

This document provides an overview of the key admin APIs in the DegenDuel system, their locations in the codebase, and how they can be utilized by the frontend.

## Where These APIs Exist

The APIs I mentioned are defined in Swagger documentation files, but they correspond to actual route handlers in your backend:

1. **Wallet Management API**
   - Documentation: `/docs/swagger/admin-wallet-management.js`
   - Actual route handler: `/routes/admin/wallet-management.js`
   - API endpoints begin with: `/api/admin/wallets/...`

2. **Analytics Dashboard API**
   - Documentation: `/docs/swagger/admin-analytics-dashboard.js`
   - Actual route handler: `/routes/admin/analytics-dashboard.js`
   - API endpoints begin with: `/api/admin/analytics-dashboard/...`

3. **Contest Management API**
   - Documentation: `/docs/swagger/admin-contest-management.js`
   - Actual route handler: `/routes/admin/contest-management.js`
   - API endpoints begin with: `/api/admin/contests/...`

## How the Frontend Should Use These APIs

You're right to question this - it appears these APIs might not be utilized effectively by the frontend. Here's how they would typically be used:

### Wallet Management API Usage

The frontend would make HTTP requests to endpoints like:
```javascript
// Example: Get wallet details
fetch('/api/admin/wallets/wallet/[address]', {
  headers: { 'Authorization': 'Bearer [token]' }
})
.then(response => response.json())
.then(data => {
  // Process wallet details
});

// Example: Transfer SOL between wallets
fetch('/api/admin/wallets/transfer/sol', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer [token]'
  },
  body: JSON.stringify({
    fromWallet: "source-address",
    toWallet: "destination-address",
    amount: 1.5
  })
})
.then(response => response.json())
.then(data => {
  // Handle transfer result
});
```

### Analytics Dashboard API Usage

```javascript
// Example: Get real-time analytics
fetch('/api/admin/analytics-dashboard/realtime', {
  headers: { 'Authorization': 'Bearer [token]' }
})
.then(response => response.json())
.then(data => {
  // Update dashboard with real-time metrics
});

// Example: Get user journey data
fetch('/api/admin/analytics-dashboard/user/[walletAddress]/journey', {
  headers: { 'Authorization': 'Bearer [token]' }
})
.then(response => response.json())
.then(data => {
  // Display user journey visualization
});
```

## The Interesting Twist: SkyDuel System

I notice in the attached `UNIFIED_SERVICE_MANAGEMENT.md` document that there's a much more advanced service management system called "SkyDuel" being described. This system appears to be designed to supersede many of these individual admin APIs with a unified WebSocket-based approach.

SkyDuel would provide:
- Real-time service monitoring
- Service control (start/stop/restart)
- Circuit breaker management
- Dependency visualization

If SkyDuel is implemented or being implemented, it represents a more modern approach than the REST APIs I highlighted. It would use WebSockets for real-time communication rather than polling REST endpoints:

```javascript
// SkyDuel client usage example
const client = new SkyDuelClient(origin, token);
client.connect();

client.on('all-states', (states) => {
  // Update UI with service states
});

// Control services
client.startService('tokenSyncService');
client.resetCircuitBreaker('walletService');
```

## Why You Might Not Be Using These Effectively

There could be several reasons:

1. **Documentation/Implementation Gap**: The Swagger docs we created might not perfectly match the actual implementation

2. **Frontend Integration**: The frontend might not be fully utilizing these APIs yet

3. **Evolution to SkyDuel**: The plan might be to migrate from these REST APIs to the SkyDuel WebSocket system

4. **Admin vs User Focus**: Your frontend may focus more on user-facing features rather than admin capabilities

The SkyDuel system described in the document seems to be a more comprehensive and modern approach to service management than the individual REST APIs, suggesting your development might be moving in that direction. 