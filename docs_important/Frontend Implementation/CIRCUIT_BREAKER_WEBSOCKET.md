# Circuit Breaker WebSocket Integration Guide

## Overview

The Circuit Breaker WebSocket provides real-time monitoring of service health and circuit breaker states across the DegenDuel platform.

### Connection Details
- **WebSocket URL**: `wss://[API_HOST]/api/v2/ws/circuit-breaker`
- **Authentication**: Required (JWT token)
- **Rate Limit**: 60 messages per minute
- **Max Message Size**: 16KB

## Authentication

Send the JWT token in one of these ways:
1. WebSocket Protocol header
2. URL parameter: `?token=YOUR_JWT_TOKEN`

```typescript
const token = getAuthToken(); // Your JWT token
const ws = new WebSocket('wss://api.degenduel.me/api/v2/ws/circuit-breaker', token);
```

## Message Types

### 1. Connection Status
```typescript
interface ConnectionStatusMessage {
    type: 'connection:status';
    status: 'connected' | 'disconnected';
    timestamp: string;
}
```

### 2. Service Updates
```typescript
interface ServiceUpdateMessage {
    type: 'service:update';
    timestamp: string;
    services: Array<{
        service: string;
        status: 'healthy' | 'degraded' | 'failed' | 'unknown';
        circuit: {
            state: 'open' | 'closed';
            failureCount: number;
            lastFailure: string | null;
            recoveryAttempts: number;
        };
        operations: {
            total: number;
            successful: number;
            failed: number;
        };
    }>;
}
```

### 3. Error Messages
```typescript
interface ErrorMessage {
    type: 'error';
    code: number;
    message: string;
    timestamp: string;
}
```

## Client Implementation Example

```typescript
class CircuitBreakerMonitor {
    private ws: WebSocket;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000; // Start with 1 second

    constructor(private token: string) {
        this.connect();
    }

    private connect() {
        this.ws = new WebSocket('wss://api.degenduel.me/api/v2/ws/circuit-breaker', this.token);
        
        this.ws.onopen = this.handleOpen.bind(this);
        this.ws.onmessage = this.handleMessage.bind(this);
        this.ws.onclose = this.handleClose.bind(this);
        this.ws.onerror = this.handleError.bind(this);
    }

    private handleOpen() {
        console.log('Connected to circuit breaker monitor');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        // Subscribe to service updates
        this.send({
            type: 'subscribe:services'
        });
    }

    private handleMessage(event: MessageEvent) {
        const message = JSON.parse(event.data);
        
        switch (message.type) {
            case 'connection:status':
                this.handleConnectionStatus(message);
                break;
            
            case 'service:update':
                this.handleServiceUpdate(message);
                break;
            
            case 'error':
                this.handleErrorMessage(message);
                break;
        }
    }

    private handleClose() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            setTimeout(() => {
                this.reconnectAttempts++;
                this.reconnectDelay *= 2; // Exponential backoff
                this.connect();
            }, this.reconnectDelay);
        }
    }

    private handleError(error: Event) {
        console.error('WebSocket error:', error);
    }

    private send(message: any) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    // Example handlers
    private handleConnectionStatus(message: ConnectionStatusMessage) {
        console.log('Connection status:', message.status);
    }

    private handleServiceUpdate(message: ServiceUpdateMessage) {
        message.services.forEach(service => {
            console.log(`Service ${service.service} status: ${service.status}`);
            if (service.circuit.state === 'open') {
                console.warn(`Circuit breaker open for ${service.service}`);
            }
        });
    }

    private handleErrorMessage(message: ErrorMessage) {
        console.error('WebSocket error:', message);
    }
}
```

## Service States

Services can be in one of four states:
- `healthy`: Service is operating normally
- `degraded`: Service has some failures but is still operating
- `failed`: Service circuit breaker is open
- `unknown`: Service state cannot be determined

## Circuit Breaker States

Circuit breakers can be in one of two states:
- `closed`: Service is accepting requests
- `open`: Service is rejecting requests due to failures

## Update Frequency

- Initial state sent on connection
- Real-time updates when service states change
- Periodic updates every 5 seconds

## Error Codes

- `4001`: Authentication failed
- `4003`: Unauthorized
- `4004`: Invalid message format
- `4029`: Rate limit exceeded

## Best Practices

1. **Connection Management**
   - Implement exponential backoff for reconnection attempts
   - Reset reconnection counters on successful connection
   - Monitor connection health with the automatic heartbeat

2. **Error Handling**
   - Handle all error codes appropriately
   - Log errors for debugging
   - Show relevant UI feedback for different error types

3. **State Management**
   - Keep local state synchronized with server updates
   - Handle out-of-order messages gracefully
   - Update UI immediately on state changes

4. **Performance**
   - Process messages asynchronously
   - Batch UI updates when possible
   - Clean up resources when connection closes

## Example UI Implementation

```typescript
interface CircuitBreakerDashboardProps {
    token: string;
}

const CircuitBreakerDashboard: React.FC<CircuitBreakerDashboardProps> = ({ token }) => {
    const [services, setServices] = useState<ServiceState[]>([]);
    const [connected, setConnected] = useState(false);
    const monitorRef = useRef<CircuitBreakerMonitor | null>(null);

    useEffect(() => {
        monitorRef.current = new CircuitBreakerMonitor(token);
        
        // Handle service updates
        monitorRef.current.onServiceUpdate = (services) => {
            setServices(services);
        };

        // Handle connection status
        monitorRef.current.onConnectionStatus = (status) => {
            setConnected(status === 'connected');
        };

        return () => {
            monitorRef.current?.disconnect();
        };
    }, [token]);

    return (
        <div className="circuit-breaker-dashboard">
            <ConnectionStatus connected={connected} />
            
            <ServiceList>
                {services.map(service => (
                    <ServiceCard
                        key={service.service}
                        service={service}
                        onReset={handleReset}
                    />
                ))}
            </ServiceList>
        </div>
    );
};
```

## Testing

1. **Connection Testing**
   ```typescript
   // Test connection with invalid token
   const monitor = new CircuitBreakerMonitor('invalid-token');
   // Should receive 4001 error
   
   // Test connection with valid token
   const monitor = new CircuitBreakerMonitor(validToken);
   // Should receive connection:status message
   ```

2. **Message Handling**
   ```typescript
   // Test service update handling
   monitor.handleMessage({
       type: 'service:update',
       services: [/* test data */]
   });
   
   // Test error handling
   monitor.handleMessage({
       type: 'error',
       code: 4029,
       message: 'Rate limit exceeded'
   });
   ```

---

For any questions or clarifications, please contact the DegenDuel Platform Team. 