# Contest Management API Documentation

## Overview
This API provides endpoints for managing DegenDuel contests, including monitoring, metrics, state management, and transaction handling.

## Base URL
```
https://api.degenduel.com/api/admin/contests
```

## Authentication
All endpoints require admin authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Get Contest Monitoring
Returns real-time monitoring data for active contests.

**GET** `/monitoring`

#### Response
```json
{
    "success": true,
    "data": [
        {
            "id": 123,
            "contest_code": "DEGEN_001",
            "status": "pending",
            "start_time": "2024-02-10T00:00:00Z",
            "end_time": "2024-02-11T00:00:00Z",
            "prize_pool": "1000.00",
            "participant_count": 5,
            "min_entry": "10.00",
            "max_entry": "100.00",
            "total_entries": "250.00",
            "contest_wallet": "wallet_address",
            "wallet_balance": "1200.00",
            "state_check": "SHOULD_START"
        }
    ]
}
```

#### State Check Values
- `SHOULD_START`: Contest should be started (start time reached)
- `SHOULD_END`: Contest should be ended (end time reached)
- `SHOULD_AUTO_CANCEL`: Contest should be auto-cancelled (3 days passed, insufficient participants)
- `OK`: No action needed

### 2. Get Contest Performance Metrics
Returns performance metrics for all non-draft contests.

**GET** `/metrics`

#### Response
```json
{
    "success": true,
    "data": [
        {
            "contest_id": 123,
            "contest_code": "DEGEN_001",
            "status": "completed",
            "total_participants": 10,
            "refunded_count": 0,
            "winners_paid_count": 3,
            "total_entry_amount": "500.00",
            "total_prize_amount": "450.00",
            "total_refund_amount": "0.00",
            "total_transactions": 13,
            "failed_transactions": 0
        }
    ]
}
```

### 3. Get Contest State History
Returns the state change history for a specific contest.

**GET** `/history/:contestId`

#### Parameters
- `contestId`: Contest ID (integer)

#### Response
```json
{
    "success": true,
    "data": [
        {
            "id": 1,
            "contest_id": 123,
            "previous_status": "pending",
            "new_status": "active",
            "changed_at": "2024-02-10T00:00:00Z",
            "changed_by": "admin_user",
            "change_reason": "Started manually by admin: Minimum participants reached"
        }
    ]
}
```

### 4. Update Contest State
Manually update the state of a contest.

**POST** `/state/:contestId`

#### Parameters
- `contestId`: Contest ID (integer)

#### Request Body
```json
{
    "action": "START|END|CANCEL",
    "reason": "Optional reason for the state change"
}
```

#### Response
```json
{
    "success": true,
    "data": {
        "id": 123,
        "status": "active",
        "started_at": "2024-02-10T00:00:00Z",
        // ... other contest data
    },
    "message": "Contest started successfully"
}
```

#### Notes
- When cancelling a contest, refunds are processed automatically
- State transitions must follow the correct order: pending → active → completed/cancelled

### 5. Get Failed Transactions
Returns all failed transactions for a specific contest.

**GET** `/transactions/failed/:contestId`

#### Parameters
- `contestId`: Contest ID (integer)

#### Response
```json
{
    "success": true,
    "data": [
        {
            "id": 456,
            "wallet_address": "recipient_address",
            "amount": "100.00",
            "type": "PRIZE_PAYOUT",
            "status": "FAILED",
            "error_details": "Insufficient balance",
            "created_at": "2024-02-10T00:00:00Z"
        }
    ]
}
```

### 6. Retry Failed Transaction
Retry a failed transaction.

**POST** `/transactions/retry/:transactionId`

#### Parameters
- `transactionId`: Transaction ID (integer)

#### Response
```json
{
    "success": true,
    "message": "Transaction queued for retry"
}
```

## Error Responses
All endpoints return error responses in the following format:

```json
{
    "success": false,
    "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400`: Bad Request (invalid parameters or state transition)
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (contest or transaction not found)
- `500`: Internal Server Error

## Rate Limiting
- 100 requests per minute per IP address
- 1000 requests per hour per admin user

## Monitoring Recommendations
1. Poll `/monitoring` endpoint every minute to check for contests requiring attention
2. Monitor failed transactions and retry them within 24 hours
3. Check metrics endpoint daily for contest performance analysis

## Best Practices
1. Always provide a reason when manually changing contest states
2. Process refunds as soon as possible after cancellation
3. Monitor wallet balances before contest start
4. Keep retry attempts for failed transactions under 3
5. Use appropriate timeouts for long-running operations 