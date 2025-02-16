# Circuit Breaker Dashboard - Additional Backend Requirements

## WebSocket Enhancements

### 1. Heartbeat System

```typescript
interface HeartbeatMessage {
  type: "ping" | "pong";
  timestamp: number;
}
```

- Implement WebSocket heartbeat mechanism
- Respond to 'ping' messages with 'pong'
- Include timestamp for latency calculation
- Heartbeat interval: 5000ms

### 2. Real-time Service Updates

```typescript
interface ServiceUpdateMessage {
  type: "service:update";
  service: string;
  data: {
    status: "healthy" | "degraded" | "failed";
    circuit: {
      state: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailure: string | null;
      recoveryAttempts: number;
    };
    operations: {
      total: number;
      successful: number;
      failed: number;
    };
  };
}
```

- Emit updates whenever service state changes
- Include operation statistics
- Broadcast to all connected admin clients

### 3. Connection Status Events

```typescript
interface ConnectionStatusMessage {
  type: "connection:status";
  status: "connected" | "disconnected";
  timestamp: string;
  reconnectAttempts?: number;
}
```

- Track connection state
- Report reconnection attempts
- Provide connection timestamps

## API Endpoint Modifications

### 1. Service Configuration

```typescript
// PUT /api/admin/circuit-breaker/{service}/config
interface ConfigUpdateRequest {
  failureThreshold: number;
  resetTimeoutMs: number; // New field
  minHealthyPeriodMs: number; // New field
  requestLimit?: number; // Optional
}

interface ConfigUpdateResponse {
  success: boolean;
  service: string;
  config: ConfigUpdateRequest;
  appliedAt: string;
}
```

### 2. Service Operations Metrics

```typescript
// GET /api/admin/circuit-breaker/status
interface ServiceOperations {
  total: number;
  successful: number;
  failed: number;
  successRate: number;
  lastOperation: string;
}

// Add to existing service state
interface ServiceState {
  // ... existing fields ...
  operations: ServiceOperations;
}
```

### 3. Reset Endpoint Enhancement

```typescript
// POST /api/admin/circuit-breaker/{service}/reset
interface ResetRequest {
  reason: string;
  force?: boolean;
  metadata?: {
    triggeredBy: string;
    environment: string;
    notes?: string;
  };
}

interface ResetResponse {
  success: boolean;
  service: string;
  resetTime: string;
  previousState: {
    failureCount: number;
    lastFailure: string | null;
    totalIncidents: number;
  };
}
```

## Data Model Updates

### 1. Service Health History

```typescript
interface HealthHistoryEntry {
  timestamp: string;
  status: "healthy" | "degraded" | "failed";
  duration: number;
  incidents?: number;
}

// Maintain rolling history of service health
const HEALTH_HISTORY_RETENTION = 7 * 24 * 60 * 60 * 1000; // 7 days
```

### 2. Operation Metrics

```typescript
interface OperationMetrics {
  timeframe: "1h" | "24h" | "7d" | "30d";
  data: {
    requestCount: number;
    successCount: number;
    failureCount: number;
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
  };
}
```

## Implementation Notes

1. **WebSocket Connection Management**

   - Implement reconnection with exponential backoff
   - Maximum reconnection attempts: 5
   - Maintain client session state
   - Handle graceful disconnections

2. **Performance Considerations**

   - Batch updates when multiple services change state
   - Implement rate limiting for configuration changes
   - Cache service metrics with 5-second refresh
   - Use Redis for real-time metrics if possible

3. **Security Requirements**

   - Validate all configuration changes
   - Log all reset operations with metadata
   - Require admin privileges for all operations
   - Rate limit configuration changes per admin

4. **Error Handling**
   - Provide detailed error messages
   - Include error codes for client handling
   - Log all failed operations
   - Implement circuit breaker for admin operations

## Migration Guide

1. **Database Updates**

   ```sql
   ALTER TABLE circuit_breaker_config
   ADD COLUMN reset_timeout_ms INTEGER NOT NULL DEFAULT 30000,
   ADD COLUMN min_healthy_period_ms INTEGER NOT NULL DEFAULT 60000;

   CREATE TABLE circuit_breaker_history (
     id SERIAL PRIMARY KEY,
     service_name VARCHAR(255) NOT NULL,
     timestamp TIMESTAMP NOT NULL,
     status VARCHAR(50) NOT NULL,
     metrics JSONB NOT NULL
   );
   ```

2. **Cache Layer**

   - Implement Redis for real-time metrics
   - Set up cache invalidation rules
   - Configure cache timeouts

3. **Monitoring**
   - Add metrics for WebSocket connections
   - Track configuration changes
   - Monitor reset operations
   - Log service state transitions
