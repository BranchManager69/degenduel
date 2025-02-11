# Monitoring & Metrics API Documentation

## Overview
This API provides endpoints for monitoring DegenDuel contests, wallets, and system metrics. It includes real-time monitoring data, performance metrics, and financial statistics.

## Base URL
```
https://api.degenduel.com/api/admin
```

## Authentication
All endpoints require admin authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Contest Monitoring Endpoints

### 1. Get Contest Monitoring Data
Returns real-time monitoring data for active contests.

**GET** `/contests/monitoring`

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

**GET** `/contests/metrics`

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

## Wallet Monitoring Endpoints

### 1. Get Total SOL Balance
Returns the total SOL balance across all contest wallets.

**GET** `/wallets/total-sol-balance`

#### Response
```json
{
    "success": true,
    "data": {
        "totalSOL": 1500.5,
        "totalLamports": 1500500000000,
        "walletCount": 25
    }
}
```

### 2. Get Failed Transactions
Returns all failed transactions for a specific contest.

**GET** `/contests/transactions/failed/:contestId`

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

## System Monitoring

### 1. Get Contest State History
Returns the state change history for a specific contest.

**GET** `/contests/history/:contestId`

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

## Error Responses
All endpoints return error responses in the following format:

```json
{
    "success": false,
    "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource not found)
- `500`: Internal Server Error

## Rate Limiting
- 100 requests per minute per IP address
- 1000 requests per hour per admin user

## Monitoring Best Practices
1. Poll monitoring endpoints at appropriate intervals:
   - Contest monitoring: Every minute
   - Performance metrics: Every 5 minutes
   - Total SOL balance: Every minute during active contests
   - Failed transactions: Every 5 minutes

2. Set up alerts for:
   - Contests requiring state changes
   - Failed transactions
   - Low wallet balances
   - Unusual transaction patterns

3. Dashboard Recommendations:
   - Display real-time contest status overview
   - Show total SOL under management
   - Track failed transaction rate
   - Monitor contest performance metrics

4. Performance Considerations:
   - Cache responses when appropriate
   - Use websockets for real-time updates (when available)
   - Implement exponential backoff for retries
   - Monitor rate limit usage 