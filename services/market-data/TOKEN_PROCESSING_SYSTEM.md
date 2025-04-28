# Token Processing System Architecture

## Overview

The token processing system is designed to efficiently monitor, detect, and process new tokens from the Solana blockchain through the Jupiter API. This document explains the multi-stage pipeline and batching strategies that allow the system to handle over 700,000 tokens efficiently.

## The Full Token Processing Pipeline

### Stage 1: Getting All Tokens (~700,000+)
- `tokenDetectionService.js` fetches the complete Jupiter token list (~700K tokens)
- It extracts all token addresses into a single array
- This full list is sent to `tokenListDeltaTracker.trackChanges()`

### Stage 2: Redis Set Operations
- `tokenListDeltaTracker.js` breaks the 700K tokens into batches of 1000
- Each batch is added to Redis using `pipeline.sadd(currentKey, ...batch)`
- The pipeline is executed once, with all batches included in a single Redis transaction
- Redis performs set operations (SDIFF) to find:
  - New tokens (present now but not in previous run)
  - Removed tokens (present before but not now)

### Stage 3: Processing Only New Tokens
- Only the delta (new tokens) are returned to tokenDetectionService
- Instead of processing all 700K tokens, it only processes the much smaller list of new tokens
- This is extremely efficient - on average maybe 10-500 new tokens per check

### Stage 4: Event Queue for New Tokens (Second Level of Batching)
- New tokens aren't processed immediately
- They're added to a processing queue: `this.processingQueue = [...this.processingQueue, ...tokens]`
- The `processNextBatch()` method processes them in smaller batches (CONFIG.BATCH_SIZE = 50)
- This further reduces load on the system

### Stage 5: Final Token Processing
- Each token in the small batch gets a 'token:new' event emitted
- These events are handled elsewhere in the system (token enrichment, metadata fetching, etc.)
- A delay (CONFIG.BATCH_DELAY_MS) is added between batches to prevent overwhelming systems
- After one batch is complete, it processes the next batch recursively

## The Efficiency of the Design

This multi-level batching approach is extremely efficient because:

1. **Storage Efficiency**: Uses Redis sets which are compact and efficient
2. **Computation Efficiency**: 
   - Redis set operations (SDIFF) are blazingly fast O(n) operations
   - Only processes the delta (new/removed tokens) not the entire list
3. **Memory Efficiency**:
   - Batched Redis operations prevent JavaScript stack overflow
   - The secondary queue ensures only small batches of new tokens get processed at once
4. **Rate Limiting**:
   - Introduces delays between processing batches
   - Prevents overwhelming downstream services with new token events

## The Overall Flow

Here's the full flow:
1. Jupiter client gets ~700K tokens every 30 seconds
2. Those tokens are sent to Redis in batches of 1000
3. Redis finds the new tokens (maybe 200 new tokens)
4. Those 200 new tokens are queued for processing
5. The queue processes them in smaller batches of 50 with delays
6. Each token in a batch gets an event emitted that other services can respond to
7. The process repeats every 30 seconds, always only processing new tokens

## Key Files

- `tokenDetectionService.js`: Manages the overall detection and queuing process
- `tokenListDeltaTracker.js`: Efficiently tracks changes using Redis set operations
- `jupiter-client.js`: Provides access to the Jupiter API and token list

## Optimization History

- Added batching to Redis operations to prevent "Maximum call stack size exceeded" errors
- Set a batch size of 1000 tokens to balance performance with memory usage
- Implemented a secondary processing queue with smaller batch size (50) for final processing
- Added configurable delays between batches to prevent overwhelming downstream services