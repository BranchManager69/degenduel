# LiquiditySim - Token Liquidation Simulation Service

A comprehensive service for simulating token liquidation strategies under different market conditions, accounting for position size constraints, price impact limitations, and volume-based selling strategies.

## Overview

The LiquiditySim service allows you to simulate various liquidation strategies for token positions, considering:

1. **Position size constraints** - Never sell more tokens than you own
2. **Price impact limitations** - Maximum allowable price impact per day
3. **Volume-based selling limits** - Selling as a percentage of daily volume
4. **Market scenario simulations** - Base, bull, and bear market scenarios
5. **Dynamic price and volume models** - Realistic market conditions simulation

## API Endpoints

The following API endpoints are available for the LiquiditySim service:

### Get Volume Profile Presets

```
GET /api/admin/token-liquidation/presets
```

Returns a list of available volume profile presets for simulation (base case, bull case, bear case, etc.).

### Get Token Information

```
GET /api/admin/token-liquidation/token-info/:tokenAddress
```

Fetches token information for the given token address, including price, market cap, liquidity, reserves, and supply.

### Run Simulation

```
POST /api/admin/token-liquidation/simulate
```

Runs a token liquidation simulation with the given parameters.

**Request Body:**
```json
{
  "totalSupply": 1000000000,
  "currentPrice": 0.05,
  "baseReserve": 15000000,
  "quoteReserve": 5000,
  "acquisitionLevel": "medium",
  "personalRatio": 0.5,
  "days": 180,
  "scenarioType": "baseCase",
  "calculateExact": true,
  "includeDailyDetails": true
}
```

### Run Grid Simulation

```
POST /api/admin/token-liquidation/simulation-grid
```

Runs a grid of simulations for different acquisition levels and scenarios.

**Request Body:**
```json
{
  "totalSupply": 1000000000,
  "currentPrice": 0.05,
  "baseReserve": 15000000,
  "quoteReserve": 5000,
  "personalRatio": 0.5,
  "acquisitionLevels": ["low", "medium", "high"],
  "scenarios": ["baseCase", "bullCase", "bearCase"],
  "days": 180,
  "calculateExact": false
}
```

### Calculate Maximum Tokens for Price Impact

```
POST /api/admin/token-liquidation/get-max-tokens
```

Calculates the maximum number of tokens that can be sold with a given price impact.

**Request Body:**
```json
{
  "maxPriceImpactPct": -5.0,
  "poolBaseReserve": 15000000,
  "poolQuoteReserve": 5000,
  "exact": true
}
```

### Simulate Selling Tokens

```
POST /api/admin/token-liquidation/simulate-sell
```

Simulates selling a specific amount of tokens and calculates the price impact.

**Request Body:**
```json
{
  "tokenAmount": 1000000,
  "poolBaseReserve": 15000000,
  "poolQuoteReserve": 5000
}
```

## Frontend Integration Guide

### Dashboard Components

1. **Token Selector**
   - Allow users to search for or enter a token address
   - Fetch token information using the token-info endpoint
   - Display basic token metrics (price, market cap, volume, etc.)

2. **Parameter Configuration Panel**
   - Allow users to adjust simulation parameters:
     - Acquisition level (low/medium/high)
     - Personal ratio (0-1)
     - Days to simulate (30-365)
     - Scenario type (use the presets endpoint)
     - Price impact constraints
     - Calculation precision (approximate/exact)

3. **Simulation Results**
   - Display results for different strategies (conservative/moderate/aggressive)
   - Show percentage of position liquidated
   - Show total value realized
   - Display days to reach key milestones (50%, 100%)

4. **Chart Visualizations**
   - Line chart showing position liquidation over time
   - Stacked area chart showing value realization
   - Bar chart comparing different strategies
   - Heatmap for acquisition/strategy grid outcomes

### Responsive Design Considerations

1. **Performance Optimization**
   - Use the `calculateExact` parameter only when needed
   - Cache results using the `useCache` parameter
   - Load detailed data only when requested

2. **Mobile-Friendly Layout**
   - Collapse complex visualizations on small screens
   - Prioritize key metrics in mobile view
   - Use tabs to separate different simulation aspects

## Implementation Details

The service is built with modular components:

1. **AMM Math Module**
   - Provides mathematical functions for AMM liquidity calculations
   - Implements both approximate and exact solutions for price impact
   - Simulates token swaps and calculates expected returns

2. **Volume Profiles Module**
   - Generates volume profiles for different market scenarios
   - Supports custom volume profile creation
   - Includes realistic decay and growth models

3. **Liquidation Simulator Module**
   - Simulates day-by-day token liquidation with constraints
   - Calculates optimal strategies based on market conditions
   - Provides detailed metrics for strategy evaluation

## Future Enhancements

Planned enhancements for the LiquiditySim service include:

1. **Extended Scenario Modeling**
   - More sophisticated market models
   - Custom scenario creation
   - Historical data-based simulations

2. **Advanced Constraints**
   - Time-based selling restrictions
   - Smart price-aware strategies
   - Dynamic volume tracking

3. **Optimization Algorithms**
   - Automatic strategy optimization
   - Profit maximization algorithms
   - Risk-adjusted return calculations