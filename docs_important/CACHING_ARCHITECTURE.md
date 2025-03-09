# DegenDuel Caching Architecture

## Overview

This document outlines the caching strategy implemented in DegenDuel, current implementations, and recommendations for future enhancements. Proper caching is critical for application performance, reducing database load, and improving user experience.

## Current Caching Infrastructure

### Available Caching Systems

DegenDuel currently has two caching systems implemented:

1. **In-Memory Cache** (`/utils/cache.js`)
   - Simple JavaScript Map-based implementation
   - Default TTL: 300 seconds (5 minutes)
   - Process-bound (does not persist across restarts)
   - Suitable for single-instance deployments
   - Currently in active use

2. **Redis Cache** (`/utils/redis-suite/redis-manager.js`)
   - Redis-based implementation
   - Default TTL: 30 seconds
   - Persists across application restarts
   - Suitable for multi-instance deployments
   - Currently available but not widely used

### Cache Implementation Patterns

The application uses a consistent pattern for cache implementation:

1. **Cache Key Generation**
   - Consistent naming convention: `entity:id:subentity`
   - Example: `participation:123:BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp`

2. **Cache Check Before Database Query**
   ```javascript
   const cacheKey = `entity:${id}:${subId}`;
   const cachedResult = await cache.get(cacheKey);
   
   if (cachedResult) {
     // Return cached result
     return res.json(cachedResult);
   }
   
   // Perform database query...
   ```

3. **Cache Update After Database Query**
   ```javascript
   const responseData = {
     // Format response data...
   };
   
   // Cache the result
   await cache.set(cacheKey, responseData, 300); // 5 minutes TTL
   ```

4. **Cache Invalidation on Entity Updates**
   ```javascript
   // After updating an entity
   await cache.del(`entity:${id}:${subId}`);
   ```

## Currently Cached Endpoints

### 1. Contest Participation Check
- **Endpoint**: `GET /api/contests/:id/check-participation`
- **Cache Key**: `participation:${contestId}:${wallet_address}`
- **TTL**: 300 seconds (5 minutes)
- **Invalidation**: When a user joins a contest

### 2. User Contest Participations
- **Endpoint**: `GET /api/contests/participations/:wallet`
- **Cache Key**: `wallet:participations:${wallet_address}`
- **TTL**: 300 seconds (5 minutes)
- **Invalidation**: When a user joins any contest

## Recommendations for Future Enhancements

### 1. Expand Cache Coverage

Additional endpoints that would benefit from caching:

| Endpoint | Suggested Cache Key | Suggested TTL | Notes |
|----------|-------------------|--------------|-------|
| `GET /api/contests` | `contests:list:${status}:${limit}:${offset}` | 60 seconds | High-traffic endpoint |
| `GET /api/contests/:id` | `contest:${id}` | 120 seconds | Contest details rarely change |
| `GET /api/contests/:id/leaderboard` | `leaderboard:${id}` | 30 seconds | Balance changes frequently |
| `GET /api/tokens` | `tokens:list` | 300 seconds | Token list changes infrequently |
| `GET /api/users/profile/:wallet` | `user:profile:${wallet}` | 300 seconds | User profile rarely changes |

### 2. Migrate to Redis for Production

For production environments with multiple application instances:

1. **Standardize on Redis**
   - Transition all caching to use the Redis implementation
   - Ensure Redis is configured with proper persistence and replication
   - Consider implementing Redis Sentinel or Redis Cluster for high availability

2. **Update the Redis Configuration**
   - Increase default TTL to 300 seconds for consistency
   - Add monitoring for Redis health and cache hit rates
   - Consider implementing cache warming for critical endpoints

### 3. Implement Cache Headers for Front-End

Add proper HTTP cache headers to responses:

```javascript
res.set('Cache-Control', 'private, max-age=300');
res.set('ETag', etag); // Generate ETag based on response content
```

### 4. Add Cache Monitoring

Implement monitoring for cache performance:

1. **Cache Hit Rate Metrics**
   - Track and log cache hits vs. misses
   - Set up alerts for low cache hit rates

2. **Cache Size Monitoring**
   - Monitor memory usage for in-memory cache
   - Set appropriate maxmemory policy for Redis

### 5. Implement Batch Operations

For high-volume operations:

1. **Bulk Cache Loading**
   ```javascript
   // Load multiple cache entries at once
   const contestIds = [1, 2, 3, 4, 5];
   const cachePromises = contestIds.map(id => 
     cache.set(`contest:${id}`, contestData[id], 300)
   );
   await Promise.all(cachePromises);
   ```

2. **Pipeline Redis Operations**
   - Use Redis pipelining for bulk operations
   - Reduce network roundtrips

### 6. Consider Advanced Caching Patterns

For future scaling:

1. **Two-Level Caching**
   - In-memory cache (L1) backed by Redis (L2)
   - Reduces Redis load for very hot items

2. **Cache Stampede Protection**
   - Implement locking mechanism for cache misses
   - Prevents multiple simultaneous database queries for the same key

3. **Predictive Prefetching**
   - Preload cache based on user behavior patterns
   - Particularly useful for contest details before active trading periods

## Implementation Guide

When implementing caching for new endpoints:

1. **Identify Cache Candidates**
   - High-traffic endpoints
   - Computationally expensive operations
   - Data that changes infrequently

2. **Define Cache Keys**
   - Follow the established naming convention
   - Include all parameters that affect the response

3. **Set Appropriate TTL**
   - Balance freshness vs. performance
   - Consider the natural update frequency of the data

4. **Plan Cache Invalidation**
   - Identify all operations that modify the cached data
   - Add cache clearing code to those operations

5. **Test Cache Effectiveness**
   - Verify cache hit rates in production
   - Adjust TTL based on observed patterns

## Conclusion

The current caching implementation provides a solid foundation, particularly for contest participation checks. Expanding this approach to other endpoints and standardizing on Redis for production environments will significantly improve application performance and scalability.

By following the recommendations in this document, DegenDuel can continue to build a robust and efficient caching layer that supports the application's growth.