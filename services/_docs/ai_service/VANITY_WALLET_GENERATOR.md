# Vanity Wallet Generator

This document provides a comprehensive overview of the Vanity Wallet Generator system used in the DegenDuel platform, specifically focusing on the polling-based architecture implemented for interaction with the GPU server.

## Overview

The Vanity Wallet Generator creates Solana wallet addresses with custom patterns (like "DUEL" or "DEGEN") for branding purposes. This process is computationally intensive and leverages an external GPU server for efficient address generation.

## Polling-Based Architecture

The system implements a polling-based approach for GPU server communication rather than direct API calls:

1. **Client → Server vs. Server → Client**:
   - Traditional: DegenDuel server makes direct API calls to GPU server
   - Polling-based: GPU server polls DegenDuel server for pending jobs

2. **One-way Communication Flow**:
   - Solves the issue of GPU server IP changes (Lambda Labs IP addressing)
   - Only requires GPU server to be able to reach the command server
   - Eliminates need for inbound connections to the GPU server

3. **Database-Driven Job Processing**:
   - All vanity wallet requests stored in database as "pending" jobs
   - GPU server retrieves pending jobs at its own cadence
   - Results submitted back when processing completes
   - System design remains functional even if GPU server restarts

## Key Components

### 1. `VanityApiClient.js`

Located at `/services/vanity-wallet/vanity-api-client.js`, this client handles:

- Creating vanity address requests in the database
- Finding available vanity wallets for contest assignment
- Processing callbacks and results from the GPU server
- Managing wallet usage tracking

Key methods:
```javascript
// Create a request in database (no direct GPU server call)
static async createVanityAddressRequest(options)

// Get available vanity wallet from database
static async getAvailableVanityWallet(pattern = null)

// Mark vanity wallet as used by a contest
static async assignVanityWalletToContest(walletId, contestId)

// Health check for GPU server connectivity
static async checkHealth()
```

### 2. Admin Routes

Located at `/routes/admin/vanity-wallets.js`, these endpoints manage:

- Admin-initiated vanity wallet creation
- Job status inquiries
- GPU server polling interface

Key endpoints:
```javascript
// For admins to request vanity wallets
POST /api/admin/vanity-wallets

// For GPU server to get pending jobs
GET /api/admin/vanity-wallets/jobs/pending

// For GPU server to submit completed job results
POST /api/admin/vanity-wallets/jobs/result
```

### 3. Database Schema

The `vanity_wallet_pool` table in the database tracks:

- Wallet address and encrypted private key
- Pattern to match (e.g., "DUEL" or "DEGEN")
- Status tracking (pending, processing, completed, failed, cancelled)
- Usage information (which contest is using the wallet)
- Generation metrics (attempts, duration)

### 4. ContestWalletService Integration

The `contestWalletService.js` integrates with the vanity wallet system:

- Prioritized search for available vanity wallets
- Assignment of vanity wallets to contests
- Fallback to random wallet generation when needed

## Flow of Operations

### Requesting a Vanity Wallet

1. Admin triggers a request via admin API or scheduled task
2. `VanityApiClient.createVanityAddressRequest()` stores request in database
3. Request enters "pending" state, awaiting GPU server processing

### GPU Server Processing

1. GPU server polls `/api/admin/vanity-wallets/jobs/pending` endpoint
2. Server retrieves pending jobs (up to 5 at a time)
3. Jobs are marked as "processing" when picked up
4. Server performs vanity address generation
5. Results submitted to `/api/admin/vanity-wallets/jobs/result` endpoint

### Using Generated Wallets

1. `contestWalletService.getUnassociatedVanityWallet()` searches database
2. Prioritizes "DUEL" pattern first, then "DEGEN", then any available
3. Selected wallet is assigned to a contest
4. Database updated to mark the wallet as used

## Security Considerations

### IP Validation

Both polling endpoints implement robust IP validation:

```javascript
// Get allowed IPs from config
const allowedIps = config.gpuServer.allowedIps;

// Check if client IP matches any allowed pattern
const isAllowed = allowedIps.some(allowedIp => {
  // Handle wildcard patterns like "192.222.51.*"
  if (allowedIp.includes('*')) {
    const pattern = allowedIp.replace(/\./g, '\\.').replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(ipAddress);
  }
  // Handle exact IP matches
  return allowedIp === ipAddress;
});
```

### IPv6 Handling

The system includes handling for IPv6 formats:

```javascript
// Convert IPv6 loopback to IPv4 format if necessary
let ipAddress = clientIp;
if (ipAddress === '::1' || ipAddress === '::ffff:127.0.0.1') {
  ipAddress = '127.0.0.1';
}

// Remove IPv6 prefix if present
if (ipAddress.startsWith('::ffff:')) {
  ipAddress = ipAddress.substring(7);
}
```

### Private Key Handling

Private keys are never returned directly to clients:

```javascript
// Never return the private key in the response
const response = {
  ...wallet,
  private_key: wallet.private_key ? '[REDACTED]' : null
};
```

## Configuration

The system is configured in `config.js` with these key settings:

```javascript
// GPU Server Configuration
gpuServer: {
  // Allow multiple IPs separated by commas, or IP patterns with wildcards
  // First IP in the list is used as the default when connecting to the server
  allowedIps: (process.env.ALLOWED_GPU_SERVER_IPS || 
    '192.222.51.124,192.222.51.*,127.0.0.1,localhost').split(','),
  port: process.env.GPU_SERVER_PORT || 80,
},
```

## Dynamic IP Discovery

The system implements intelligent IP discovery for the GPU server:

```javascript
// Try nearby IPs (e.g., if IP was 192.222.51.124, try 192.222.51.123 and 192.222.51.125)
const ipParts = global.ACTIVE_GPU_SERVER_IP.split('.');
const lastOctet = parseInt(ipParts[3]);

// Try nearby IPs in this order: current+1, current-1, current+2, current-2, etc.
for (let i = 1; i <= 5; i++) {
  // Try current+i
  if (lastOctet + i <= 255) {
    const ipToTry = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.${lastOctet + i}`;
    if (!serverIpsToTry.includes(ipToTry)) {
      serverIpsToTry.push(ipToTry);
    }
  }
  
  // Try current-i
  if (lastOctet - i >= 0) {
    const ipToTry = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.${lastOctet - i}`;
    if (!serverIpsToTry.includes(ipToTry)) {
      serverIpsToTry.push(ipToTry);
    }
  }
}
```

## Benefits of Polling-Based Approach

1. **Resilient to IP Changes**: System continues working even if GPU server IP changes
2. **Connection Direction**: Only requires GPU server → command server connectivity
3. **Firewall Friendly**: No need to open inbound ports on GPU server
4. **Horizontal Scaling**: Multiple GPU servers can poll for jobs simultaneously
5. **Fault Tolerance**: Jobs remain in database if GPU server restarts
6. **Resource Optimization**: GPU server controls its own processing rate
7. **Simplified Deployment**: Easier configuration of cloud GPU instances

## GPU Server Implementation Guide

For the GPU server implementation:

1. **Poll for Jobs**:
   ```
   GET http://command-server-address/api/admin/vanity-wallets/jobs/pending
   ```

2. **Process Jobs**:
   For each job, use a GPU-accelerated vanity address generator to find a Solana wallet with the requested pattern.

3. **Submit Results**:
   ```
   POST http://command-server-address/api/admin/vanity-wallets/jobs/result
   {
     "id": "123",
     "status": "Completed",
     "result": {
       "address": "DUELxxxx...",
       "keypair_bytes": [...]
     },
     "attempts": 5000000,
     "duration_ms": 15000
   }
   ```

4. **Error Handling**:
   If job fails, submit with status "Failed" and error information:
   ```
   {
     "id": "123",
     "status": "Failed",
     "error": "Reason for failure",
     "attempts": 1000000,
     "duration_ms": 30000
   }
   ```

## Related Documentation

- [Contest Wallet Service Documentation](../contest_wallet_service/README.md)
- [SolanaEngine Documentation](../solana_engine_service/README.md)