# Market Data Ingestion

## Architecture Overview

The market data ingestion works through a dual-service architecture:

### 1. TokenSyncService

This service is responsible for fetching external data:

- Makes API calls to external endpoints every 30 seconds
- Retrieves prices from `/prices/bulk` endpoint
- Gets metadata from `/tokens` endpoint
- Validates all token data before storage
- Writes to main application database

### 2. MarketDataService

This service handles internal distribution:

- Connects to dedicated market database (configured via `MARKET_DATABASE_URL`)
- Refreshes token cache every 5 seconds
- Broadcasts updates via WebSockets every 10 seconds

## Data Flow

This two-database approach separates market data from application data:
- **TokenSyncService** handles external API connections and data validation
- **MarketDataService** manages internal distribution and caching

## Data Sources

### Pump.fun API
- Provides new token listings, prices, and metadata
- Endpoints:
  - `https://api.pumpfunapi.org` - Unofficial API base
  - `https://pumpapi.fun/api` - Official API base

### Jupiter API
- Provides DEX price data and swap routes
- Endpoints:
  - `https://price.jup.ag/v6/price` - Price API
  - `https://quote-api.jup.ag/v4/quote` - Quote API
  - `https://token.jup.ag` - Token info API

## Configuration

The TokenSyncService is configured with:
- 30-second check interval
- 3 max retries with 5-second delay
- Circuit breaker with 4 failure threshold
- Configurable API endpoints for prices and tokens

The MarketDataService is configured with:
- 5-second cache refresh interval
- 10-second broadcast interval
- Change-only broadcasts to minimize network traffic

## Data Models

### Token Data
- Symbol, name, price, 24h change
- Market cap, FDV, liquidity, volume
- Social links and website information
- Token address and decimals

## Error Handling

Both services implement:
- Circuit breaker patterns
- Exponential backoff
- Detailed error logging
- Health checks and self-healing