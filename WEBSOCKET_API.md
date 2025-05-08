## WebSocket API Documentation

This document outlines the WebSocket events used in DegenDuel.

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