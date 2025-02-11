# Portfolio Trades API Documentation

## Overview
This API provides endpoints for managing and tracking portfolio trades within DegenDuel contests. It includes functionality for executing trades, retrieving trade history, analyzing portfolio performance, and managing trade-related operations.

## Base URL
```
https://api.degenduel.com/api
```

## Authentication
All endpoints require authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Core Endpoints

### 1. Execute Portfolio Trade
Execute a new trade in a contest portfolio.

**POST** `/contests/{id}/trades`

#### Request Body
```json
{
    "wallet_address": "BPuRhk...",
    "token_id": 1,
    "type": "BUY",
    "new_weight": 50
}
```

#### Response
```json
{
    "id": 1,
    "contest_id": 123,
    "wallet_address": "BPuRhk...",
    "token_id": 1,
    "type": "BUY",
    "old_weight": 0,
    "new_weight": 50,
    "price_at_trade": "52000.00",
    "virtual_amount": "50000",
    "executed_at": "2024-02-07T12:00:00Z"
}
```

### 2. Get Trade History
Retrieve trade history for a participant in a contest.

**GET** `/contests/{id}/trades/{wallet}`

#### Response
```json
[
    {
        "id": 1,
        "type": "BUY",
        "token": {
            "symbol": "BTC",
            "name": "Bitcoin"
        },
        "old_weight": 0,
        "new_weight": 50,
        "price_at_trade": "52000.00",
        "virtual_amount": "50000",
        "executed_at": "2024-02-07T12:00:00Z"
    }
]
```

### 3. Get Portfolio State
Get portfolio state at a specific timestamp.

**GET** `/contests/{id}/portfolio-state/{wallet}`

#### Query Parameters
- `timestamp`: Optional timestamp (ISO 8601 format)

#### Response
```json
[
    {
        "token_id": 1,
        "weight": 50,
        "price": "52000.00",
        "token": {
            "symbol": "BTC",
            "name": "Bitcoin"
        }
    }
]
```

## Additional Endpoints

### 4. Get Portfolio Performance
Get performance metrics for a portfolio.

**GET** `/contests/{id}/portfolio/performance/{wallet}`

#### Response
```json
{
    "total_trades": 10,
    "total_volume": "1000000",
    "profit_loss": "5.23",
    "best_trade": {
        "token_symbol": "BTC",
        "profit_loss": "3.2",
        "executed_at": "2024-02-07T12:00:00Z"
    },
    "worst_trade": {
        "token_symbol": "ETH",
        "profit_loss": "-1.5",
        "executed_at": "2024-02-07T14:00:00Z"
    },
    "token_performance": [
        {
            "symbol": "BTC",
            "profit_loss": "3.2",
            "trades": 5
        }
    ]
}
```

### 5. Get Trade Analytics
Get detailed analytics for portfolio trades.

**GET** `/contests/{id}/trades/analytics/{wallet}`

#### Response
```json
{
    "trade_frequency": {
        "daily": 3.5,
        "weekly": 24.5,
        "monthly": 105
    },
    "average_holding_time": "48h",
    "most_traded_tokens": [
        {
            "symbol": "BTC",
            "trade_count": 15
        }
    ],
    "weight_distribution": {
        "0-25": 20,
        "26-50": 45,
        "51-75": 25,
        "76-100": 10
    }
}
```

### 6. Get Portfolio Rebalance History
Get history of portfolio rebalancing events.

**GET** `/contests/{id}/portfolio/rebalances/{wallet}`

#### Response
```json
[
    {
        "id": 1,
        "timestamp": "2024-02-07T12:00:00Z",
        "changes": [
            {
                "token_symbol": "BTC",
                "old_weight": 50,
                "new_weight": 40,
                "price_at_change": "52000.00"
            },
            {
                "token_symbol": "ETH",
                "old_weight": 50,
                "new_weight": 60,
                "price_at_change": "2600.00"
            }
        ],
        "reason": "REBALANCE"
    }
]
```

### 7. Get Portfolio Snapshots
Get portfolio snapshots at regular intervals.

**GET** `/contests/{id}/portfolio/snapshots/{wallet}`

#### Query Parameters
- `interval`: Snapshot interval (hourly/daily/weekly)
- `start_date`: Start date (ISO 8601)
- `end_date`: End date (ISO 8601)

#### Response
```json
[
    {
        "timestamp": "2024-02-07T12:00:00Z",
        "total_value": "100000",
        "tokens": [
            {
                "symbol": "BTC",
                "weight": 40,
                "value": "40000"
            },
            {
                "symbol": "ETH",
                "weight": 60,
                "value": "60000"
            }
        ]
    }
]
```

### 8. Validate Portfolio Trade
Validate a potential trade before execution.

**POST** `/contests/{id}/trades/validate`

#### Request Body
```json
{
    "wallet_address": "BPuRhk...",
    "token_id": 1,
    "type": "BUY",
    "new_weight": 50
}
```

#### Response
```json
{
    "valid": true,
    "warnings": [],
    "projected_portfolio": {
        "total_weight": 100,
        "tokens": [
            {
                "symbol": "BTC",
                "new_weight": 50,
                "old_weight": 40
            }
        ]
    }
}
```

## Error Responses
All endpoints return error responses in the following format:

```json
{
    "error": "Error message",
    "code": "ERROR_CODE",
    "details": {
        "field": "Additional error details"
    }
}
```

Common HTTP status codes:
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (missing or invalid token)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found (resource not found)
- `409`: Conflict (e.g., trade validation failed)
- `500`: Internal Server Error

## Rate Limiting
- Standard endpoints: 100 requests per minute
- Analytics endpoints: 20 requests per minute
- Trade execution: 10 trades per minute

## Best Practices
1. Always validate trades before execution
2. Use portfolio snapshots for historical analysis
3. Monitor trade analytics for unusual patterns
4. Implement proper error handling for all endpoints
5. Cache analytics results when possible
6. Use appropriate intervals for performance metrics

## Websocket Support
Real-time updates are available for:
- Trade execution status
- Portfolio value changes
- Price updates

Connect to: `wss://api.degenduel.com/ws/portfolio`

## Notes
- All timestamps are in UTC
- Weights are integers between 0 and 100
- Virtual amounts are scaled by 1000 for precision
- Performance metrics are calculated in real-time
- Historical data is retained for 90 days 