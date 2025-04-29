# Issue 3: Lack of Token Pipeline Monitoring & Instrumentation

## Problem
The token detection and enrichment pipeline lacks comprehensive monitoring, making it impossible to identify bottlenecks, diagnose issues, or optimize performance.

## Specific Gaps

1. **Missing Discovery Metrics**:
   - No visibility into token discovery rates (per hour/day)
   - Cannot track Redis performance for set operations
   - No alerting for abnormal discovery patterns

2. **Enrichment Pipeline Blindspots**:
   - No visibility into queue growth/processing rates
   - Cannot track API call success/failure rates
   - No metrics on processing times by source (Jupiter/Helius/DexScreener)
   - No way to identify bottlenecks in pipeline

3. **Database Operation Tracking**:
   - No metrics on database write performance
   - No visibility into transaction success/failure
   - Cannot track data consistency issues

4. **Cross-Service Communication**:
   - No metrics on event emission/reception
   - Cannot track event processing latency
   - No visibility into message queue health

## Impact
- Cannot diagnose strange data states (e.g., 101 refresh attempts)
- Cannot optimize batch parameters scientifically
- Impossible to identify performance regression
- No early warning for system issues
- Difficult to plan capacity needs

## Required Instrumentation

1. **Token Discovery Metrics**:
   - Tokens discovered per hour/day/week
   - Redis operation latencies
   - Set size growth over time
   - Discovery patterns by source

2. **Processing Pipeline Metrics**:
   - Queue length over time
   - Processing rate (tokens/second)
   - Batch completion time statistics
   - Breakdown by priority level
   - API call latencies by source
   - Success/failure rates by source

3. **Database Metrics**:
   - Write operation latencies
   - Transaction success/failure rates
   - Record update counts by status
   - Index usage statistics

4. **System Resource Metrics**:
   - CPU/memory usage during batch processing
   - Network bandwidth to external APIs
   - Correlation between system load and processing speed

## Implementation Plan

1. **Add Prometheus Integration**:
   - Instrument key methods with counters and histograms
   - Track all processing events
   - Monitor queue lengths and processing times

2. **Create Dashboard**:
   - Real-time view of token discovery and enrichment
   - Historical trends for optimization analysis
   - Alerting for abnormal patterns

3. **Implement Enhanced Logging**:
   - Structured logging for all pipeline steps
   - Correlation IDs across system boundaries
   - Sampling for high-volume events

4. **A/B Testing Framework**:
   - Controlled experiments with processing parameters
   - Scientific optimization based on metrics
   - Performance comparison between approaches

## Priority
High - Essential for diagnosing current issues and improving system