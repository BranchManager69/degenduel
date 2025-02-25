# DegenDuel Wallet Management System

## Overview

The DegenDuel Wallet Management System provides comprehensive tools for managing platform wallets, including creation, monitoring, transferring funds, and performing maintenance operations. This system handles liquidity wallets, faucet wallets, and admin wallets with secure encryption and transfer capabilities.

## Architecture

### Core Components

1. **Wallet Generation Service**
   - Handles wallet creation and encryption
   - Manages wallet metadata and state
   - Provides caching for frequently accessed wallets

2. **Admin Wallet Service**
   - Securely transfers SOL between wallets
   - Monitors wallet health and balances
   - Handles wallet reactivation and deactivation

3. **Liquidity Service**
   - Maintains dedicated liquidity wallets 
   - Tracks SOL balances across the platform
   - Ensures high-availability of liquidity

### Database Schema

Wallets are stored in the `seed_wallets` table with the following structure:

| Column        | Type      | Description                                  |
|---------------|-----------|----------------------------------------------|
| wallet_address| text      | Primary key, Solana wallet address           |
| private_key   | text      | Encrypted private key                        |
| purpose       | text      | Wallet purpose (liquidity, faucet, etc.)     |
| is_active     | boolean   | Whether the wallet is active                 |
| metadata      | jsonb     | Additional wallet metadata                   |
| created_at    | timestamp | Creation timestamp                           |
| updated_at    | timestamp | Last update timestamp                        |

## API Endpoints

### Main Wallet Management

#### 1. List All Wallets

```
GET /api/superadmin/wallets
```

**Query Parameters:**
- `type` (string, optional): Filter wallets by type (all, liquidity, faucet, admin)
- `active` (boolean, optional): Filter by active status

**Response Example:**
```json
{
  "wallets": [
    {
      "wallet_address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
      "purpose": "liquidity",
      "is_active": true,
      "balance": 0.5,
      "created_at": "2025-02-25T22:16:25.725Z"
    },
    ...
  ],
  "total": 61,
  "active": 1,
  "service_status": "healthy",
  "last_check": "2025-02-25T22:30:12.345Z"
}
```

#### 2. Generate New Wallets

```
POST /api/superadmin/wallets/generate
```

**Request Body:**
```json
{
  "count": 1,
  "purpose": "admin",
  "prefix": "test_"
}
```

**Parameters:**
- `count` (integer, required): Number of wallets to generate (1-50)
- `purpose` (string, required): Wallet purpose (liquidity, faucet, admin)
- `prefix` (string, optional): Optional prefix for the wallet identifier

**Response Example:**
```json
{
  "message": "Generated 1 wallets successfully",
  "wallets": [
    {
      "public_key": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
      "identifier": "admin_test_1708902345_0"
    }
  ],
  "count": 1
}
```

#### 3. Get Wallet Details

```
GET /api/superadmin/wallets/:address
```

**Path Parameters:**
- `address` (string, required): Wallet address to fetch details for

**Response Example:**
```json
{
  "wallet": {
    "wallet_address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
    "purpose": "liquidity",
    "is_active": true,
    "balance": 0.5,
    "balance_raw": 500000000,
    "created_at": "2025-02-25T22:16:25.725Z"
  },
  "transactions": [
    {
      "id": 123,
      "type": "ADMIN_TRANSFER",
      "amount": 0.1,
      "description": "Test transfer",
      "created_at": "2025-02-25T23:15:36.521Z"
    }
  ],
  "transactions_count": 1
}
```

#### 4. Transfer SOL

```
POST /api/superadmin/wallets/transfer
```

**Request Body:**
```json
{
  "from": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
  "to": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
  "amount": 0.01,
  "description": "Test transfer"
}
```

**Parameters:**
- `from` (string, required): Source wallet address
- `to` (string, required): Destination wallet address
- `amount` (number, required): Amount in SOL to transfer
- `description` (string, optional): Optional transfer description

**Response Example:**
```json
{
  "message": "Transfer successful",
  "signature": "4iBBf8XfJmHHpYzZRdFKraMePTJJ4kTnEZpJgvZnYz7FkrV2GgPJvh5ruLTVfVUKiZPCF7RyN9FnVRtUvnK6S2Ba",
  "from": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
  "to": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
  "amount": 0.01
}
```

#### 5. Activate/Deactivate Wallet

```
POST /api/superadmin/wallets/:address/activate
```

**Path Parameters:**
- `address` (string, required): Wallet address to activate/deactivate

**Request Body:**
```json
{
  "active": true
}
```

**Parameters:**
- `active` (boolean, required): Whether to activate (true) or deactivate (false) the wallet

**Response Example:**
```json
{
  "message": "Wallet activated successfully",
  "wallet": {
    "wallet_address": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
    "purpose": "admin",
    "is_active": true
  }
}
```

### Testing Endpoints

#### 6. Direct Balance Check

```
GET /api/superadmin/wallet-test/direct-balance
```

**Query Parameters:**
- `address` (string, optional): Wallet address to check (defaults to active liquidity wallet)

**Response Example:**
```json
{
  "wallet_address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
  "balance_sol": 0.5,
  "balance_lamports": 500000000,
  "is_in_database": true,
  "wallet_info": {
    "wallet_address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
    "purpose": "liquidity",
    "is_active": true,
    "created_at": "2025-02-25T22:16:25.725Z"
  },
  "checked_at": "2025-02-25T23:20:15.678Z"
}
```

#### 7. Direct Transfer Test

```
POST /api/superadmin/wallet-test/transfer
```

**Request Body:**
```json
{
  "from": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
  "to": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
  "amount": 0.001
}
```

**Parameters:**
- `from` (string, required): Source wallet address
- `to` (string, required): Destination wallet address
- `amount` (number, required): Amount in SOL to transfer (defaults to 0.001 if not specified)

**Response Example:**
```json
{
  "success": true,
  "signature": "4iBBf8XfJmHHpYzZRdFKraMePTJJ4kTnEZpJgvZnYz7FkrV2GgPJvh5ruLTVfVUKiZPCF7RyN9FnVRtUvnK6S2Ba",
  "source": {
    "address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
    "balance": 0.499
  },
  "destination": {
    "address": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
    "balance": 0.011
  },
  "amount": 0.001,
  "timestamp": "2025-02-25T23:22:45.123Z"
}
```

#### 8. Mass Balance Check

```
POST /api/superadmin/wallet-test/mass-check
```

**Query Parameters:**
- `filter` (string, optional): Filter which wallets to check (all, active, liquidity, faucet)

**Response Example:**
```json
{
  "wallets": [
    {
      "wallet_address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
      "purpose": "liquidity",
      "is_active": true,
      "balance_sol": 0.499,
      "balance_lamports": 499000000,
      "check_success": true
    },
    ...
  ],
  "summary": {
    "total_wallets": 61,
    "checked_successfully": 61,
    "failed_checks": 0,
    "total_sol_balance": 1.234,
    "check_time": "2025-02-25T23:25:12.456Z"
  }
}
```

#### 9. Round-Trip Transfer Test

```
POST /api/superadmin/wallet-test/round-trip
```

**Request Body:**
```json
{
  "source": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
  "destination": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
  "amount": 0.001,
  "wait_time": 2000
}
```

**Parameters:**
- `source` (string, optional): Source wallet address (defaults to active liquidity wallet)
- `destination` (string, required): Destination wallet address
- `amount` (number, optional): Amount in SOL to transfer (defaults to 0.001)
- `wait_time` (number, optional): Time to wait between transfers in ms (defaults to 2000)

**Response Example:**
```json
{
  "success": true,
  "source": {
    "address": "DEoSkiU8kmG2crkbyoQgwKVrASLaWhYMPVKa6mnA15xM",
    "initial_balance": 0.499,
    "interim_balance": 0.498,
    "final_balance": 0.4989,
    "net_change": -0.0001
  },
  "destination": {
    "address": "8zNYvPmF32UzWpGobMHeg9Hg6fUzYJf5YQn7jQGmAMrT",
    "initial_balance": 0.011,
    "interim_balance": 0.012,
    "final_balance": 0.0119,
    "net_change": 0.0009
  },
  "transfers": {
    "outbound": {
      "amount": 0.001,
      "signature": "4iBBf8XfJmHHpYzZRdFKraMePTJJ4kTnEZpJgvZnYz7FkrV2GgPJvh5ruLTVfVUKiZPCF7RyN9FnVRtUvnK6S2Ba"
    },
    "inbound": {
      "amount": 0.0009,
      "signature": "5jCCg9YgKmIIpZaZSdGLraNfQTKK5lUnFZqIgvZoZz8GLsW3HhQKqwI6sMLWgWVLjZQDG8Sh9GoWStUvwL7T3DCb"
    }
  },
  "fees": {
    "estimated_total": 0.0002,
    "per_transaction": 0.0001
  },
  "test_completed_at": "2025-02-25T23:28:30.789Z"
}
```

## Security Considerations

### Wallet Encryption

All private keys are securely encrypted using AES-256-GCM encryption before being stored in the database:

```javascript
// From walletGenerationService.js
encryptPrivateKey(privateKey) {
    const iv = crypto.randomBytes(this.config.encryption.ivLength);
    const cipher = crypto.createCipheriv(
        this.config.encryption.algorithm,
        Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(Buffer.from(privateKey)),
        cipher.final()
    ]);

    const tag = cipher.getAuthTag();
    
    return JSON.stringify({
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
    });
}
```

### Authentication and Authorization

All wallet management endpoints require:
1. Valid JWT authentication
2. Superadmin role
3. IP and user agent logging for audit purposes

### Transaction Safety

The transfer endpoints include:
1. Balance validation before transfers
2. Small default amounts for testing (0.001 SOL)
3. Round-trip testing capabilities to preserve funds
4. Fee calculation and reporting
5. Complete transaction logging

## Operational Guidelines

### Recommended Testing Process

1. **Start with direct balance check:**
   ```
   GET /api/superadmin/wallet-test/direct-balance
   ```

2. **Run a mass balance check to monitor all wallets:**
   ```
   POST /api/superadmin/wallet-test/mass-check
   ```

3. **Perform round-trip transfer test with small amounts:**
   ```
   POST /api/superadmin/wallet-test/round-trip
   ```

4. **Generate test wallets if needed:**
   ```
   POST /api/superadmin/wallets/generate
   ```

### Liquidity Wallet Management

The system maintains one active liquidity wallet at all times. When the server starts:

1. It checks if any active liquidity wallet exists
2. If none exists, it reactivates the most recent wallet
3. If no wallet exists at all, it creates a new one

Regular balance checks occur on the liquidity wallet every 60 seconds.

### Best Practices

1. **Use small amounts for testing:** Always use minimum amounts (0.001 SOL) for testing transfers
2. **Prefer round-trip transfers:** Use round-trip testing to preserve funds
3. **Regular monitoring:** Perform regular mass balance checks
4. **Maintain one active wallet per purpose:** Avoid having multiple active wallets for the same purpose
5. **Security:** Never expose private keys or encryption keys

## Troubleshooting

### Common Issues

1. **Transfer failures:**
   - Check wallet balance
   - Ensure wallet is active
   - Verify Solana network status

2. **Activation issues:**
   - Check if wallet exists in database
   - Ensure wallet address is valid
   - Check encryption keys are properly set

3. **Balance sync issues:**
   - Verify RPC endpoint connectivity
   - Check for Solana network congestion
   - Confirm wallet address formatting

### Logs and Monitoring

All wallet operations are logged to:
- Application logs (`api-YYYY-MM-DD.log`)
- Admin activity logs in the `admin_logs` table

## Contact

For issues or support with the wallet management system, contact:
- System administrator: admin@degenduel.me
- Development team: dev@degenduel.me