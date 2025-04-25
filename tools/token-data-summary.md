# Token Data Summary Tool

This tool provides comprehensive analytics and visualization for token data in the DegenDuel platform database. It helps monitor token tracking, historical data coverage, and trends across all token metrics.

## Features

- **Dashboard Overview**: Shows counts of tokens and historical data records
- **Data Coverage Analysis**: Reports on percentage of tokens with complete metric data
- **Timeline Visualization**: Shows when tokens were first tracked with granular time details
- **Price Movement Analysis**: Identifies biggest price movers in the specified timeframe
- **Metric Trend Analysis**: Analyzes trends for price, volume, liquidity, or market cap
- **Data Integrity Checks**: Reports on tokens missing critical data
- **CSV Export**: Export token data to CSV files for external analysis
- **Token History Details**: Shows detailed metric history for specific tokens
- **Single Token Focus**: Detailed analysis of a specific token's performance and history

## Usage

The tool can be run with various filtering and visualization options:

```bash
# Standard view with defaults
npm run summary

# Show only last 7 days of data
npm run summary -- --days 7

# Sort tokens by volume instead of default market cap
npm run summary -- --sort volume

# Show top 20 tokens instead of default 10
npm run summary -- --limit 20

# Focus on newly added tokens
npm run summary -- --new-only

# Analyze price trends specifically
npm run summary -- --metric price

# Export data to CSV
npm run summary -- --export-csv

# Focus on a specific token by symbol
npm run summary -- --token SOL

# Focus on a specific token by address (for tokens with duplicate symbols)
npm run summary -- --address So11111111111111111111111111111111111111112

# Combine multiple options
npm run summary -- --days 7 --token bonk
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--days <number>` | Number of days to analyze | 30 |
| `--sort <metric>` | Metric to sort tokens by (market_cap, price, volume, liquidity) | market_cap |
| `--limit <number>` | Maximum number of tokens to display | 10 |
| `--new-only` | Focus only on newly added tokens | false |
| `--metric <metric>` | Specific metric to analyze (price, volume, liquidity, market_cap, all) | all |
| `--export-csv` | Export token data to CSV file | false |
| `--token <symbol>` | Show detailed analysis for a specific token by symbol | none |
| `--address <address>` | Show detailed analysis for a specific token by address | none |

## Handling Duplicate Symbols

In crypto, multiple tokens can have the same symbol or ticker. This tool handles this in two ways:

1. When you use `--token <symbol>` and multiple matches are found:
   - The tool will show a list of all matching tokens with their addresses and market data
   - It automatically selects the token with the highest market cap
   - It provides instructions for looking up a specific token by address

2. To view a specific token when duplicates exist:
   - Use `--address <token_address>` to specify the exact token you want to analyze

## Visual Elements

The tool uses colored boxes and visual indicators to make data easier to understand:

- **NEW**: Highlights tokens added within the specified timeframe
- **Age Indicators**: Shows how long new tokens have been tracked (in hours)
- **Timeline**: Visual representation of when tokens were first tracked and their data coverage
- **Color Coding**: Uses different colors to indicate data volume and token status

## Data Tables

The summary displays several important data tables:

1. **Table Counts**: Number of records in each token-related table
2. **Data Coverage**: Percentage of tokens with various metrics
3. **Last Updates**: Time of most recent data updates
4. **Top Tokens**: Highest ranked tokens by selected metric
5. **Biggest Price Movers**: Tokens with largest price changes
6. **Data Integrity**: Tokens missing critical data
7. **History Entries**: History data points by day
8. **Token Timeline**: When tokens were first tracked and their history

## Integration

This tool is integrated with the DegenDuel platform and works directly with the Prisma database schema. It displays data from the following tables:

- tokens
- token_prices
- token_price_history
- token_volume_history
- token_liquidity_history
- token_market_cap_history
- token_rank_history

## Export Functionality

When using the `--export-csv` option, token data is exported to CSV files in the `data/exports` directory. Files are timestamped for easy identification.