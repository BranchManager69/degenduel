## WebSocket API Documentation

This document outlines the WebSocket events used in DegenDuel.

### Topic: `SYSTEM`

General system events, status updates, and connection management.

#### Action: `MAINTENANCE_MODE_UPDATE` (NEW)

Pushed by the server whenever the system maintenance mode status is changed by an admin.

**Direction:** Server -> Client

**Payload:**

```json
{
  "type": "EVENT",
  "topic": "SYSTEM",
  "action": "MAINTENANCE_MODE_UPDATE",
  "data": {
    "enabled": boolean // true if maintenance is active, false otherwise
  },
  "timestamp": "string" // ISO 8601 timestamp of when this message was sent by the server
}
```

**Example (Maintenance Enabled):**

```json
{
  "type": "EVENT",
  "topic": "SYSTEM",
  "action": "MAINTENANCE_MODE_UPDATE",
  "data": {
    "enabled": true
  },
  "timestamp": "2024-07-05T10:30:00.123Z"
}
```

**Example (Maintenance Disabled):**

```json
{
  "type": "EVENT",
  "topic": "SYSTEM",
  "action": "MAINTENANCE_MODE_UPDATE",
  "data": {
    "enabled": false
  },
  "timestamp": "2024-07-05T11:00:00.456Z"
}
```

Clients should subscribe to the `SYSTEM` topic to receive this message.

### Topic: `LAUNCH_EVENTS`

Events related to major launch or reveal activities.

#### Action: `ADDRESS_REVEALED`

Pushed by the server when the configured `countdown.end_time` is met and the contract address is revealed.

**Direction:** Server -> Client

**Payload:**

```json
{
  "type": "EVENT",
  "topic": "LAUNCH_EVENTS",
  "action": "ADDRESS_REVEALED",
  "data": {
    "contract_address": "string", // The revealed contract address
    "release_time": "string"      // ISO 8601 timestamp of the configured release time
  },
  "timestamp": "string"             // ISO 8601 timestamp of when this message was sent by the server
}
```

**Example:**

```json
{
  "type": "EVENT",
  "topic": "LAUNCH_EVENTS",
  "action": "ADDRESS_REVEALED",
  "data": {
    "contract_address": "0xAbCdEf1234567890abcdef1234567890ABCDEF12",
    "release_time": "2024-07-04T18:00:00.000Z"
  },
  "timestamp": "2024-07-04T18:00:00.123Z"
}
```

Clients should subscribe to the `LAUNCH_EVENTS` topic to receive this message. 