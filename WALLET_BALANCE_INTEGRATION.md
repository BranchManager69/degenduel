# DegenDuel Wallet Balance Integration Guide

This guide explains how to integrate with the DegenDuel WebSocket-based wallet balance tracking system. The system provides real-time updates of both native SOL balances and DD token balances.

## Overview

The wallet balance tracking system uses WebSockets to provide real-time updates when wallet balances change. Instead of polling for balance changes, clients subscribe to balance updates through the WebSocket connection and receive push notifications whenever balances change.

### Key Features

- **Real-time Updates**: Balance changes are pushed to clients immediately when detected on the blockchain
- **WebSocket-based**: No need for polling, reducing server load and bandwidth
- **Separate Channels**: Separate channels for SOL and DD token balances
- **Subscription Model**: Clients can subscribe and unsubscribe to balance updates as needed
- **Automatic Reconnection**: WebSocket clients handle reconnection automatically

## Integration

### WebSocket Connection

First, establish a WebSocket connection to the DegenDuel WebSocket server:

```javascript
const wsUrl = 'wss://api.degenduel.com/ws';
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  console.log('Connected to DegenDuel WebSocket');
  // Authenticate after connection (required)
  authenticate();
};

ws.onclose = () => {
  console.log('Disconnected from DegenDuel WebSocket');
  // Implement reconnection logic here
};

ws.onerror = (error) => {
  console.error('WebSocket error:', error);
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleMessage(message);
};

// Authentication function
function authenticate() {
  const authMessage = {
    type: 'AUTHENTICATE',
    token: 'your-auth-token' // Get this from your authentication process
  };
  ws.send(JSON.stringify(authMessage));
}

// Message handler
function handleMessage(message) {
  switch (message.type) {
    case 'AUTHENTICATED':
      console.log('Authentication successful');
      // Now you can subscribe to balance updates
      subscribeToBalances();
      break;
    case 'TOKEN_BALANCE_UPDATE':
      console.log('Token balance update:', message);
      // Update UI with new token balance
      updateTokenBalanceUI(message.balance);
      break;
    case 'SOLANA_BALANCE_UPDATE':
      console.log('SOL balance update:', message);
      // Update UI with new SOL balance
      updateSolBalanceUI(message.balance);
      break;
    // Handle other message types
  }
}
```

### Subscribing to Balance Updates

After authenticating, you can subscribe to balance updates:

```javascript
// Subscribe to both SOL and token balance updates
function subscribeToBalances() {
  // Subscribe to token balance updates
  const tokenSubscription = {
    type: 'SUBSCRIBE',
    resource: 'token_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(tokenSubscription));

  // Subscribe to SOL balance updates
  const solSubscription = {
    type: 'SUBSCRIBE',
    resource: 'solana_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(solSubscription));
}
```

### Handling Balance Updates

The server will send balance updates in the following format:

```javascript
// Token balance update
{
  type: 'TOKEN_BALANCE_UPDATE',
  walletAddress: 'the-wallet-address',
  balance: 1000.50, // Formatted as a number with proper decimals
  lastUpdated: 1649267965000, // Timestamp of the last update
  timestamp: '2023-04-06T12:34:56.789Z' // ISO string of when the message was sent
}

// SOL balance update
{
  type: 'SOLANA_BALANCE_UPDATE',
  walletAddress: 'the-wallet-address',
  balance: 5.75, // SOL amount with proper decimals
  lastUpdated: 1649267965000, // Timestamp of the last update
  timestamp: '2023-04-06T12:34:56.789Z' // ISO string of when the message was sent
}
```

### Unsubscribing from Balance Updates

When you no longer need balance updates, you can unsubscribe:

```javascript
// Unsubscribe from token balance updates
function unsubscribeFromTokenBalance() {
  const unsubscribeMessage = {
    type: 'UNSUBSCRIBE',
    resource: 'token_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(unsubscribeMessage));
}

// Unsubscribe from SOL balance updates
function unsubscribeFromSolBalance() {
  const unsubscribeMessage = {
    type: 'UNSUBSCRIBE',
    resource: 'solana_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(unsubscribeMessage));
}
```

### Manual Refresh

If you need to force a refresh of a balance, you can request it:

```javascript
// Refresh token balance
function refreshTokenBalance() {
  const refreshMessage = {
    type: 'REFRESH',
    resource: 'token_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(refreshMessage));
}

// Refresh SOL balance
function refreshSolBalance() {
  const refreshMessage = {
    type: 'REFRESH',
    resource: 'solana_balance',
    walletAddress: 'your-wallet-address' // Optional, defaults to your authenticated wallet
  };
  ws.send(JSON.stringify(refreshMessage));
}
```

## React Integration Example

Here's an example of how to integrate with React:

```jsx
import React, { useEffect, useState, useRef } from 'react';

function WalletBalanceDisplay({ authToken, walletAddress }) {
  const [tokenBalance, setTokenBalance] = useState(0);
  const [solBalance, setSolBalance] = useState(0);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    // Initialize WebSocket connection
    const wsUrl = 'wss://api.degenduel.com/ws';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setConnected(true);
      
      // Authenticate
      ws.send(JSON.stringify({
        type: 'AUTHENTICATE',
        token: authToken
      }));
    };

    ws.onclose = () => {
      console.log('WebSocket connection closed');
      setConnected(false);
      
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current === ws) { // Only reconnect if this is still the current ws
          console.log('Attempting to reconnect...');
          // The useEffect cleanup will handle the old connection
          // and the useEffect will run again to create a new one
          setConnected(false);
        }
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'AUTHENTICATED':
          // Subscribe to balance updates
          ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            resource: 'token_balance',
            walletAddress
          }));
          
          ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            resource: 'solana_balance',
            walletAddress
          }));
          break;
          
        case 'TOKEN_BALANCE_UPDATE':
          setTokenBalance(message.balance);
          break;
          
        case 'SOLANA_BALANCE_UPDATE':
          setSolBalance(message.balance);
          break;
          
        default:
          // Handle other message types
          break;
      }
    };

    // Cleanup function
    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [authToken, walletAddress]);

  const refreshBalances = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Refresh token balance
      wsRef.current.send(JSON.stringify({
        type: 'REFRESH',
        resource: 'token_balance',
        walletAddress
      }));
      
      // Refresh SOL balance
      wsRef.current.send(JSON.stringify({
        type: 'REFRESH',
        resource: 'solana_balance',
        walletAddress
      }));
    }
  };

  return (
    <div className="wallet-balance">
      <h2>Wallet Balance</h2>
      <div className="connection-status">
        Status: {connected ? 'Connected' : 'Disconnected'}
      </div>
      <div className="balances">
        <div className="token-balance">
          <h3>DD Token Balance</h3>
          <p>{tokenBalance.toLocaleString()} DD</p>
        </div>
        <div className="sol-balance">
          <h3>SOL Balance</h3>
          <p>{solBalance.toLocaleString()} SOL</p>
        </div>
      </div>
      <button onClick={refreshBalances} disabled={!connected}>
        Refresh Balances
      </button>
    </div>
  );
}

export default WalletBalanceDisplay;
```

## Vue.js Integration Example

Here's an example of how to integrate with Vue.js:

```vue
<template>
  <div class="wallet-balance">
    <h2>Wallet Balance</h2>
    <div class="connection-status">
      Status: {{ connected ? 'Connected' : 'Disconnected' }}
    </div>
    <div class="balances">
      <div class="token-balance">
        <h3>DD Token Balance</h3>
        <p>{{ formattedTokenBalance }} DD</p>
      </div>
      <div class="sol-balance">
        <h3>SOL Balance</h3>
        <p>{{ formattedSolBalance }} SOL</p>
      </div>
    </div>
    <button @click="refreshBalances" :disabled="!connected">
      Refresh Balances
    </button>
  </div>
</template>

<script>
export default {
  name: 'WalletBalanceDisplay',
  
  props: {
    authToken: {
      type: String,
      required: true
    },
    walletAddress: {
      type: String,
      required: true
    }
  },
  
  data() {
    return {
      ws: null,
      connected: false,
      tokenBalance: 0,
      solBalance: 0
    };
  },
  
  computed: {
    formattedTokenBalance() {
      return this.tokenBalance.toLocaleString();
    },
    
    formattedSolBalance() {
      return this.solBalance.toLocaleString();
    }
  },
  
  methods: {
    initWebSocket() {
      const wsUrl = 'wss://api.degenduel.com/ws';
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = this.handleOpen;
      this.ws.onclose = this.handleClose;
      this.ws.onerror = this.handleError;
      this.ws.onmessage = this.handleMessage;
    },
    
    handleOpen() {
      console.log('Connected to WebSocket');
      this.connected = true;
      
      // Authenticate
      this.ws.send(JSON.stringify({
        type: 'AUTHENTICATE',
        token: this.authToken
      }));
    },
    
    handleClose() {
      console.log('WebSocket connection closed');
      this.connected = false;
      
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        console.log('Attempting to reconnect...');
        this.initWebSocket();
      }, 3000);
    },
    
    handleError(error) {
      console.error('WebSocket error:', error);
    },
    
    handleMessage(event) {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'AUTHENTICATED':
          // Subscribe to balance updates
          this.ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            resource: 'token_balance',
            walletAddress: this.walletAddress
          }));
          
          this.ws.send(JSON.stringify({
            type: 'SUBSCRIBE',
            resource: 'solana_balance',
            walletAddress: this.walletAddress
          }));
          break;
          
        case 'TOKEN_BALANCE_UPDATE':
          this.tokenBalance = message.balance;
          break;
          
        case 'SOLANA_BALANCE_UPDATE':
          this.solBalance = message.balance;
          break;
      }
    },
    
    refreshBalances() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Refresh token balance
        this.ws.send(JSON.stringify({
          type: 'REFRESH',
          resource: 'token_balance',
          walletAddress: this.walletAddress
        }));
        
        // Refresh SOL balance
        this.ws.send(JSON.stringify({
          type: 'REFRESH',
          resource: 'solana_balance',
          walletAddress: this.walletAddress
        }));
      }
    }
  },
  
  mounted() {
    this.initWebSocket();
  },
  
  beforeUnmount() {
    // Clean up WebSocket connection
    if (this.ws) {
      this.ws.close();
    }
  }
};
</script>

<style scoped>
.wallet-balance {
  padding: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  margin-bottom: 20px;
}

.connection-status {
  margin-bottom: 15px;
  font-weight: bold;
}

.balances {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
}

.token-balance, .sol-balance {
  flex: 1;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 5px;
}

button {
  padding: 8px 16px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background-color: #cccccc;
  cursor: not-allowed;
}
</style>
```

## Error Handling

The server may return error messages in the following format:

```javascript
{
  type: 'ERROR',
  code: 'ERROR_CODE', // One of the error codes listed below
  message: 'Human-readable error message',
  timestamp: '2023-04-06T12:34:56.789Z'
}
```

Common error codes:

- `INVALID_PARAMS`: Missing or invalid parameters in the request
- `INVALID_WALLET_ADDRESS`: The wallet address provided is not valid
- `UNAUTHORIZED`: You're not authorized to access the requested resource
- `SUBSCRIPTION_ERROR`: Error subscribing to the requested resource
- `REFRESH_ERROR`: Error refreshing the requested resource
- `TOKEN_ADDRESS_MISSING`: The token address is not configured

## Security Considerations

1. **Authentication**: All WebSocket connections require authentication.
2. **Wallet Address Validation**: Only allow subscription to your own wallet address.
3. **Rate Limiting**: Don't send too many requests in a short period.
4. **Error Handling**: Properly handle errors from the server.

## Troubleshooting

If you encounter issues with the WebSocket connection:

1. **Check Authentication**: Make sure you're properly authenticated.
2. **Inspect WebSocket Status**: Check if the WebSocket is open before sending messages.
3. **Handle Reconnection**: Implement proper reconnection logic.
4. **Check Console Errors**: Look for error messages in the browser console.
5. **Validate Wallet Address**: Ensure the wallet address is in the correct format.

## Next Steps

For more information or support, please contact the DegenDuel development team.