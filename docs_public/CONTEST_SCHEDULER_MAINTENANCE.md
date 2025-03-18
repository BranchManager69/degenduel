# Contest Scheduler Service Maintenance Mode Bypass

## Overview

The Contest Scheduler Service has been enhanced to continue operating during system maintenance mode. This ensures that scheduled contests are always created on time, even when the system is undergoing maintenance, providing uninterrupted service to users.

## Implementation Details

### 1. Service Authentication

The Contest Scheduler Service uses the service authentication system to bypass maintenance mode. When making internal API requests, it includes a special authentication header that gets validated by the maintenance middleware:

```javascript
// From config/service-auth.js
const authHeader = generateServiceAuthHeader();
// Creates: { 'X-Service-Auth': `${timestamp}.${signature}` }
```

### 2. Direct Database Access

For critical operations like creating contests, the service uses direct database transactions via Prisma, which work even during maintenance mode:

```javascript
// Example from createScheduledContest method
const result = await prisma.$transaction(async (prisma) => {
  // Create contest and wallet records
  // This bypasses API middleware and works during maintenance
});
```

### 3. Maintenance Mode Detection

The service can check if the system is in maintenance mode:

```javascript
async isInMaintenanceMode() {
  const setting = await prisma.system_settings.findUnique({
    where: { key: "maintenance_mode" }
  });
  
  return setting?.value?.enabled === true;
}
```

### 4. Detailed Logging and Statistics

The service tracks detailed statistics about operations performed during maintenance mode:

- Total operations during maintenance
- Contests created during maintenance
- Timestamps of maintenance operations
- Success/failure rates during maintenance

### 5. Controller Enhancements

The API controller provides maintenance mode information in status responses:

```json
{
  "success": true,
  "status": {
    "isRunning": true,
    "maintenance": {
      "systemInMaintenanceMode": true,
      "serviceOperatingDuringMaintenance": true,
      "operationsDuringMaintenance": 5,
      "contestsCreatedDuringMaintenance": 2,
      "lastMaintenanceOperation": "2025-03-15T12:30:45.123Z"
    }
  }
}
```

## Testing

A test script has been created to verify the maintenance mode bypass functionality:

```
node scripts/test-contest-scheduler-maintenance.js
```

This script:
1. Checks the current maintenance mode status
2. Enables maintenance mode temporarily
3. Attempts to create a contest during maintenance mode
4. Tests the `performOperation` method during maintenance
5. Restores the original maintenance mode setting

## Benefits

- **Uninterrupted Service**: Contests are always created on time, regardless of system maintenance
- **Reliable Scheduling**: Users can depend on contests being available as scheduled
- **Operational Flexibility**: System maintenance can be performed without disrupting contest schedules
- **Enhanced Monitoring**: Detailed statistics about operations during maintenance

## Maintenance Mode Bypass Best Practices

1. Only essential services should bypass maintenance mode
2. All bypass operations should be thoroughly logged
3. Use the service authentication system for any API calls
4. Prefer direct database access for critical operations
5. Maintain detailed statistics for operations during maintenance