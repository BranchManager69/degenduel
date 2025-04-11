# Token Refresh Scheduler Admin API Routes

This document details the admin API routes available for the Advanced Token Refresh Scheduler. These endpoints allow administrators to monitor and control the token refresh system.

## Base URL

All routes are prefixed with:

```
/api/admin/token-refresh
```

## Authentication

All routes require authentication with either `admin` or `superadmin` roles via JWT.

## Available Endpoints

### Get Scheduler Status

Get the current status and metrics of the token refresh scheduler.

```
GET /api/admin/token-refresh/status
```

**Response**

```json
{
  "success": true,
  "data": {
    "currentWindow": {
      "startTime": "2025-04-10T12:34:56.789Z",
      "batchesAttempted": 150,
      "batchesCompleted": 147,
      "tokensAttempted": 7350,
      "tokensUpdated": 7200,
      "apiCalls": 150,
      "durationMs": 60000,
      "errorCount": 3
    },
    "totals": {
      "batchesAttempted": 5280,
      "batchesCompleted": 5250,
      "batchesFailed": 30,
      "tokensAttempted": 264000,
      "tokensUpdated": 262500,
      "tokensFailed": 1500,
      "apiCalls": 5280
    },
    "performance": {
      "avgBatchDurationMs": 250,
      "maxBatchDurationMs": 850,
      "minBatchDurationMs": 120,
      "p95BatchDurationMs": 400,
      "successRate": 0.994
    },
    "scheduler": {
      "isRunning": true,
      "activeTokens": 5280,
      "failedTokens": 12,
      "rateLimitAdjustment": 1.0,
      "queueSize": 5280
    }
  }
}
```

### Get Refresh Recommendations

Get recommendations for token refresh intervals based on analysis of the current token set.

```
GET /api/admin/token-refresh/recommendations
```

**Response**

```json
{
  "success": true,
  "data": {
    "apiCallsPerMinute": 45,
    "apiCallsPerSecond": 0.75,
    "totalActiveTokens": 5280,
    "contestTokens": 320,
    "recommendedBatchSize": 50,
    "recommendations": {
      "tier1": {
        "count": 50,
        "recommendedInterval": 15,
        "adjustedInterval": 15
      },
      "tier2": {
        "count": 150,
        "recommendedInterval": 30,
        "adjustedInterval": 30
      },
      "tier3": {
        "count": 300,
        "recommendedInterval": 60,
        "adjustedInterval": 60
      },
      "tier4": {
        "count": 780,
        "recommendedInterval": 180,
        "adjustedInterval": 180
      },
      "tier5": {
        "count": 4000,
        "recommendedInterval": 300,
        "adjustedInterval": 300
      }
    }
  }
}
```

### List Token Refresh Settings

Get a paginated list of tokens with their refresh settings.

```
GET /api/admin/token-refresh/tokens
```

**Query Parameters**

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `limit` | integer | Maximum number of tokens to return | 100 |
| `offset` | integer | Number of tokens to skip | 0 |
| `sort` | string | Sort field: `priority`, `interval`, or `last_refresh` | `priority` |
| `order` | string | Sort order: `asc` or `desc` | `desc` |

**Response**

```json
{
  "success": true,
  "data": {
    "tokens": [
      {
        "id": 1,
        "address": "So11111111111111111111111111111111111111112",
        "symbol": "SOL",
        "name": "Wrapped SOL",
        "refresh_interval_seconds": 15,
        "priority_score": 1000,
        "last_refresh_attempt": "2025-04-10T12:34:56.789Z",
        "last_refresh_success": "2025-04-10T12:34:56.789Z",
        "last_price_change": "2025-04-10T12:30:00.000Z",
        "token_prices": {
          "price": "220.45",
          "updated_at": "2025-04-10T12:34:56.789Z"
        },
        "rank_history": [
          {
            "rank": 1,
            "timestamp": "2025-04-10T12:00:00.000Z"
          }
        ]
      },
      // More tokens...
    ],
    "pagination": {
      "total": 5280,
      "limit": 100,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

### Update Token Refresh Settings

Update refresh settings for a specific token.

```
PUT /api/admin/token-refresh/tokens/:tokenId
```

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tokenId` | integer | Token ID |

**Request Body**

```json
{
  "refresh_interval_seconds": 15,
  "priority_score": 800,
  "metadata": {
    "notes": "Critical token for contests"
  }
}
```

**Response**

```json
{
  "success": true,
  "message": "Updated refresh settings for token ID 1"
}
```

### Manually Refresh a Token

Trigger an immediate refresh of a specific token.

```
POST /api/admin/token-refresh/tokens/:tokenAddress/refresh
```

**URL Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tokenAddress` | string | Token address |

**Response**

```json
{
  "success": true,
  "message": "Refreshed token SOL"
}
```

### Bulk Update Token Settings

Update refresh settings for multiple tokens at once.

```
POST /api/admin/token-refresh/bulk-update
```

**Request Body**

```json
{
  "tokens": [
    {
      "id": 1,
      "refresh_interval_seconds": 15,
      "priority_score": 900
    },
    {
      "id": 2,
      "refresh_interval_seconds": 30,
      "priority_score": 700
    },
    // More tokens...
  ]
}
```

**Response**

```json
{
  "success": true,
  "message": "Updated 3/3 tokens"
}
```

### Apply Tier Settings

Apply recommended tier-based settings to all tokens.

```
POST /api/admin/token-refresh/apply-tier-settings
```

**Response**

```json
{
  "success": true,
  "message": "Applied tier settings to 5280/5280 tokens"
}
```

## Error Responses

All endpoints return appropriate error responses when issues occur:

```json
{
  "success": false,
  "error": "Detailed error message"
}
```

## Frontend Integration

For frontend integration, the following components are recommended:

1. **Scheduler Status Panel**: Dashboard widget showing current metrics and status
2. **Token Settings Table**: Interactive table for viewing and updating token settings 
3. **Bulk Update Form**: Form for applying updates to multiple tokens
4. **Apply Recommendations Button**: One-click application of optimal settings