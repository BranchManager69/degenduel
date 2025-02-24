# Token Data API Specification

## Endpoints

### List All Tokens
```http
GET /api/web/v1/tokenData
```
Query Parameters:
- `chain`: Filter by blockchain (SOLANA, EVM)
- `includeInactive`: Include tokens with no recent price updates
- `minLiquidity`: Filter by minimum liquidity in USD

### Get Single Token
```http
GET /api/web/v1/tokenData/:address
```

## Data Sources & Capabilities

### Core Data (30-second updates)
- Price & market data
- Volume across timeframes (5m → 24h)
- Buy/Sell transaction counts
- Unique wallet interactions
- Price change percentages

### Rich Media & Social
- Multiple image formats (logo, banner, thumbnail)
- Multiple social links per platform
- Multiple website URLs supported
- Description and metadata

### Real-time Metrics
```typescript
metrics: {
    volatility: number,      // Price stability indicator
    priceImpact: number,     // Market depth indicator (vol/mcap)
    liquidityScore: number,  // Trading ease indicator
    momentum: number,        // Price trend strength
    activity: {
        txCount24h: number,         // Total transactions
        uniqueWallets24h: number,   // Unique traders
        avgTxValue24h: number       // Avg trade size
    }
}
```

## Response Structure

### List Response
```typescript
{
    tokens: Array<TokenData>,
    timestamp: number,
    metadata: {
        total: number,
        activeTokens: number,
        chain: string,
        includesInactive: boolean,
        minLiquidity: number | null
    }
}
```

### TokenData Structure
```typescript
{
    // Basic Info
    address: string,
    symbol: string,
    name: string,
    decimals: number,
    description?: string,

    // Market Data (as decimal strings)
    price: string,
    market_cap?: string,
    volume: {
        h24?: string,
        h6?: string,
        h1?: string,
        m5?: string
    },
    
    // Price Changes (as decimal strings)
    price_change: {
        h24?: string,
        h6?: string,
        h1?: string,
        m5?: string,
        d7?: string,
        d30?: string
    },

    // Media & Social
    images: {
        token?: string,    // Standard logo
        banner?: string,   // 1500x500
        thumbnail?: string,// Square
        icon?: string,     // Favicon
        additional: string[]
    },
    social_urls?: {
        twitter?: string[],
        telegram?: string[],
        discord?: string[],
        websites?: string[]
    },

    // Trading Activity
    transactions?: {
        h24: { buys: number, sells: number },
        h6: { buys: number, sells: number },
        h1: { buys: number, sells: number },
        m5: { buys: number, sells: number }
    },

    // Status & Metrics
    metadata: {
        chain: string,
        lastUpdate: number,    // Unix ms
        isActive: boolean,
        hasLiquidity: boolean,
        metrics: {
            volatility: number | null,
            priceImpact: number | null,
            liquidityScore: number | null,
            momentum: number | null,
            activity: {
                txCount24h: number,
                uniqueWallets24h: number,
                avgTxValue24h: number | null
            }
        }
    },
    
    timestamp: number         // Unix ms
}
```

## Important Notes

### Data Handling
- Price/volume values are decimal strings (precision)
- Metrics are numbers
- Timestamps are Unix milliseconds
- Optional fields marked with `?`
- Empty arrays/objects included for consistency

### Update Frequencies
- Price/Volume: 30 seconds
- Transactions: Real-time
- Social/Media: Daily refresh
- Metrics: Calculated on request

### Limitations
- 100 most recent price points stored
- Some metrics need minimum activity
- Network delays possible for transactions

## Notes

### Numeric Values
- All price, volume, and market cap values are returned as decimal strings to preserve precision
- Metric values are returned as numbers
- Timestamps are Unix timestamps in milliseconds

### Optional Fields
- Fields marked with `?` are optional and may be `undefined`
- Nested objects will be included even if all their fields are `undefined`

### Metrics Calculation
- **Volatility**: Standard deviation of price returns
- **Price Impact**: (24h Volume / Market Cap) * 100
- **Liquidity Score**: log10(volume * marketCap) / 10
- **Momentum**: Weighted average of price changes with weights:
  - 5m: 0.1
  - 1h: 0.2
  - 6h: 0.3
  - 24h: 0.4

### Time Periods
Standard periods used throughout the API:
- m5: 5 minutes
- h1: 1 hour
- h6: 6 hours
- h24: 24 hours
- d7: 7 days
- d30: 30 days

### Error Response
```typescript
{
    error: string,
    details?: string,
    timestamp: number  // Unix timestamp in milliseconds
}
```

## Available Data Sources

### Token Base Data (from Token table)
- Contract address
- Token name and symbol
- Chain (SOLANA/EVM)
- Decimals
- Description
- Image URLs (multiple formats)
- Creation timestamp
- Last update timestamp

### Price & Market Data (from PriceHistory table)
Updated every 30 seconds for active tokens:
- Current price
- Market capitalization
- Volume (5m, 1h, 6h, 24h intervals)
- Historical price points
- Last update timestamp

### Price Changes (from PriceChanges table)
Percentage changes for multiple time windows:
- 5 minutes
- 1 hour
- 6 hours
- 24 hours
- 7 days
- 30 days

### Transaction Data (from TransactionsJson)
For each time window (5m, 1h, 6h, 24h):
- Buy transactions count
- Sell transactions count
- Unique wallet addresses
- Transaction volume
- Average transaction size

### Social Data (from Socials table)
- Multiple Twitter profiles/links
- Multiple Telegram groups/channels
- Multiple Discord servers
- Multiple website URLs
- Last social update timestamp

### Media Assets (from Token table)
- Token logo (standard square format)
- Banner image (1500x500)
- Thumbnail (small square)
- Icon (favicon format)
- Additional promotional images

### Derived Metrics (Calculated Real-time)
Using the above data sources, we calculate:
1. **Volatility Score**
   - Uses: Price history points
   - Window: Last 100 price updates
   - Updates: Every 30 seconds

2. **Price Impact Score**
   - Uses: 24h volume and market cap
   - Formula: (Volume/MCap) * 100
   - Updates: With each volume update

3. **Liquidity Score**
   - Uses: Volume and market cap
   - Formula: log10(volume * marketCap) / 10
   - Updates: Every 30 seconds

4. **Momentum Score**
   - Uses: Multiple timeframe price changes
   - Weighted average across time periods
   - Updates: With price changes

5. **Activity Metrics**
   - Transaction counts
   - Unique wallet counts
   - Average transaction values
   - Updates: With each new transaction

### Data Freshness
- Price data: 30-second intervals
- Transaction data: Real-time
- Social data: Updated daily
- Market metrics: 30-second intervals
- Derived metrics: Calculated on request

### Data Limitations
- Historical data limited to last 100 price points
- Social data may have gaps for newer tokens
- Some metrics require minimum activity thresholds
- Transaction data may be delayed on congested networks 