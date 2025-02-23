# DegenDuel Circuit Breaker Architecture

## Overview

The DegenDuel circuit breaker system provides a unified approach to service reliability and fault tolerance. It combines local service monitoring with centralized management and real-time monitoring through WebSocket connections.

## Core Components

### 1. Circuit Breaker Configuration (`circuit-breaker-config.js`)
```typescript
interface CircuitBreakerConfig {
    enabled: boolean;
    failureThreshold: number;      // Default: 5
    resetTimeoutMs: number;        // Default: 60000 (1 minute)
    minHealthyPeriodMs: number;    // Default: 120000 (2 minutes)
    monitoringWindowMs: number;    // Default: 300000 (5 minutes)
    healthCheckIntervalMs: number; // Default: 30000 (30 seconds)
}
```

Service-specific configurations allow customization:
- Market Data Service: More sensitive (threshold: 3, faster reset)
- Contest Evaluation: More tolerant (threshold: 10, slower reset)

### 2. Service Manager Integration

The ServiceManager acts as the central authority for circuit breaker state:

```typescript
interface ServiceState {
    running: boolean;
    status: 'healthy' | 'degraded' | 'circuit_open' | 'unhealthy' | 'unknown';
    circuitBreaker: {
        isOpen: boolean;
        failures: number;
        lastFailure: string | null;
        lastSuccess: string | null;
        recoveryAttempts: number;
    };
    operations: {
        total: number;
        successful: number;
        failed: number;
    };
    performance: {
        averageOperationTimeMs: number;
        lastOperationTimeMs: number;
    };
}
```

### 3. Real-time Monitoring (WebSocket)

The circuit breaker WebSocket provides real-time monitoring:
- Connection Path: `/api/v2/ws/circuit-breaker`
- Authentication Required: Yes
- Message Types:
  - `service:update`: Individual service updates
  - `services:state`: Full system state
  - `service:health_check`: On-demand health checks

## Service Lifecycle

### 1. Normal Operation
- Services track their own statistics
- Regular health checks via ServiceManager
- State persisted in system_settings table
- Real-time updates broadcast via WebSocket

### 2. Failure Detection
```typescript
interface FailureHandling {
    incrementFailures(): void;
    checkThreshold(): boolean;
    notifyStateChange(): void;
}
```
- Failures tracked at service level
- Circuit opens when failures exceed threshold
- State change broadcast to all clients

### 3. Recovery Process
```typescript
interface RecoveryProcess {
    checkRecoveryEligibility(): boolean;
    attemptRecovery(): Promise<boolean>;
    resetState(): void;
}
```
- Automatic recovery attempts after resetTimeoutMs
- Gradual recovery with health checks
- Success requires minHealthyPeriodMs of stability

## Monitoring and Administration

### 1. Health Metrics
- Operation success/failure counts
- Response times and performance metrics
- Circuit breaker state and history
- Recovery attempt tracking

### 2. Administrative Controls
- Real-time service status monitoring
- Manual health check capability
- Service configuration management
- Circuit breaker reset functionality

## Implementation Details

### 1. Service Integration
```typescript
class BaseService {
    stats: ServiceStats;
    config: ServiceConfig;
    async checkHealth(): Promise<boolean>;
    async recordSuccess(): void;
    async handleError(error: Error): void;
}
```

### 2. State Management
- Centralized in ServiceManager
- Persistent storage in database
- Real-time WebSocket updates
- Automatic state recovery

### 3. WebSocket Communication
```typescript
interface WebSocketMessage {
    type: string;
    timestamp: string;
    service?: string;
    status?: string;
    circuit_breaker?: CircuitBreakerState;
    operations?: OperationStats;
    performance?: PerformanceMetrics;
}
```

## Security and Reliability

1. **Authentication**
   - Required for WebSocket connections
   - Admin privileges for configuration changes

2. **Rate Limiting**
   - WebSocket: 60 messages per minute
   - Health checks: Configurable interval

3. **Error Handling**
   - Graceful degradation
   - Automatic recovery attempts
   - Detailed error logging

## Monitoring Integration

1. **Metrics Collection**
   - Operation counts and success rates
   - Response times and latency
   - Circuit breaker state changes
   - Recovery attempt tracking

2. **Alerting**
   - Circuit breaker state changes
   - Consecutive failures
   - Recovery failures
   - Performance degradation 