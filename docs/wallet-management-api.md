# Contest Wallet Management API Documentation

## Overview
This API provides endpoints for managing DegenDuel contest wallets, including balance monitoring, transfers, and transaction management.

## Base URL
```
https://api.degenduel.com/api/admin/wallets
```

## Authentication
All endpoints require admin authentication. Include the JWT token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Get All Contest Wallets
Returns all contest wallets with their current balances and associated contest information.

**GET** `/contest-wallets`

#### Response
```json
{
    "success": true,
    "data": [
        {
            "id": 123,
            "wallet_address": "BPuRhk...",
            "contest_id": 456,
            "contest_code": "DEGEN_001",
            "status": "active",
            "solBalance": 1.5,
            "tokens": [
                {
                    "mint": "token_address",
                    "balance": "1000",
                    "address": "associated_token_address"
                }
            ]
        }
    ]
}
```

### 2. Get Specific Wallet Details
Returns detailed information about a specific wallet.

**GET** `/wallet/:address`

#### Parameters
- `address`: Wallet address (string)
- `token_mints`: Optional array of token mint addresses to check balances for

#### Response
```json
{
    "success": true,
    "address": "BPuRhk...",
    "solBalance": 1.5,
    "tokens": [
        {
            "mint": "token_address",
            "balance": "1000",
            "address": "associated_token_address"
        }
    ]
}
```

### 3. Transfer SOL
Transfer SOL from a contest wallet to another address.

**POST** `/transfer/sol`

#### Request Body
```json
{
    "from_wallet": "source_wallet_address",
    "to_address": "destination_address",
    "amount": 1.5,
    "description": "Optional transfer description"
}
```

#### Response
```json
{
    "success": true,
    "signature": "transaction_signature",
    "message": "Transfer completed successfully"
}
```

### 4. Transfer SPL Token
Transfer SPL tokens from a contest wallet to another address.

**POST** `/transfer/token`

#### Request Body
```json
{
    "from_wallet": "source_wallet_address",
    "to_address": "destination_address",
    "mint": "token_mint_address",
    "amount": "1000",
    "description": "Optional transfer description"
}
```

#### Response
```json
{
    "success": true,
    "signature": "transaction_signature",
    "message": "Token transfer completed successfully"
}
```

### 5. Mass Transfer SOL
Transfer SOL to multiple addresses in one operation.

**POST** `/mass-transfer/sol`

#### Request Body
```json
{
    "from_wallet": "source_wallet_address",
    "transfers": [
        {
            "address": "destination_1",
            "amount": 1.0,
            "description": "Optional description"
        },
        {
            "address": "destination_2",
            "amount": 2.0,
            "description": "Optional description"
        }
    ]
}
```

#### Response
```json
{
    "success": true,
    "results": [
        {
            "address": "destination_1",
            "amount": 1.0,
            "success": true,
            "signature": "transaction_signature"
        },
        {
            "address": "destination_2",
            "amount": 2.0,
            "success": true,
            "signature": "transaction_signature"
        }
    ]
}
```

### 6. Mass Transfer Tokens
Transfer tokens to multiple addresses in one operation.

**POST** `/mass-transfer/token`

#### Request Body
```json
{
    "from_wallet": "source_wallet_address",
    "mint": "token_mint_address",
    "transfers": [
        {
            "address": "destination_1",
            "amount": "1000",
            "description": "Optional description"
        },
        {
            "address": "destination_2",
            "amount": "2000",
            "description": "Optional description"
        }
    ]
}
```

#### Response
```json
{
    "success": true,
    "results": [
        {
            "address": "destination_1",
            "amount": "1000",
            "success": true,
            "signature": "transaction_signature"
        }
    ]
}
```

### 7. Get Transaction History
Get transaction history for a specific wallet.

**GET** `/transactions/:address`

#### Parameters
- `address`: Wallet address (string)
- `start_date`: Optional start date filter (ISO 8601)
- `end_date`: Optional end date filter (ISO 8601)
- `type`: Optional transaction type filter
- `limit`: Optional limit (default: 20, max: 100)
- `offset`: Optional offset for pagination

#### Response
```json
{
    "success": true,
    "data": [
        {
            "id": 789,
            "type": "PRIZE_PAYOUT",
            "amount": "1.5",
            "status": "completed",
            "blockchain_signature": "signature",
            "created_at": "2024-02-10T00:00:00Z",
            "contest": {
                "contest_code": "DEGEN_001",
                "status": "completed"
            }
        }
    ],
    "pagination": {
        "total": 50,
        "limit": 20,
        "offset": 0,
        "hasMore": true
    }
}
```

### 8. Export Wallet (Superadmin Only)
Export wallet private key (restricted to superadmin).

**GET** `/export-wallet/:address`

#### Parameters
- `address`: Wallet address (string)

#### Response
```json
{
    "success": true,
    "address": "wallet_address",
    "privateKey": "encrypted_private_key"
}
```

### 9. Get Total SOL Balance
Returns the total SOL balance across all contest wallets.

**GET** `/total-sol-balance`

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
- `404`: Not Found (wallet not found)
- `500`: Internal Server Error

## Rate Limiting
- 50 requests per minute per IP address
- 500 requests per hour per admin user
- Mass transfer endpoints limited to 20 transfers per request

## Security Notes
1. Private key export is restricted to superadmin users only
2. All transfers require admin authentication and are logged
3. Mass transfers are processed sequentially to ensure accuracy
4. Failed transfers are automatically logged and can be retried

## Best Practices
1. Always verify wallet balances before transfers
2. Use mass transfer endpoints for bulk operations
3. Include descriptive reasons for transfers
4. Monitor transaction history regularly
5. Keep transfer amounts within safe limits
6. Always handle token decimals correctly
7. Verify destination addresses before transfers 