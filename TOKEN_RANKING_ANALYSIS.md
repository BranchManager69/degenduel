# Token Ranking System Analysis

## Overview

I've thoroughly examined our token ranking system to understand how tokens are categorized as popular, trending, or relevant. This analysis explains the current methodology and provides examples of how tokens are scored.

## Token Ranking Methodology

Our system uses a sophisticated approach to rank tokens based on multiple factors:

### 1. Hotness Score Calculation

The core of our ranking system is the "hotness score" (in `sortTokensByRelevance()` method), which considers:

```javascript
// Market Cap component - high cap tokens are more important
if (marketCap > 0) {
    hotnessScore += Math.log10(marketCap) * 3;
}

// Volume component - high volume indicates active trading
if (volume > 0) {
    hotnessScore += Math.log10(volume) * 5;
}

// Liquidity component - high liquidity indicates stability
if (liquidity > 0) {
    hotnessScore += Math.log10(liquidity) * 2;
}

// Add a bonus for tokens that have a price
if (price > 0) {
    hotnessScore += 10;
}

// Add a bonus for tokens with proper identifiers
if (symbol && symbol.length > 0) {
    hotnessScore += 15;
}
if (address && address.length > 25) {
    hotnessScore += 5;
}
```

The logarithmic approach ensures that:
- Tokens with extremely high market cap/volume don't completely dominate
- Each order of magnitude increase adds a fixed amount to the score
- We can still differentiate between tokens with similar metrics

### 2. Trending Token Detection

In addition to the base hotness score, we have a sophisticated trending detection system that tracks:

1. **Rank Changes**: Tokens moving up or down significantly in ranking
2. **Percentage Change**: Relative to previous position (e.g., 50→25 is 50% improvement)
3. **Logarithmic Rank Importance**: Makes movements in top ranks dramatically more important
4. **Volume Growth**: Tokens with both rising ranks and increasing volume are marked as "HOT"

### 3. Categories of Special Interest

The system specifically identifies:

- **Hot Tokens**: Tokens with both positive rank change AND volume growth
- **Rank Climbers**: Tokens rising in rank but not necessarily with volume growth
- **Top Gainers**: Tokens with >5% price increase in 24h
- **Statistical Outliers**: Tokens with statistically significant price or volume changes (>2 standard deviations from mean)

## Examples of Token Scoring

To illustrate how this works, let's look at some examples:

| Token | Market Cap | 24h Volume | Liquidity | Score Components | Total Score |
|-------|------------|------------|-----------|------------------|-------------|
| Popular Token | $500M | $50M | $10M | MC: 8.1 + Vol: 31.5 + Liq: 14 + Bonuses: 30 | 83.6 |
| Small Cap w/High Volume | $5M | $20M | $1M | MC: 6.1 + Vol: 26.5 + Liq: 12 + Bonuses: 30 | 74.6 |
| New Listing | $1M | $5M | $500K | MC: 5.0 + Vol: 21.5 + Liq: 11.4 + Bonuses: 30 | 67.9 |
| Low Activity Token | $50M | $100K | $1M | MC: 7.1 + Vol: 16.5 + Liq: 12 + Bonuses: 30 | 65.6 |

### Trending Detection Example

For a token that moves from rank 50 to rank 25:
- Raw change: +25 positions
- Percentage change: 50%
- Log rank importance: ~2.3
- Weighted score: 115
- If volume also increased by 20%: Marked as "HOT"

## Effectiveness Assessment

After analyzing the system, I believe it effectively captures token relevance for several reasons:

1. **Balanced Metrics**: The system considers market cap, volume, AND liquidity
2. **Volume Emphasis**: Higher weighting (5x) for volume ensures active tokens rank higher
3. **Logarithmic Scaling**: Prevents extreme outliers from dominating completely
4. **Trending Detection**: Identifies meaningful rank changes, not just absolute position
5. **Statistical Analysis**: Uses standard deviation to find truly significant movements

## Recommendations

The current ranking system is solid, but I'd recommend these enhancements:

1. **Time-Weighted Score Component**: Add a decay factor for recency (newer activity scores higher)
2. **Social Signal Integration**: Consider incorporating social media mentions/sentiment
3. **User Interaction Metrics**: Factor in how many users view or interact with a token
4. **Dynamic Weighting**: Adjust weightings based on market conditions
5. **Customizable Relevance**: Allow users to personalize what "relevance" means to them

## Practical Application for WebSocket Design

For our WebSocket token streaming implementation:

1. **Default Subscription**: Subscribe users to top 100-300 tokens by hotness score automatically
2. **Dynamic Groups**: Create subscription groups like:
   - "hot-tokens" (trending tokens with rising volume)
   - "top-gainers" (largest 24h price increases)
   - "new-listings" (recently added tokens)
   - "high-volume" (most active trading tokens)

3. **Smart Updates**: When broadcasting updates:
   - Always prioritize updates for tokens with higher hotness scores
   - Ensure "HOT" tokens get real-time updates regardless of score
   - Use fewer updates for lower-ranked tokens

This approach would give users a responsive experience for the tokens they're most likely to care about, while efficiently managing server and network resources.