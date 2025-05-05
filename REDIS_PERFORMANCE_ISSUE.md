# Redis Performance Issue: High CPU Usage

## Issue Description

The Redis server used by both development and production DegenDuel instances is experiencing extremely high CPU utilization (100% constant), causing connection instability and performance degradation. This manifests as rapid disconnections/reconnections in log files.

## Environment Information

- **Platform**: AWS Linux server
- **Redis Version**: Running on 127.0.0.1:6379 (default port)
- **Current Memory Usage**: ~10-75MB (fluctuating significantly)
- **Current CPU Usage**: 100% constant
- **Affected Components**: 
  - Production API server (degenduel-api)
  - Development API server (degenduel-api-test)

## Diagnostics Summary

### Redis Server Statistics

```
# Redis Process
redis    1393725  100  0.3 170808 115160 ?       Rsl  20:12   1:29 /usr/bin/redis-server 127.0.0.1:6379

# Memory Statistics
used_memory:10971632          # 10.46MB total used memory
used_memory_human:10.46M
used_memory_rss:79118336      # 75.45MB actual memory used (RSS)
used_memory_rss_human:75.45M  
mem_fragmentation_ratio:1.27  # Moderate memory fragmentation
maxmemory:0                   # No memory limit set
maxmemory_policy:noeviction   # Default no eviction policy
```

### Redis Client Connections

```
# Connected Clients
connected_clients:3

# Client List
id=3 addr=127.0.0.1:45540 [...] age=80 idle=10 [...]
id=4 addr=127.0.0.1:45554 [...] age=80 idle=10 [...]
id=6 addr=127.0.0.1:56378 [...] age=0 idle=0 [...]
```

### Redis Data and Operations

```
# No keys stored despite high CPU usage
keyspace_hits:0
keyspace_misses:0
evicted_keys:0
expired_keys:0
rejected_connections:0

# RDB persistence configuration
save 3600 1 300 100 60 10000
```

### Memory Pattern Observations

- **Sawtooth Memory Pattern**: Memory fluctuates rapidly between ~10MB and ~60MB in a saw-tooth pattern
- **No Data Storage**: Despite high activity, no keys are being stored persistently
- **High Memory Fragmentation**: The memory fragmentation ratio (1.27) indicates inefficient memory usage

### Connection Flow

Analysis of application logs shows Redis connection sequences:

1. Connection established
2. Redis reports "Connection closed" warnings
3. Application immediately attempts reconnection 
4. Error "connect ECONNREFUSED 127.0.0.1:6379" reported
5. Connection re-established after multiple attempts
6. Cycle repeats approximately every 30-60 seconds

## Root Cause Analysis

The issue is caused by a combination of factors:

1. **Shared Redis Instance**: Both production and development environments share the same Redis instance on 127.0.0.1:6379
2. **Aggressive Retry Strategy**: The Redis client is configured with a very aggressive retry strategy:
   ```javascript
   retryStrategy: (times) => {
     const delay = Math.min(times * 50, 2000);
     return delay;
   }
   ```
   This means reconnection attempts start at 50ms and increase by 50ms each time, maxing at 2000ms
3. **Unconfigured Memory Limits**: Redis is running without memory limits (maxmemory:0)
4. **No Eviction Policy**: The default noeviction policy is used, despite high memory pressure
5. **Aggressive RDB Save Settings**: Redis is configured to save the dataset frequently

## Aggravating Factors

1. **AI Service Analysis**: The development server's AI service runs analysis jobs that create substantial Redis connection activity
2. **Session Management**: Redis is used for storing session data, causing frequent reads/writes
3. **Connection Pooling Issues**: Possible issues with connection pooling leading to frequent connects/disconnects

## Recommended Solutions

### Immediate Fixes

1. **Set Redis Memory Limits**:
   ```bash
   redis-cli CONFIG SET maxmemory 2gb
   redis-cli CONFIG SET maxmemory-policy allkeys-lru
   ```

2. **Modify Redis Client Configuration** in `utils/redis-suite/redis-manager.js`:
   ```javascript
   retryStrategy: (times) => {
     // More conservative retry strategy with exponential backoff
     return Math.min(Math.pow(2, times) * 100, 10000);
   }
   ```

3. **Separate Development Redis Instance**:
   - Configure the development server to use a different Redis port (e.g., 6380)

### Medium-Term Solutions

1. **Redis Monitoring**:
   - Set up proper monitoring for Redis metrics
   - Add alerts for high CPU utilization

2. **Optimize AI Service Analysis**:
   - Reduced frequency: Change intervals from 5-10 minutes to 60 minutes
   - Optimize log handling to reduce Redis load

3. **Connection Pooling Improvements**:
   - Implement proper connection pooling for Redis clients
   - Reduce connection churn

4. **Redis Persistence Configuration**:
   - Review and tune RDB persistence settings
   - Consider using AOF for more granular persistence control

### Long-Term Solutions

1. **Environment Isolation**:
   - Complete separation of development and production data stores
   - Containerization of development environment

2. **Redis Cluster**:
   - Consider Redis Cluster for production to distribute load
   - Implement proper Redis replication for high availability

3. **Caching Strategy Review**:
   - Comprehensive review of all Redis usage throughout the application
   - Optimization of caching strategies, TTLs, and data volumes

## Impact Assessment

- **User Experience**: Minimal impact to end users (though potential for session loss)
- **Development**: Significant disruption to development workflow
- **System Resources**: Excessive CPU consumption affecting other processes
- **Reliability**: Reduced reliability due to frequent connection issues

## Monitoring and Verification Steps

After implementing fixes, verify improvements by:

1. Monitoring Redis CPU usage (should drop significantly)
2. Checking connection logs for frequency of reconnection attempts
3. Observing memory usage patterns (should stabilize)
4. Measuring system response times for operations that depend on Redis

## References

- [Redis Memory Optimization](https://redis.io/topics/memory-optimization)
- [Redis Persistence](https://redis.io/topics/persistence)
- [ioredis Configuration Options](https://github.com/luin/ioredis#options)