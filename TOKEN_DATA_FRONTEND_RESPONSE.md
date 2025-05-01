# Token Data Streaming Architecture Response

## To: Backend Architecture Team
## From: Frontend Development Team
## Date: April 29, 2025
## Subject: Response to Token Data Delivery System Proposal

Thank you for your comprehensive proposal on improving the token data delivery system. We're excited about the potential improvements and would like to provide our input on your questions and the proposed architecture.

## Responses to Your Questions

### 1. Token Display

- **Typical Display Count**: 
  - Our new EnhancedTokensPage uses a tiered display approach:
    - Featured section: 2-6 tokens with detailed information
    - Trending section: 5-10 tokens with medium detail
    - Main grid: 50-100 tokens visible at once (depending on screen size)
  - We'd ideally want data for 2000+ tokens to be available for filtering/sorting client-side

- **Virtual Scrolling/Pagination**:
  - We currently don't implement virtual scrolling but would be interested in adding it
  - Our grid layout could benefit from virtual scrolling for improved performance when displaying large datasets

- **Infinite Scrolling vs. Pagination**: 
  - For token browsing, we prefer infinite scrolling for a seamless experience
  - We'd like to support both approaches depending on the view context

### 2. Update Frequency

- **Ideal Frequency**: 
  - For market data (prices, volumes, changes): Real-time (as fast as reasonably possible, 1-2 second intervals)
  - For metadata (social links, images): Lower frequency (every few minutes) is acceptable

- **View-Specific Requirements**:
  - Detailed token view: Higher frequency (near real-time)
  - List views: Standard frequency (2-5 seconds)
  - Background/inactive tabs: Reduced frequency (10-15 seconds)

- **Update Size Preference**:
  - We prefer smaller, more frequent updates for active views
  - This aligns well with your differential updates proposal

### 3. Subscription Patterns

- **Subscription Approach**: 
  - We prefer a hybrid approach:
    - Automatic subscription to visible tokens
    - Manual subscription for specific tokens of interest
    - Group subscriptions for categories (top gainers, etc.)

- **Page Type Handling**:
  - Token list pages: Subscribe to visible tokens + top tokens by key metrics
  - Detailed token views: Subscribe to the specific token + related tokens
  - Dashboard views: Subscribe to user-specific tokens + global top performers

- **Useful Group Subscriptions**:
  - "Top by market cap" (tiered: top 10, top 50, top 100)
  - "Top gainers/losers" (24h, 7d)
  - "Most active" (by volume/transactions)
  - "Trending" (by social mentions, search volume)
  - "Recently updated" (newly listed or significantly changed tokens)

### 4. Client-Side Caching

- **Current Implementation**: 
  - Basic in-memory caching during the session
  - No persistent storage currently implemented

- **Browser Storage Feasibility**:
  - IndexedDB would be feasible and valuable for our architecture
  - We could implement this to improve offline capabilities and reduce unnecessary fetches

- **Stale Data Approach**:
  - We currently show cached data with a visual indicator while fetching fresh data
  - A timestamp-based invalidation strategy would work well with WebSocket updates

### 5. Data Fields

- **Essential Fields for Different Views**:
  - List views: symbol, name, price, change24h, marketCap, volume24h, small image
  - Detail views: All of the above plus: contract address, social links, websites, detailed price history, liquidity data

- **On-Demand Loading**:
  - Detailed historical data
  - Social engagement metrics
  - Token distribution data
  - Extended metadata (team info, launch date, etc.)

- **Social Links & Metadata**:
  - Not needed for every token in list views
  - Preloading for featured/top tokens would be beneficial

### 6. Sorting & Filtering

- **Common Sorting Criteria**:
  - Market cap (default)
  - 24h price change
  - 24h volume
  - Price
  - Custom "hotness" score (combination of change, volume, and recency)

- **Filtering Approach**:
  - Prefer client-side filtering for immediate response
  - Server-side filtering needed for advanced queries beyond the loaded dataset
  - A combination would be ideal: server-side for initial filtered sets, client-side for further refinement

- **Search Functionality**:
  - Currently implemented as client-side filtering with debouncing
  - Search covers name, symbol (could expand to address with backend support)
  - Would benefit from server-side search for tokens not in the current dataset

### 7. Performance Metrics

- **Target Initial Load Time**:
  - First meaningful content: < 1 second
  - Complete token grid with data: < 2.5 seconds
  - All features fully interactive: < 3.5 seconds

- **Acceptable Update Latency**:
  - Price/market data: < 2 seconds for critical tokens
  - General updates: < 5 seconds
  - Background updates: < 15 seconds

- **Current Bottlenecks**:
  - Initial data load (limited to 100 tokens currently)
  - Delayed WebSocket updates (60-second interval)
  - Client-side rendering performance with many tokens
  - Search performance across large datasets

## Feedback on Proposed Architecture

Overall, we're very enthusiastic about your proposed architecture and believe it aligns well with our needs. Here are some specific thoughts:

### 1. Targeted Subscriptions
This is exactly what we need. The ability to subscribe to specific tokens and groups will significantly improve our application's efficiency.

### 2. Smart Initial Loading
We strongly support this approach. Proper pagination with metadata for virtual scrolling would greatly enhance our user experience.

### 3. Differential Updates
This would be a major improvement over the current system. Receiving only changed data will reduce bandwidth and improve real-time capabilities.

### 4. Custom Data Fields
The ability to request specific fields would be extremely valuable, especially for creating optimized list views vs. detailed token views.

## Additional Considerations

1. **Websocket Connection Resilience**:
   - Robust reconnection handling with exponential backoff
   - Clear connection state indicators for users
   - Fallback mechanisms when WebSocket connections fail

2. **Transition Strategy**:
   - How do we migrate from the current system to the new one?
   - Will there be a period of parallel operation?
   - What changes will be required in our frontend code?

3. **Data Consistency**:
   - How will you ensure consistency between REST API and WebSocket data?
   - Will there be a mechanism to sync after connection issues?

4. **Development Support**:
   - Will there be updated documentation and examples?
   - Could we get a test environment to experiment with the new system?

## Implementation Priorities

From our perspective, the most critical improvements would be:

1. Increase the initial data load capacity (from 100 to 2000+ tokens)
2. Implement real-time WebSocket updates (moving away from 60-second intervals)
3. Add targeted subscriptions to reduce unnecessary data transfer
4. Implement differential updates for efficiency

We're excited about this collaboration and look forward to working with you on implementing these improvements. Let us know if you need any clarification or additional information from our side.

Thank you,
Frontend Development Team