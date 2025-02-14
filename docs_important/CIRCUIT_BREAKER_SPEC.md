# Circuit Breaker System Specification

## Overview

The Circuit Breaker system provides real-time monitoring and protection for DegenDuel's microservices architecture. It includes:
- Real-time service state monitoring
- Automatic service protection
- Incident tracking and management
- Configuration management
- WebSocket-based real-time updates

## System Components

### 1. Database Schema

```prisma
model circuit_breaker_states {
  id                Int       @id @default(autoincrement())
  service_name      String    @unique
  state            String    @default("closed") // closed, open, half-open
  failure_count    Int       @default(0)
  last_failure     DateTime?
  recovery_attempts Int       @default(0)
  updated_at       DateTime  @updatedAt
  config           circuit_breaker_config?
  incidents        circuit_breaker_incidents[]

  @@index([state])
  @@map("circuit_breaker_states")
}

model circuit_breaker_incidents {
  id            String    @id @default(uuid())
  service_name  String
  type          String
  severity      String
  status        String    @default("active")
  message       String
  start_time    DateTime  @default(now())
  end_time      DateTime?
  metrics       Json?
  state         circuit_breaker_states @relation(fields: [service_name], references: [service_name])

  @@index([service_name, status])
  @@index([start_time])
  @@map("circuit_breaker_incidents")
}

model circuit_breaker_config {
  service_name      String    @id
  failure_threshold Int       @default(5)
  recovery_timeout  Int       @default(30000)
  request_limit     Int       @default(100)
  monitoring_window Int       @default(60000)
  minimum_requests  Int       @default(10)
  updated_at       DateTime  @updatedAt
  state            circuit_breaker_states @relation(fields: [service_name], references: [service_name])

  @@map("circuit_breaker_config")
}
```

### 2. WebSocket Protocol

#### Connection Details
- **Endpoint**: `wss://api.degenduel.me/api/admin/circuit-breaker`
- **Authentication**: Requires admin session token in WebSocket protocol
- **Heartbeat**: 30-second interval with ping/pong
- **Auto-reconnect**: Implemented with exponential backoff

#### Message Types

##### Server → Client Messages
```typescript
interface ServerMessage {
  type: 'health:update' | 'metrics:update' | 'breaker:trip' | 
        'breaker:reset' | 'incident:ack' | 'config:update';
  timestamp: string;
  service?: string;
  data: {
    // Health Update
    services?: Array<{
      name: string;
      status: 'healthy' | 'degraded' | 'failed';
      circuit: {
        state: 'closed' | 'open' | 'half-open';
        failureCount: number;
        lastFailure: string | null;
        recoveryAttempts: number;
      };
      config?: {
        failureThreshold: number;
        recoveryTimeout: number;
        requestLimit: number;
      };
    }>;
    systemHealth?: {
      status: 'operational' | 'degraded' | 'critical';
      activeIncidents: number;
      lastIncident: string | null;
    };

    // Metrics Update
    metrics?: {
      requestRate: number;
      errorRate: number;
      responseTime: number;
      cpuUsage: number;
      memoryUsage: number;
      activeConnections: number;
    };

    // Incident Data
    incident?: {
      id: string;
      type: string;
      severity: 'warning' | 'critical';
      message: string;
      details?: Record<string, any>;
    };
  };
}
```

##### Client → Server Messages
```typescript
interface ClientMessage {
  type: 'init' | 'ping' | 'ack' | 'config_update';
  timestamp: string;
  data?: {
    incidentId?: string;  // For 'ack' type
    service?: string;     // For 'config_update' type
    config?: CircuitBreakerConfig;  // For 'config_update' type
  };
}
```

### 3. REST API Endpoints

#### Get Circuit Breaker States
```typescript
GET /api/admin/circuit-breaker/states

Response:
{
  services: Array<{
    status: 'healthy' | 'degraded' | 'failed';
    metrics: {
      requestCount: number;
      errorCount: number;
      lastError: string | null;
      meanResponseTime: number;
      failurePercentage: number;
    };
    circuit: {
      state: 'closed' | 'open' | 'half-open';
      failureCount: number;
      lastFailure: string | null;
      recoveryAttempts: number;
    };
    config: {
      failureThreshold: number;
      recoveryTimeout: number;
      requestLimit: number;
    };
  }>;
  systemHealth: {
    status: 'operational' | 'degraded' | 'critical';
    activeIncidents: number;
    lastIncident: string | null;
  };
}
```

#### Update Circuit Breaker Configuration
```typescript
POST /api/admin/circuit-breaker/{service}/config

Request Body:
{
  failureThreshold: number;
  recoveryTimeout: number;
  requestLimit: number;
  monitoringWindow: number;
  minimumRequests: number;
}

Response:
{
  service: string;
  config: CircuitBreakerConfig;
}
```

#### Get Incident History
```typescript
GET /api/admin/circuit-breaker/incidents

Query Parameters:
- start_date: ISO timestamp
- end_date: ISO timestamp
- service: string
- severity: 'warning' | 'critical'
- status: 'active' | 'resolved'
- limit: number (default: 50)
- offset: number (default: 0)

Response:
{
  total: number;
  incidents: Array<{
    id: string;
    service: string;
    type: string;
    severity: string;
    status: string;
    message: string;
    startTime: string;
    endTime: string | null;
    metrics: any;
  }>;
}
```

#### Reset Circuit Breaker
```typescript
POST /api/admin/circuit-breaker/{service}/reset

Request Body:
{
  reason?: string;
  force?: boolean;
}

Response:
{
  service: string;
  state: {
    state: 'closed';
    failureCount: 0;
    recoveryAttempts: 0;
    updated_at: string;
  };
  reset: {
    timestamp: string;
    reason: string | null;
    forced: boolean;
  };
}
```

### 4. Error Handling

All endpoints return standardized error responses:
```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
```

Common error codes:
- `FETCH_FAILED`: Failed to retrieve data
- `UPDATE_FAILED`: Failed to update configuration
- `INVALID_CONFIG`: Invalid configuration parameters
- `SERVICE_NOT_FOUND`: Service doesn't exist
- `ALREADY_CLOSED`: Circuit breaker already closed
- `RESET_FAILED`: Failed to reset circuit breaker

## Frontend Implementation Guide

### 1. WebSocket Client Implementation
```typescript
class CircuitBreakerClient {
  connect() {
    // Connect to WebSocket
    // Handle reconnection
    // Process messages
  }

  handleMessage(message: ServerMessage) {
    // Update UI based on message type
  }

  acknowledgeIncident(incidentId: string) {
    // Send acknowledgment
  }

  updateConfig(service: string, config: CircuitBreakerConfig) {
    // Send config update
  }
}
```

### 2. Required UI Components
1. Real-time Status Dashboard
   - Service health indicators
   - Circuit breaker states
   - System metrics

2. Service Configuration Panel
   - Threshold configuration
   - Timeout settings
   - Request limits

3. Incident Management
   - Active incidents list
   - Historical incident view
   - Incident acknowledgment

4. Manual Controls
   - Circuit breaker reset
   - Force reset option
   - Configuration updates

### 3. State Management Requirements
- Track real-time service states
- Maintain incident history
- Cache configuration settings
- Handle WebSocket reconnection
- Manage error states

## Security Requirements

1. Authentication
   - Require valid admin session token
   - Validate token on each request
   - Handle token expiration

2. Authorization
   - Restrict access to superadmin role
   - Log all administrative actions
   - Validate all configuration changes

3. Data Protection
   - Sanitize error messages
   - Validate all input
   - Rate limit requests

## Metrics and Monitoring

### Key Metrics
1. Service Health
   - Request success rate
   - Error rate
   - Average response time
   - Circuit breaker state changes

2. System Resources
   - CPU utilization
   - Memory usage
   - Network I/O
   - Active connections

3. Incidents
   - Active incident count
   - Mean time between failures
   - Mean time to recovery
   - Resolution time

### Alert Thresholds
1. Warning Levels
   - Error rate > 5%
   - Response time > 1000ms
   - CPU usage > 70%
   - Memory usage > 80%

2. Critical Levels
   - Error rate > 20%
   - Response time > 5000ms
   - CPU usage > 90%
   - Memory usage > 90%

## Migration Plan

1. Deploy WebSocket endpoint
2. Implement basic monitoring
3. Add circuit breaker logic
4. Enable metrics collection
5. Implement incident tracking
6. Enable manual controls
7. Add advanced features

## Testing Requirements

1. Unit tests for circuit breaker logic
2. Integration tests for WebSocket
3. Load testing for metrics collection
4. Chaos testing for failure scenarios
5. Security testing for authentication
