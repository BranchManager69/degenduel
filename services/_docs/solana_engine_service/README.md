# SolanaEngine

## Overview

SolanaEngine is a comprehensive integration layer for Solana blockchain operations, combining premium APIs from Helius and Jupiter to provide a robust and reliable service for all Solana-related functionality in DegenDuel.

## Architecture

![SolanaEngine Architecture](https://mermaid.ink/img/pako:eNp1kU1rwzAMhv-K0WmD_YJedtihh8FgpYcdg4lsZ8HxB7YzuhD877PjtCntsJOk95HQK83QWIUQocOmF5_SvDWdtMpodhrRo-nX2FuTixZ_EJWgyjrUiJ-g0Qth17K-ZV0rhUP8NL7_Gf22PWSFWXijZBrn-6Io9UmVg08PeblZwslOdCOqNl5OmGhJQTF6TnFl8EDY460r7aOQTzZTsqDOihJXeafTm5Cx5iCJvDPH2Zr4FDnfAcdQUyFDpxKM85XECLnqOkiUwMYq-vGZDtfQLqB1mwu1bQYPM5z4cPENa5LgL5NGDCsY-nD2Soc77w89Q95aJ9pJxP95zVZIvOZNM2_HnuY7tUdqVA?type=png)

### Core Components

1. **SolanaEngine Service**:
   - Central orchestration layer
   - Manages client lifecycle
   - Provides unified API for applications
   - Handles caching and data transformation

2. **Helius Client**:
   - Blockchain data access
   - Token metadata retrieval
   - Wallet operations
   - Transaction history

3. **Jupiter Client**:
   - Market price data
   - Token price updates (automatic polling disabled by default)
   - Swap quotes and trading functionality
   - Token liquidity information
   
   > **IMPORTANT**: As of April 2025, Jupiter Client's automatic polling is disabled by default. The Token Refresh Scheduler is now the primary mechanism for token price updates. See [Rate Limiting Documentation](./RATE_LIMITING.md) for details.

4. **DexScreener Client**:
   - Token profiles and boost information
   - Trading pair details and pool data 
   - Order information for tokens
   - Search functionality for pairs
   - Provides complementary market data from a different source

### Data Flow

1. Applications interact with the SolanaEngine service through its API
2. SolanaEngine determines which client to use based on the request type
3. Data is retrieved from the appropriate client
4. Results are cached in Redis for performance
5. Transformed data is returned to the application

### Integration Points

- **Redis**: Used for caching token data, metadata, and prices
- **WebSocket Server**: Used for real-time data distribution to clients
- **Service Manager**: Manages service lifecycle and dependencies

## Features

### Token Operations

- Comprehensive token metadata retrieval
- Real-time token price tracking
- Historical price data
- Token discovery and search

### Wallet Operations

- Wallet balance tracking
- Token holdings enumeration
- Transaction history retrieval
- Multi-wallet monitoring

### Transaction Operations

- Swap quote generation
- Transaction construction and signing
- Transaction submission and confirmation
- Transaction monitoring

## Implementation Details

### Redis Caching Strategy

Data is cached in Redis with appropriate TTLs:
- Token metadata: 24 hours
- Token prices: 1 hour
- Wallet balances: 5 minutes
- Transaction data: 10 minutes

### WebSocket Subscription Model

Applications can subscribe to real-time updates for:
- Token prices
- Wallet balances
- Transaction status

### Error Handling

- Circuit breaker pattern for API rate limiting
- Automatic retry with exponential backoff
- Fallback mechanisms for critical operations
- Detailed error logging and reporting
- Lock mechanism to prevent concurrent API calls
- Rate limiting with adaptive backoff

For details on the rate limiting improvements, see the [Rate Limiting Documentation](./RATE_LIMITING.md).

## Usage Examples

### Token Metadata Retrieval

```javascript
// Get complete metadata for a token
const tokenData = await solanaEngine.getTokenData(['tokenMintAddress1', 'tokenMintAddress2']);
```

### Price Subscription

```javascript
// Subscribe to price updates for specific tokens
// Note: As of April 2025, this does NOT automatically start polling
// The Token Refresh Scheduler will handle price updates
await solanaEngine.subscribeToTokenPrices(['tokenMintAddress1', 'tokenMintAddress2']);

// To explicitly enable automatic polling (not recommended)
solanaEngine.jupiterClient.setAutomaticPolling(true);
```

### Wallet Monitoring

```javascript
// Get token holdings for a wallet
const walletTokens = await solanaEngine.getWalletTokens('walletAddress');
```

### Swap Operations

```javascript
// Get a swap quote
const quote = await solanaEngine.getSwapQuote({
  inputMint: 'inputTokenAddress',
  outputMint: 'outputTokenAddress',
  amount: '1000000000' // Amount in lamports
});
```

## Configuration

SolanaEngine can be configured through the DegenDuel configuration system:

```javascript
// In config.js
module.exports = {
  // ...
  solanaEngine: {
    helius: {
      apiKey: process.env.HELIUS_API_KEY,
      rpcEndpoint: process.env.HELIUS_RPC_ENDPOINT,
    },
    jupiter: {
      apiKey: process.env.JUPITER_API_KEY,
    },
    cache: {
      tokenTtl: 86400, // 24 hours in seconds
      priceTtl: 3600,  // 1 hour in seconds
    }
  }
};
```

## Future Enhancements

1. **Volume Generation**:
   - Automated volume generation for tokens
   - Configurable strategies based on token performance

2. **Enhanced Analytics**:
   - Token performance metrics
   - Market trend analysis
   - Wallet activity profiling

3. **Advanced Trading**:
   - Limit orders
   - Dollar-cost averaging
   - Automated trading strategies

4. **Risk Management**:
   - Slippage protection
   - Transaction simulation
   - Smart failure recovery