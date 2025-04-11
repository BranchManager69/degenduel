# DegenDuel Logging System

This directory contains the comprehensive logging system for the DegenDuel platform.

## Features

- Console logging with color and formatting
- File logging with daily rotation
- Logtail integration for centralized log management
- Service logs for AI analysis
- Analytics tracking
- IP information lookup
- User session and interaction tracking
- Performance metrics tracking
- Feature usage tracking

## Usage

### Basic Logging

```javascript
import { logApi } from 'utils/logger-suite/logger.js';

// Simple logging
logApi.info('This is an info message');
logApi.warn('This is a warning message');
logApi.error('This is an error message', { error: new Error('Something went wrong') });
logApi.debug('This is a debug message');
```

### Service-Specific Logging

```javascript
import { logApi } from 'utils/logger-suite/logger.js';

// Create a service-specific logger
const logger = logApi.forService('solana_engine');

// Log with service context
logger.info('Solana engine initialized', { version: '1.0.0' });
logger.error('RPC connection failed', { endpoint: 'rpc.solana.com', error: 'Timeout' });
```

### Service Logs

Service logs are automatically written to the database for AI analysis. These logs provide structured data
that can be queried and analyzed by the AI service.

```javascript
// These logs are automatically written to the database
const logger = logApi.forService('token_refresh');
logger.info('Token refresh complete', { 
  tokenAddress: 'abc123',
  eventType: 'refresh_complete',
  durationMs: 150,
  relatedEntity: 'abc123'
});

// Direct API for service logs
await logApi.serviceLog.write(
  'my_service',
  'info',
  'Custom service log',
  { data: 'details' },
  { metadata: 'extra info' },
  'custom_event',
  123,
  'related-entity-id'
);

// Cleanup old service logs
await logApi.serviceLog.cleanup(30); // Delete logs older than 30 days
await logApi.serviceLog.cleanup(7, 'solana_engine'); // Delete logs for specific service
```

### Analytics

```javascript
import { logApi } from 'utils/logger-suite/logger.js';

// Track user session
logApi.analytics.trackSession(user, request.headers);

// Track user interaction
logApi.analytics.trackInteraction(user, 'button_click', { buttonId: 'submit' }, request.headers);

// Track performance metrics
logApi.analytics.trackPerformance({
  total_requests: 1000,
  avg_response_time: 150,
  max_response_time: 500
});

// Track feature usage
logApi.analytics.trackFeature('contest_join', user, { contestId: 123 });
```

## Database Schema

Service logs are stored in the `service_logs` table with the following schema:

```prisma
model service_logs {
  id                 Int       @id @default(autoincrement())
  service            String    @db.VarChar(50) // Service identifier (e.g., 'solana_engine', 'token_refresh')
  level              String    @db.VarChar(20) // Log level (info, warn, error, debug)
  message            String    @db.Text // The log message
  details            Json?     @default("{}") // Additional structured details
  metadata           Json?     @default("{}") // Extra context data
  instance_id        String?   @db.VarChar(100) // For multi-instance services
  created_at         DateTime  @default(now()) @db.Timestamptz(6)
  related_entity     String?   @db.VarChar(100) // Related entity (token address, contest ID, etc.)
  event_type         String?   @db.VarChar(50) // Type of event (restart, health check, etc.)
  duration_ms        Int?      // For performance tracking
  environment        String?   @db.VarChar(20) // Production, staging, etc.
  
  @@index([service, level])
  @@index([created_at])
  @@index([service, created_at])
  @@index([level, created_at])
  @@index([related_entity])
  @@index([event_type])
  @@map("service_logs")
}
```

## Special Parameters

When using service loggers, you can include special parameters in the metadata:

- `eventType` or `event_type`: Categorizes the log entry
- `durationMs` or `duration_ms`: Performance metric in milliseconds
- `relatedEntity` or `related_entity`: Associated entity ID (token, contest, etc.)
- `persistToDb`: For debug logs, set to `true` to force database persistence
- `important`: For debug logs, set to `true` to force database persistence

For HTTP logs, status codes >= 400 are automatically persisted to the database.

## Log Analysis

Service logs are analyzed by the AI service at regular intervals. See the
AI service configuration for details on analysis frequency and parameters.