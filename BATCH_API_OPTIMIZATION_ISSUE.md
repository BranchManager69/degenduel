# Token Enrichment System Batch API Optimization

## Current State: Individual API Calls

### Problem
The token enrichment system is processing each token individually, making 3 separate API calls per token (one to each source: Jupiter, Helius, and DexScreener). With 15,371 tokens in the database and all of them stuck in 'pending' status, this approach is extremely inefficient:

1. **API Call Volume**: Processing all tokens requires 46,113 API calls (15,371 tokens × 3 sources)
2. **Throttling Overhead**: Each API call includes artificial throttling (100-500ms)
3. **Redundant Network Overhead**: Connection establishment, headers, and network latency for each call
4. **Limited Throughput**: Currently configured to process only 150 tokens concurrently (3 batches × 50 tokens)

### Inefficient Process Flow
```
For each batch of 50 tokens:
  For each token in the batch:
    Make API call to Jupiter for this single token
    Wait 100ms
    Make API call to Helius for this single token
    Wait 100ms
    Make API call to DexScreener for this single token
    Wait 500ms
  End for
End for
```

This means each token's processing includes 700ms of pure waiting time just from throttling.

## Proposed Solution: Batched API Calls

### Approach
Modify the collector implementations to leverage the batch capabilities of each API:

1. **Jupiter API**: Supports up to 100 token addresses in a single call
2. **Helius API**: Supports up to 100 mint accounts in a single call
3. **DexScreener API**: Can be optimized to make grouped requests

### New Process Flow
```
For each batch of 50 tokens:
  Group all 50 token addresses
  Make ONE batch API call to Jupiter for all 50 tokens
  Make ONE batch API call to Helius for all 50 tokens
  Make ONE batch API call to DexScreener (or smaller batches if needed)
  Process and store results for all 50 tokens
End for
```

### Implementation Details

#### 1. Jupiter Collector Changes
```javascript
// Add new method
async getTokenInfoBatch(tokenAddresses) {
  // Group addresses into chunks of 100 (Jupiter's limit)
  const chunks = this.chunkArray(tokenAddresses, 100);
  const results = {};
  
  for (const chunk of chunks) {
    // Use Jupiter's batch endpoint
    const response = await this.jupiterClient.getTokenInfoBatch(chunk);
    // Process and merge results
    Object.assign(results, this.processTokenInfoBatch(response));
  }
  
  return results;
}
```

#### 2. Helius Collector Changes
```javascript
// Add new method
async getTokenMetadataBatch(tokenAddresses) {
  // Group addresses into chunks of 100 (Helius limit)
  const chunks = this.chunkArray(tokenAddresses, 100);
  const results = {};
  
  for (const chunk of chunks) {
    // Use Helius batch endpoint
    const response = await this.heliusClient.getMultipleTokens(chunk);
    // Process and merge results
    Object.assign(results, this.processTokenMetadataBatch(response));
  }
  
  return results;
}
```

#### 3. DexScreener Collector Changes
```javascript
// Add new method (DexScreener doesn't have true batch API, but we can optimize)
async getTokensByAddressBatch(tokenAddresses) {
  // Group addresses into chunks of 10 (reasonable for DexScreener)
  const chunks = this.chunkArray(tokenAddresses, 10);
  const results = {};
  
  for (const chunk of chunks) {
    // Make parallel requests with Promise.all
    const responses = await Promise.all(
      chunk.map(address => this.getTokenByAddress(address))
    );
    
    // Process and merge results
    chunk.forEach((address, index) => {
      if (responses[index]) {
        results[address] = responses[index];
      }
    });
    
    // Still respect rate limits between chunks
    if (chunks.length > 1) await this.sleep(1000);
  }
  
  return results;
}
```

#### 4. TokenEnrichmentService Changes

```javascript
// Modify processNextBatch to use batch collectors
async processNextBatch() {
  // ... existing code ...
  
  // Take the batch addresses
  const batchAddresses = batch.map(item => item.address);
  
  // Collect data in batches
  const jupiterData = await jupiterCollector.getTokenInfoBatch(batchAddresses);
  await this.sleep(CONFIG.THROTTLE_MS);
  
  const heliusData = await heliusCollector.getTokenMetadataBatch(batchAddresses);
  await this.sleep(CONFIG.THROTTLE_MS);
  
  const dexScreenerData = await dexScreenerCollector.getTokensByAddressBatch(batchAddresses);
  
  // Process each token with collected data
  const processingPromises = batch.map(item => {
    const tokenData = {
      address: item.address,
      jupiter: jupiterData[item.address] || null,
      helius: heliusData[item.address] || null,
      dexscreener: dexScreenerData[item.address] || null
    };
    
    return this.processAndStoreToken(item.address, tokenData);
  });
  
  // ... rest of existing code ...
}

// New helper method
async processAndStoreToken(tokenAddress, enrichedData) {
  try {
    // Similar to enrichToken but without the API calls
    // Update enrichment attempts
    await this.incrementEnrichmentAttempts(tokenAddress);
    
    // Update last refresh attempt
    await this.db.tokens.updateMany({
      where: { address: tokenAddress },
      data: { last_refresh_attempt: new Date() }
    });
    
    // Check if we have data
    const hasData = enrichedData.jupiter || enrichedData.helius || enrichedData.dexscreener;
    if (!hasData) {
      // Handle no data case (existing code)
      return false;
    }
    
    // Store the data (existing storeTokenData function)
    return await this.storeTokenData(tokenAddress, enrichedData);
  } catch (error) {
    // Error handling (existing code)
    return false;
  }
}
```

## Expected Benefits

### 1. API Call Reduction
| Approach    | API Calls for 15,371 tokens |
|-------------|----------------------------|
| Current     | 46,113 (15,371 × 3)        |
| Batch       | ~924 (462 batches × 2 APIs + special handling for DexScreener) |
| Reduction   | ~98% fewer API calls        |

### 2. Processing Time Reduction
| Operation               | Current Time    | Optimized Time |
|-------------------------|----------------|---------------|
| Process 50 tokens       | ~40-60 seconds | ~3-5 seconds   |
| Process all tokens      | ~5-8 hours     | ~15-20 minutes |

### 3. Resource Benefits
- Reduced network bandwidth usage
- Lower API rate limit pressure
- More efficient CPU utilization
- Better database batch operations

### 4. Business Impact
- Faster data enrichment for all tokens
- Quicker recovery from the current stuck state
- More responsive system for new token discovery
- Improved user experience with fresher token data

## Implementation Plan

### Phase 1: Collector Modifications
1. Implement batch methods in each collector
2. Add proper error handling for batch operations
3. Implement retry logic for batch failures
4. Test each collector's batch functionality individually

### Phase 2: Service Integration
1. Modify processNextBatch in TokenEnrichmentService
2. Create the processAndStoreToken helper method
3. Update statistics tracking for batch operations
4. Add detailed logging for batch operations

### Phase 3: Testing & Validation
1. Test with small batches (10-20 tokens)
2. Validate data accuracy compared to individual processing
3. Monitor API rate limit issues
4. Test recovery from various failure scenarios

### Phase 4: Deployment & Monitoring
1. Deploy the changes to production
2. Implement additional logging for batch operations
3. Monitor progress of token enrichment
4. Adjust batch sizes and throttling based on performance

## Rollback Plan
If issues are detected with the batch processing approach:
1. Revert collector changes
2. Restore original processNextBatch implementation
3. Increase the MAX_CONCURRENT_BATCHES to improve throughput with the original approach

---

# Response to Frontend Team Token Endpoint Inquiry

## Current Findings Analysis

Thank you for your detailed findings about the `/api/v3/tokens` endpoint. Based on our investigation:

### 1. Maximum Token Limit

The `/api/v3/tokens` endpoint currently has:
- No explicit limit parameter in the API route code
- A hardcoded `take: 5000` limit in the underlying repository query
- Performance issues when requesting >2500 tokens due to complex joins with token_prices, token_socials, and token_websites relations

This explains why requests with `limit=2500` and higher result in 502 errors - the query becomes too resource-intensive and times out.

### 2. Pagination Implementation

We need to implement proper pagination in this endpoint. The current code doesn't:
- Process the `limit` parameter from the request
- Have offset/page parameters for pagination
- Include pagination metadata in responses

### 3. Performance Analysis

The counter-intuitive performance times you observed:
- `limit=100` → 0.14s
- `limit=500` → 0.13s 
- `limit=1000` → 0.12s
- `limit=2000` → 0.10s

This is most likely due to database cache warming. The first request fills the cache, making subsequent (larger) requests faster despite returning more data. In production with real load, larger result sets will almost certainly be slower.

### 4. WebSocket Integration

The current architecture uses WebSockets for real-time token data:
- Token data is broadcast every 60 seconds via the WebSocket system
- The WebSocket broadcasts all tokens in these broadcasts
- The frontend is expected to load an initial set via the API and then receive updates via WebSocket

## Solution Implementation

We'll enhance the `/api/v3/tokens` endpoint with:

1. **Proper Pagination**:
   - Add `limit` and `page` parameters
   - Add pagination metadata to the response
   - Cap the maximum limit at 2000 tokens per request

2. **Optional Field Selection**:
   - Add a `fields` parameter to select specific data (e.g., exclude social links for better performance)
   - Create a "light" mode for faster queries when full token details aren't needed

3. **Enhanced Documentation**:
   - Update the API docs to clarify intended usage patterns
   - Document the WebSocket integration for real-time updates

## Implementation Timeline

We'll implement these changes this week. The updated endpoint will be backwards compatible but will include the new pagination features.

Please let us know if you would prefer a different approach or have additional requirements for the token endpoint.