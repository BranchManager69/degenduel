# Vanity Wallet Pool Management

## Overview
The vanity wallet pool system allows DegenDuel to use pre-generated vanity Solana addresses for contest wallets. These addresses contain specific patterns (e.g., "DEGEN", "DUEL") that enhance brand recognition and professionalism.

## Base URL
```
https://api.degenduel.com/api/admin/vanity-wallets
```

## Authentication
All endpoints require admin authentication. Certain endpoints require superadmin privileges.
```
Authorization: Bearer <your_jwt_token>
```

## Endpoints

### 1. Add Vanity Wallets to Pool
Add pre-ground vanity wallets to the available pool.

**POST** `/pool/add`
- Requires superadmin privileges
- Rate limit: 30 requests per minute

#### Request Body
```json
{
    "wallets": [
        {
            "address": "DEGENxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "privateKey": "encrypted_private_key",
            "pattern": "DEGEN"
        }
    ]
}
```

#### Validation Rules
- `address`: Must be a valid Solana address (32-44 characters, base58)
- `privateKey`: Encrypted private key string
- `pattern`: Alphanumeric, 1-10 characters
- Maximum 100 wallets per request

#### Response
```json
{
    "success": true,
    "message": "Added 1 vanity wallets to pool",
    "wallets": [
        {
            "id": 1,
            "address": "DEGENxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            "pattern": "DEGEN"
        }
    ]
}
```

### 2. Get Pool Statistics
Get current statistics about the vanity wallet pool.

**GET** `/pool/stats`
- Requires admin privileges
- Rate limit: 30 requests per minute

#### Response
```json
{
    "success": true,
    "stats": {
        "total_wallets": 100,
        "available_wallets": 75,
        "available_by_pattern": {
            "DEGEN": 30,
            "DUEL": 25,
            "D3G3N": 20
        }
    }
}
```

### 3. Get Available Patterns
List all patterns currently available in the pool.

**GET** `/pool/patterns`
- Requires admin privileges
- Rate limit: 30 requests per minute

#### Response
```json
{
    "success": true,
    "patterns": [
        {
            "pattern": "DEGEN",
            "available": 30
        },
        {
            "pattern": "DUEL",
            "available": 25
        }
    ]
}
```

### 4. Get Pool Alerts
Get alerts for patterns running low on available wallets.

**GET** `/pool/alerts`
- Requires admin privileges
- Rate limit: 30 requests per minute

#### Response
```json
{
    "success": true,
    "has_alerts": true,
    "alerts": [
        {
            "pattern": "DEGEN",
            "remaining": 2,
            "status": "low"
        },
        {
            "pattern": "DUEL",
            "remaining": 0,
            "status": "depleted"
        }
    ]
}
```

## Integration with Contest Creation

The vanity wallet pool integrates automatically with contest creation. When a new contest is created:

1. The system checks for available vanity wallets
2. If a preferred pattern is specified, it looks for that pattern first
3. If no preferred pattern is available, it tries any available vanity wallet
4. If no vanity wallets are available, it falls back to generating a regular wallet

### Example Contest Creation with Preferred Pattern
```javascript
const wallet = await ContestWalletService.createContestWallet(
    contestId,
    "DEGEN" // preferred pattern
);
```

## Best Practices

1. **Wallet Generation**
   - Generate vanity wallets offline using specialized tools
   - Pre-generate wallets well before they're needed
   - Keep a healthy buffer of available wallets

2. **Pattern Management**
   - Use consistent patterns for brand recognition
   - Keep patterns short to reduce generation time
   - Document which patterns are in use

3. **Pool Monitoring**
   - Monitor pool alerts regularly
   - Maintain at least 5 wallets per pattern
   - Generate new wallets when pool runs low

4. **Security**
   - Only superadmins can add new wallets
   - Private keys must be encrypted before submission
   - Regular audits of wallet usage

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
- `429`: Too Many Requests (rate limit exceeded)
- `500`: Internal Server Error

## Rate Limiting
- All endpoints: 30 requests per minute per IP
- Pool addition endpoint: Additional superadmin-specific limits

## Database Schema

The vanity wallet pool is stored in the `vanity_wallet_pool` table:
```sql
model vanity_wallet_pool {
  id              Int       @id @default(autoincrement())
  wallet_address  String    @unique
  private_key     String
  pattern         String    
  is_used         Boolean   @default(false)
  used_at         DateTime?
  used_by_contest Int?      @unique
  created_at      DateTime  @default(now())
  updated_at      DateTime  @updatedAt

  contest         contests? @relation(fields: [used_by_contest], references: [id])

  @@index([is_used])
  @@index([pattern])
}
```

## Monitoring Recommendations

1. Set up alerts for:
   - Pool depletion (< 5 wallets per pattern)
   - Failed wallet assignments
   - Unusual usage patterns

2. Regular monitoring of:
   - Pool statistics
   - Pattern distribution
   - Usage rates

3. Audit trails:
   - Track wallet assignments
   - Monitor pattern popularity
   - Review usage patterns 