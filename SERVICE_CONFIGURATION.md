# DegenDuel Dynamic Service Configuration

This document provides comprehensive information about the dynamic service configuration system implemented in DegenDuel, which allows services to be reconfigured without requiring a server restart.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema)
4. [Configuration API](#configuration-api)
5. [Integration with Services](#integration-with-services)
6. [Monitoring & Troubleshooting](#monitoring--troubleshooting)
7. [Examples](#examples)
8. [Future Enhancements](#future-enhancements)

## Overview

The dynamic service configuration system provides several key benefits:

- **Hot-Reloading**: Services can be reconfigured without restarting the server
- **Centralized Management**: Configuration is stored in a dedicated database table
- **Service-Specific Settings**: Each service can have its own configuration
- **Admin Interface**: REST API for managing service configurations
- **Fault Tolerance**: Caching and fallbacks ensure stability even if database access fails

Currently, the system supports the following configuration parameters:

- `check_interval_ms`: How frequently a service performs its main operation
- `enabled`: Whether a service is enabled or disabled
- `circuit_breaker`: Circuit breaker configuration
- `backoff`: Backoff strategy configuration
- `thresholds`: Service-specific thresholds

## Architecture

The dynamic service configuration system consists of several components:

1. **Database Layer**: The `service_configuration` table in PostgreSQL
2. **Adapter**: `service-interval-adapter.js` provides a bridge between services and the database
3. **Admin API**: REST endpoints for viewing and updating configurations
4. **Service Integration**: Services can opt-in to dynamic configuration

This design allows for incremental adoption without having to modify the BaseService class. Services can individually decide whether to use dynamic configuration.

### System Flow

1. Service initializes with default configuration from code
2. Service periodically checks database for configuration updates (every 30s)
3. If changes are detected, service reconfigures itself on the fly
4. Admins can view and update configuration through the REST API

![Architecture Diagram](https://mermaid.ink/img/pako:eNqNkk9PwzAMxb9KlBOI9Q-HHpBAaAcOiB2QRuamXuuRxFHiVFSl392kXdOybRz6Ysfv2X72cwYeAkIG5Tjn9xPWfXAoEz7mRrttWGnhI1FjF0N0NyGGFrj2Maa3-GIbHcmvtOkS0vWsObCt9jEMsqiD17S86Ol91rVDG7bZuoxKXMGZ1S1anK-lGKEeKVrV4EKohghtBIZamUIaGu9z3AXqrfbNF9obZ5a1cLZ0j0Q38W0Tqu15qdwS93FYTlpNEn0e-8Uv_vZv54WtH7uPT2k_lSfOoDCVLpSkDZEiQyrlMmqhuTLKVnRWl5jBcgoPoDrRUAxz-CFNojQ0q7YbQbaGDOZDpYJfQAaTh1-IG6I5f4UMNoKu9gqP1vv1bmBt0NdoOu-XQg_Dl1glJTQ?type=png)

## Database Schema

### service_configuration Table

This table stores the configuration for each service:

```sql
CREATE TABLE "service_configuration" (
    "id" TEXT NOT NULL,
    "service_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "check_interval_ms" INTEGER NOT NULL DEFAULT 60000,
    "circuit_breaker" JSONB,
    "backoff" JSONB,
    "thresholds" JSONB,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "last_run_at" TIMESTAMP(3),
    "last_run_duration_ms" INTEGER,
    "last_status" TEXT,
    "status_message" TEXT,

    CONSTRAINT "service_configuration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_configuration_service_name_key" 
ON "service_configuration"("service_name");
```

#### Fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT | Unique identifier |
| `service_name` | TEXT | Service identifier (unique) |
| `display_name` | TEXT | Human-readable name |
| `enabled` | BOOLEAN | Whether the service is enabled |
| `check_interval_ms` | INTEGER | Service check interval in milliseconds |
| `circuit_breaker` | JSONB | Circuit breaker configuration |
| `backoff` | JSONB | Backoff configuration |
| `thresholds` | JSONB | Service-specific thresholds |
| `last_updated` | TIMESTAMP | When the configuration was last updated |
| `updated_by` | TEXT | Admin who made the update |
| `last_run_at` | TIMESTAMP | When the service last ran |
| `last_run_duration_ms` | INTEGER | Duration of the last run in milliseconds |
| `last_status` | TEXT | Last known status |
| `status_message` | TEXT | Last status message |

## Configuration API

The following REST API endpoints are available for managing service configurations:

### GET /admin/service-config

Lists all service configurations.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "clu1abc123",
      "service_name": "liquidity_service",
      "display_name": "Liquidity Service",
      "enabled": true,
      "check_interval_ms": 60000,
      "circuit_breaker": {
        "failureThreshold": 6,
        "resetTimeoutMs": 75000,
        "minHealthyPeriodMs": 120000
      },
      "backoff": {
        "initialDelayMs": 1000,
        "maxDelayMs": 30000,
        "factor": 2
      },
      "thresholds": {
        "minBalance": 0.05
      },
      "last_updated": "2025-03-30T20:56:52.332Z",
      "updated_by": "migration_script",
      "last_run_at": null,
      "last_run_duration_ms": null,
      "last_status": "active",
      "status_message": null
    }
  ]
}
```

### GET /admin/service-config/:serviceName

Gets a specific service configuration.

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "clu1abc123",
    "service_name": "liquidity_service",
    "display_name": "Liquidity Service",
    "enabled": true,
    "check_interval_ms": 60000,
    "circuit_breaker": {
      "failureThreshold": 6,
      "resetTimeoutMs": 75000,
      "minHealthyPeriodMs": 120000
    },
    "backoff": {
      "initialDelayMs": 1000,
      "maxDelayMs": 30000,
      "factor": 2
    },
    "thresholds": {
      "minBalance": 0.05
    },
    "last_updated": "2025-03-30T20:56:52.332Z",
    "updated_by": "migration_script",
    "last_run_at": null,
    "last_run_duration_ms": null,
    "last_status": "active",
    "status_message": null
  }
}
```

### PATCH /admin/service-config/:serviceName/interval

Updates just the interval for a service.

**Request:**

```json
{
  "check_interval_ms": 120000
}
```

**Response:**

```json
{
  "success": true,
  "message": "Updated interval for liquidity_service to 120000ms",
  "data": {
    "id": "clu1abc123",
    "service_name": "liquidity_service",
    "display_name": "Liquidity Service",
    "check_interval_ms": 120000,
    // ... other fields
  }
}
```

### PATCH /admin/service-config/:serviceName

Updates a service configuration.

**Request:**

```json
{
  "display_name": "Updated Liquidity Service",
  "enabled": true,
  "check_interval_ms": 120000,
  "circuit_breaker": {
    "failureThreshold": 10,
    "resetTimeoutMs": 90000
  }
}
```

**Response:**

```json
{
  "success": true,
  "message": "Updated configuration for liquidity_service",
  "data": {
    "id": "clu1abc123",
    "service_name": "liquidity_service",
    "display_name": "Updated Liquidity Service",
    "enabled": true,
    "check_interval_ms": 120000,
    "circuit_breaker": {
      "failureThreshold": 10,
      "resetTimeoutMs": 90000,
      "minHealthyPeriodMs": 120000
    },
    // ... other fields
  }
}
```

## Integration with Services

There are two approaches to integrate services with dynamic configuration:

### 1. Adapter-based Approach (Current)

Services can use the `service-interval-adapter.js` module to periodically check for configuration updates without modifying the BaseService class. This approach is recommended for incremental adoption.

```javascript
// In a service
import { getServiceInterval } from '../utils/service-suite/service-interval-adapter.js';

// Periodically check for interval changes (in the service)
async function dynamicIntervalCheck() {
  const configuredInterval = await getServiceInterval(
    this.name,
    this.config.checkIntervalMs // Default
  );
  
  if (this.config.checkIntervalMs !== configuredInterval) {
    // Update interval
    this.config.checkIntervalMs = configuredInterval;
    
    // Restart interval if running
    if (this.isStarted && this.operationInterval) {
      clearInterval(this.operationInterval);
      this.operationInterval = setInterval(
        () => this.performOperation().catch(err => this.handleError(err)),
        this.config.checkIntervalMs
      );
    }
  }
  
  // Schedule next check (every 30 seconds)
  setTimeout(() => this.dynamicIntervalCheck(), 30000);
}
```

### 2. BaseService Approach (Future)

In the future, the BaseService class could be modified to intrinsically support dynamic configuration. This would require a branch and careful testing to ensure it doesn't break existing services.

## Monitoring & Troubleshooting

### Logs

Services that use dynamic configuration will log when they detect and apply changes:

```
[liquidityService] INTERVAL UPDATED 60000ms → 120000ms
```

### Common Issues

1. **Changes not taking effect**: Check the service logs to see if the service detected the change. Ensure the service is running and the configuration exists in the database.

2. **Service crashes after configuration change**: If a service crashes after a configuration change, check the logs for errors. If the new configuration is invalid, you can revert it through the API.

3. **Database errors**: If there are database connectivity issues, services will fall back to their default configurations to maintain stability.

## Examples

### Example 1: Updating the Liquidity Service Interval

```http
PATCH /admin/service-config/liquidity_service/interval
Content-Type: application/json

{
  "check_interval_ms": 120000
}
```

This would change the Liquidity Service to run every 2 minutes instead of 1 minute. The service will detect this change within 30 seconds and reconfigure itself without requiring a restart.

### Example 2: Disabling a Service Temporarily

```http
PATCH /admin/service-config/token_sync_service
Content-Type: application/json

{
  "enabled": false
}
```

This would temporarily disable the Token Sync Service. The service will detect this change and stop its operations until re-enabled.

### Example 3: Adjusting Circuit Breaker Thresholds

```http
PATCH /admin/service-config/contest_evaluation_service
Content-Type: application/json

{
  "circuit_breaker": {
    "failureThreshold": 15,
    "resetTimeoutMs": 180000
  }
}
```

This would make the Contest Evaluation Service more tolerant of failures (15 failures instead of 10) and increase the reset timeout to 3 minutes.

## Future Enhancements

1. **Admin UI**: Develop a UI for easier management of service configurations
2. **BaseService Integration**: Modify BaseService to intrinsically support dynamic configuration
3. **Configuration Versioning**: Track history of configuration changes
4. **Configuration Profiles**: Save and apply different configuration profiles for different scenarios
5. **Service Health Dashboard**: Visualize service health metrics along with configurations

## Important Notes

- For security reasons, all configuration API endpoints require admin authentication
- Configuration changes are logged in the admin action log for audit purposes
- Services will fall back to their default configurations if database access fails
- Interval values have a minimum limit of 1000ms (1 second) to prevent excessive CPU/database load

## Technical Details

- The adapter uses a cache with a 10-second TTL to minimize database load
- Configuration changes take effect within a maximum of 30 seconds (configurable)
- All numerical values are stored in milliseconds for consistency