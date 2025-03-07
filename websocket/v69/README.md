# DegenDuel WebSocket System v69

A modern, robust WebSocket implementation with enhanced authentication, channel subscriptions, and improved performance.

## Architecture

The v69 WebSocket system runs in parallel with the existing WebSocket implementation, allowing for gradual migration without disrupting the current services.

### Key Features

- **Enhanced Authentication**: JWT validation with support for multiple token sources
- **Channel Subscriptions**: WebSocket pub/sub with fine-grained access control
- **Public/Private Endpoints**: Support for both authenticated and public access
- **Performance Metrics**: Detailed monitoring of connections and message flow
- **Security Protections**: Rate limiting, payload validation, and proper error handling

## Available WebSockets

| WebSocket                | Endpoint                  | Description                 | Authentication |
|--------------------------|---------------------------|-----------------------------|----------------|
| Monitor WebSocket        | `/api/v69/ws/monitor`     | System status and monitoring| Optional       |
| Contest WebSocket        | `/api/v69/ws/contest`     | Contest data and chat rooms | Optional       |

## Test Client

A comprehensive test client is provided at `websocket/v69/test-client.js`. This client allows you to test all v69 WebSocket implementations with a consistent interface.

### Usage

```bash
# Basic connection to Monitor WebSocket
node websocket/v69/test-client.js monitor

# With authentication
node websocket/v69/test-client.js monitor --auth YOUR_TOKEN

# Subscribe to a specific channel
node websocket/v69/test-client.js monitor --channel system.status

# Run automated test suite
node websocket/v69/test-client.js monitor --test
```

### Available Commands

Once connected, you can use these commands:

- `help` - Show available commands
- `quit` - Close connection and exit
- `subscribe <channel>` - Subscribe to a channel
- `unsubscribe <channel>` - Unsubscribe from a channel
- `status` - Show connection status
- `clear` - Clear console
- `send <json>` - Send a custom message
- `ping` - Send heartbeat message
- `verbose` - Toggle verbose output
- `json` - Toggle JSON formatting

## Channels

Each WebSocket defines its own set of channels that clients can subscribe to:

### Monitor WebSocket Channels

- `system.status` - Real-time system status updates
- `system.maintenance` - Maintenance mode changes
- `system.settings` - System settings changes (admin only)
- `public.background_scene` - Public background scene setting (no auth required)
- `services` - Service status changes (admin only)

### Contest WebSocket Channels

- `contest.{contestId}` - Updates for a specific contest
- `leaderboard.{contestId}` - Leaderboard updates for a contest
- `chat.{contestId}` - Chat messages for a contest room
- `participant.{walletAddress}.{contestId}` - User participation status
- `admin.contests` - Admin-specific contest updates
- `public.contests` - Public contest data for spectators
- `public.contest.{contestId}` - Public data for a specific contest
- `user.{walletAddress}` - User-specific contest updates

## Authentication

To authenticate, you need to obtain a token from the `/api/auth/token` endpoint. This token can be passed to the WebSocket in several ways:

1. **Query Parameter**: `?token=YOUR_TOKEN`
2. **WebSocket Protocol**: In the Sec-WebSocket-Protocol header
3. **Authorization Header**: For HTTP/2 connections

## Next Steps

Future WebSocket implementations planned:

1. **Token Data WebSocket** (`/api/v69/ws/token-data`)
   - Real-time token price and metadata updates
   - Token whitelist changes
   - Market data streaming

2. **Contest WebSocket** (`/api/v69/ws/contest`)
   - Contest state changes
   - Participation updates
   - Leaderboard updates