# Issue 1: Token Data Integrity Problems

## Problem
Critical data integrity issues in the token enrichment system are preventing proper token processing.

## Symptoms
- All 15,371 tokens have discovery_count = 0 (not incrementing)
- All tokens stuck in 'pending' state, none reaching 'complete'
- Only 101 refresh attempts recorded despite batching in sets of 50
- Only 102 successful refreshes recorded

## Root Causes
1. **Counter Incrementing Failure**: 
   ```javascript
   // This increment operation isn't working
   await this.db.tokens.update({
     where: { id: existingToken.id },
     data: { 
       last_discovery: new Date(),
       discovery_count: { increment: 1 }
     }
   });
   ```

2. **Metadata Status Update Failure**:
   ```javascript
   // This isn't successfully changing status from 'pending' to 'complete'
   await this.db.tokens.update({
     where: { id: existingToken.id },
     data: {
       // ... other fields ...
       metadata_status: 'complete'
     }
   });
   ```

3. **Batch State Tracking**: Processing doesn't align with batch size of 50

## Impact
- System cannot track token discovery frequency
- Token enrichment pipeline stalled
- No tokens reaching 'complete' status, causing repeated processing attempts
- Resources wasted on reprocessing already-seen tokens

## Fixes Required
1. Debug and fix `discovery_count` increment operation
2. Trace and fix status transitions from 'pending' to 'complete'
3. Add validation to ensure database updates succeed
4. Add transaction handling for atomic updates
5. Create automated tests for data integrity

## Verification Steps
```sql
-- After fix, should see varying discovery counts
SELECT MIN(discovery_count), MAX(discovery_count), AVG(discovery_count) FROM tokens;

-- After fix, should see statuses other than just 'pending'
SELECT metadata_status, COUNT(*) FROM tokens GROUP BY metadata_status;

-- Verify refresh attempts follow expected batch patterns
SELECT COUNT(*) FROM tokens WHERE last_refresh_attempt IS NOT NULL;
```

## Priority
High - Blocking proper token processing pipeline operation