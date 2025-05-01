# Token Data Streaming Architecture Inquiry

## To: Frontend Team
## From: Backend Architecture Team
## Date: April 29, 2025
## Subject: Improved Token Data Delivery System

We're working on significantly improving the token data delivery system, moving away from our current inefficient approach (full data dumps every 60 seconds) to a more scalable and responsive architecture.

Before implementing changes, we'd like to understand your requirements and get your input on the proposed architecture.

## Current Pain Points (As We Understand Them)

1. The `/api/v3/tokens` endpoint fails when requesting large datasets (>2500 tokens)
2. WebSocket updates are too infrequent (60-second intervals)
3. Unnecessary data transfer (receiving updates for tokens not being viewed)
4. Poor initial load experience (tokens take time to appear)

## Proposed Architecture

We're planning to implement a subscription-based WebSocket system with the following features:

1. **Targeted Subscriptions**
   - Clients subscribe only to tokens they're actually displaying
   - Server pushes updates only when subscribed tokens change
   - Support for "group subscriptions" (e.g., "top 100 by market cap")

2. **Smart Initial Loading**
   - Optimized endpoint for initial token list with proper pagination
   - Additional metadata to help with virtual scrolling implementation
   - Support for various sorting criteria (market cap, volume, recent price change)

3. **Differential Updates**
   - Only send data that has actually changed (not full token objects)
   - Include version/timestamp with each update
   - Potential for compression of update batches

4. **Custom Data Fields**
   - Ability to request only specific fields (prices, social links, etc.)
   - "Light" mode for performance-critical views

## Questions For Your Team

1. **Token Display**
   - How many tokens do you typically display at once in different views?
   - Do you implement virtual scrolling or pagination in the UI?
   - What's your preferred approach for "infinite scrolling" vs. pagination?

2. **Update Frequency**
   - What's the ideal update frequency for token data?
   - Do different views have different frequency requirements?
   - Would you prefer smaller, more frequent updates or larger, less frequent ones?

3. **Subscription Patterns**
   - Would you prefer explicit subscribe/unsubscribe calls, or automatic subscription based on viewed tokens?
   - How would you handle token list pages vs. detailed token views?
   - What "group subscriptions" would be useful? (e.g., "top gainers", "new listings")

4. **Client-Side Caching**
   - Do you currently implement any client-side caching for token data?
   - Would IndexedDB or similar browser storage be feasible in your architecture?
   - What's your approach to handling stale data when a user returns to the app?

5. **Data Fields**
   - Which token fields are essential for list views vs. detail views?
   - Are there fields that could be loaded on-demand rather than upfront?
   - Do you need all social links and metadata for every token in list views?

6. **Sorting & Filtering**
   - What are the most common sorting criteria used in your UI?
   - Do you need server-side filtering, or is client-side filtering sufficient?
   - How do you handle token search functionality?

7. **Performance Metrics**
   - What's your target for initial page load time?
   - What's an acceptable latency for token data updates?
   - Any specific performance bottlenecks you're currently experiencing?

## Proposed Implementation Timeline

1. **Phase 1**: Enhance existing endpoints with proper pagination and field selection
2. **Phase 2**: Implement subscription-based WebSocket system
3. **Phase 3**: Add differential updates and optimized data transfer
4. **Phase 4**: Implement specialized group subscriptions and advanced features

Please let us know your thoughts on this proposed architecture, and any additional requirements or considerations we should take into account.

We're aiming to create a system that provides real-time data while being efficient and scalable, and your input will be invaluable in achieving this goal.

Thank you,
Backend Architecture Team