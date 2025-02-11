# DD-Serv Documentation

## Overview
DD-Serv is DegenDuel's resilient service layer for handling token and market data operations. It implements advanced reliability patterns including circuit breakers, retries, and comprehensive monitoring.

## Features

### Circuit Breaker Pattern
The service implements a sophisticated circuit breaker pattern to prevent cascading failures and provide graceful degradation.

#### Configuration
```javascript
{
  failure_threshold: 5,      // Number of failures before opening circuit
  reset_timeout_ms: 30000    // Time (ms) circuit stays open before reset attempt
}
```

#### States
- **Closed**: Normal operation, requests flow through
- **Open**: Service temporarily disabled after multiple failures
- **Half-Open**: Automatic testing of service recovery

#### Monitoring
- Endpoint: `/api/dd-serv/circuit-breaker`
- Returns current circuit state, failure counts, and timestamps
- Tracks last successful and failed operations

### Service Monitoring

#### Health Endpoint
- Path: `/api/dd-serv/health`
- Provides comprehensive service health metrics
- Includes operation counts, response times, and status

#### Stats Reset
- Endpoint: `/api/dd-serv/reset-stats`
- Method: POST
- Resets all monitoring statistics
- Maintains historical failure data

### Token Operations

#### List Tokens
- Path: `/api/dd-serv/tokens/list`
- Query Parameters:
  - `detail`: 'simple' or 'full'
- Features:
  - Monitored fetch with retries
  - Circuit breaker protection
  - Detailed error tracking

#### Price History
- Single Token: `/api/dd-serv/tokens/{tokenAddress}/price-history`
- Bulk Fetch: `/api/dd-serv/tokens/bulk-price-history`
  - Method: POST
  - Body: `{ "addresses": ["token1", "token2"] }`

## Resilience Features

### Retry Mechanism
```javascript
{
  max_retries: 3,
  retry_delay_ms: 5000,     // Progressive backoff
  timeout_ms: 10000         // Per-request timeout
}
```

### Error Handling
- Detailed error tracking per endpoint
- Progressive backoff on failures
- Automatic service degradation detection

### Monitoring Stats
```javascript
{
  operations: {
    total: number,
    successful: number,
    failed: number
  },
  endpoints: {
    [endpointName]: {
      total: number,
      successful: number,
      failed: number,
      average_response_time_ms: number,
      last_error: string,
      last_success: string
    }
  },
  performance: {
    average_response_time_ms: number
  }
}
```

## Usage Examples

### Basic Token List Fetch
```javascript
// Simple token list
GET /api/dd-serv/tokens/list?detail=simple

// Response
[{
  contractAddress: string,
  name: string,
  symbol: string
}]
```

### Circuit Breaker Status Check
```javascript
GET /api/dd-serv/circuit-breaker

// Response
{
  state: "closed" | "open",
  failures: number,
  last_failure: string | null,
  last_success: string | null,
  config: {
    failure_threshold: number,
    reset_timeout_ms: number
  }
}
```

### Health Check
```javascript
GET /api/dd-serv/health

// Response
{
  status: "healthy" | "degraded",
  stats: {
    operations: {...},
    endpoints: {...},
    performance: {...}
  },
  config: {...},
  state: {...}
}
```

## Error Responses

### Service Degraded
```javascript
{
  error: string,
  service_status: "degraded",
  timestamp: string,
  endpoint: string
}
```

### Circuit Breaker Open
```javascript
{
  error: "Circuit breaker is open - service temporarily disabled",
  service_status: "degraded",
  timestamp: string
}
```

## Best Practices

1. **Monitor Circuit Breaker Status**
   - Regularly check `/circuit-breaker` endpoint
   - Log state transitions
   - Alert on repeated failures

2. **Handle Degraded States**
   - Implement fallback mechanisms
   - Cache last known good data
   - Provide graceful degradation UI

3. **Performance Optimization**
   - Use simple token list when full details unnecessary
   - Batch price history requests
   - Monitor response times

4. **Error Recovery**
   - Allow circuit breaker to reset naturally
   - Use reset-stats endpoint judiciously
   - Monitor recovery patterns

## Integration Guidelines

1. **Client Implementation**
   - Implement circuit breaker aware clients
   - Handle service degradation gracefully
   - Provide user feedback on service status

2. **Monitoring Setup**
   - Track circuit breaker states
   - Monitor endpoint performance
   - Alert on service degradation

3. **Maintenance**
   - Regular health check monitoring
   - Performance metric analysis
   - Circuit breaker threshold tuning 