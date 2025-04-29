# Issue 2: Arbitrary Batch Processing Parameters

## Problem
The token processing system uses arbitrary batch processing parameters with no clear rationale or dynamic adjustment capability.

## Current Settings
```javascript
// Configuration
const CONFIG = {
  // Processing configuration
  BATCH_SIZE: 50,                 // Why 50?
  BATCH_DELAY_MS: 100,            // Why 100ms?
  MAX_CONCURRENT_BATCHES: 3,      // Why 3?
  
  // Throttling to avoid rate limits
  THROTTLE_MS: 100,               // Why 100ms?
  DEXSCREENER_THROTTLE_MS: 500,   // Why 500ms?
}
```

## Observations
1. **Mismatch with Actual Processing**:
   - 101 refresh attempts recorded - not a multiple of 50
   - Suggests processing is not consistently following batch parameters

2. **No Dynamic Adjustment**:
   - Fixed parameters regardless of system load
   - No consideration of API rate limits
   - No adjustment based on CPU/memory/network conditions

3. **No Performance Measurements**:
   - No data on optimal batch sizes
   - No monitoring of actual processing speeds
   - No baseline for comparison

4. **Arbitrary Re-enrichment Schedule**:
   - 24-hour threshold for re-enrichment is fixed and applies to all tokens
   - No differentiation based on token importance or volatility

## Impact
- Suboptimal resource utilization
- Potential bottlenecks
- Unpredictable processing behavior
- Inefficient API usage
- Missed opportunities to prioritize important tokens

## Recommended Improvements
1. **Measure & Validate Parameters**:
   - Benchmark different batch sizes (25, 50, 100)
   - Benchmark different concurrency levels (1, 3, 5, 10)
   - Measure actual API throttling requirements
   - Implement A/B testing framework for processing parameters

2. **Dynamic Parameter Adjustment**:
   - Adjust batch size based on queue length
   - Adjust concurrency based on system load
   - Adjust API throttling based on rate limit responses
   - Create adaptive parameters based on time of day

3. **Differentiated Processing**:
   - Implement tier-based re-enrichment schedules:
     - High-volume tokens: every 1-4 hours
     - Medium-volume tokens: every 12 hours
     - Low-volume tokens: every 24-48 hours
   - Scale batch size based on priority level

4. **Instrumentation**:
   - Add detailed metrics on processing times
   - Track success/failure rates by batch size
   - Monitor CPU/memory/network impact during processing
   - Generate automatic parameter recommendations

## Priority
Medium - System functions but efficiency is compromised