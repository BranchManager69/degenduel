# WebSocket Deprecation and Migration Plan

## Overview

This document outlines the plan to deprecate the legacy WebSocket implementation in favor of the new v69 implementation. The v69 implementation provides better performance, reliability, and maintainability.

## Migration Timeline

| Phase | Description | Estimated Timeframe |
|-------|-------------|---------------------|
| 1 | Mark legacy WebSockets as deprecated | Immediate |
| 2 | Create v69 versions of all remaining WebSockets | 1-2 weeks |
| 3 | Test and validate v69 implementations | 1-2 weeks |
| 4 | Redirect client traffic to v69 endpoints | 1 week |
| 5 | Remove legacy WebSocket implementations | After 3 months |

## Current Status

To check the current migration status, run:

```bash
npm run wss:migration
```

This will display:
- WebSockets with both legacy and v69 implementations
- WebSockets with only legacy implementations (need migration)
- WebSockets with only v69 implementations (fully migrated)
- Overall migration progress

## Migration Steps

### For Each WebSocket Service:

1. **Create v69 Version**:
   - Copy the functionality from the legacy implementation to a new file in the `websocket/v69/` directory
   - Use the v69 base WebSocket class
   - Update any dependencies to use v69 versions
   - Ensure proper error handling and logging

2. **Test v69 Implementation**:
   - Verify it correctly handles all message types
   - Test authentication flow
   - Verify all event subscriptions work
   - Check proper channel/room management
   - Test error scenarios

3. **Update Client Code**:
   - For internal clients, update to use v69 endpoints
   - For external clients, maintain backward compatibility during transition

4. **Redirect Traffic**:
   - Update the initializer to use v69 implementations instead of legacy
   - Monitor for any issues during the transition period

### System-Wide Changes:

1. **Update Documentation**:
   - Deprecate all legacy WebSocket API documentation
   - Create new documentation for v69 endpoints
   - Provide migration guides for client applications

2. **Monitoring and Alerts**:
   - Set up monitoring for both legacy and v69 endpoints during transition
   - Create alerts for any issues specific to the migration

## Implementation Details

### Endpoint Mapping

Legacy endpoints typically start with `/ws/` while v69 endpoints use `/api/v69/ws/`. The mapping is:

| Legacy Endpoint | v69 Endpoint |
|----------------|--------------|
| /ws/monitor | /api/v69/ws/monitor |
| /ws/contest | /api/v69/ws/contest |
| /ws/circuit-breaker | /api/v69/ws/circuit-breaker |
| /ws/notifications | /api/v69/ws/notifications |
| /ws/token-data | /api/v69/ws/token-data |
| /ws/skyduel | /api/v69/ws/skyduel |
| /ws/system-settings | /api/v69/ws/system-settings |
| /ws/analytics | /api/v69/ws/analytics |

### Message Format Changes

The v69 implementation uses a slightly different message format:

- **Legacy format**:
  ```json
  {
    "type": "event_name",
    "data": { ... }
  }
  ```

- **v69 format**:
  ```json
  {
    "event": "event_name",
    "channel": "channel_name",
    "data": { ... },
    "requestId": "optional_request_id"
  }
  ```

### Authentication Changes

The v69 implementation uses the same JWT tokens but handles authentication slightly differently:

- Legacy uses custom auth headers
- v69 standardizes on the Authorization header with Bearer token

## Rollback Plan

If major issues are discovered during migration:

1. Immediately revert to legacy WebSocket implementations
2. Log and investigate issues in v69 implementation
3. Fix issues and retry migration with more gradual approach

## Conclusion

The migration to v69 WebSocket implementation will improve performance, maintainability, and provide a more consistent API. By following this plan, we can ensure a smooth transition with minimal disruption to users.