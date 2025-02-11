# Faucet Manager Documentation

## Overview
The Faucet Manager is a comprehensive Solana wallet management system designed for test SOL distribution, wallet-to-wallet transfers, and system monitoring. It provides a robust environment for managing SOL transactions with features like automatic fee calculation, transaction confirmation handling, and detailed logging.

## Key Features
- **Smart SOL Distribution**: Handles test SOL distribution with automatic fee calculation
- **Wallet-to-Wallet Transfers**: Flexible transfer system between any managed wallets
- **Advanced Fee Handling**: Automatically calculates and includes rent exemption for new accounts
- **Transaction Monitoring**: Comprehensive transaction tracking and statistics
- **System Health Monitoring**: Real-time system status and health checks
- **Batch Operations**: Support for multiple transfers in a single operation
- **Detailed Analytics**: Transaction statistics and performance metrics
- **Warning System**: Proactive alerts for system issues

## Technical Details

### Default Configuration
```javascript
{
    defaultAmount: 0.025,    // Default SOL amount per distribution
    minFaucetBalance: 0.05,  // Minimum balance to maintain
    maxTestUsers: 10,        // Maximum concurrent test users
    maxRetries: 3,          // Maximum transaction retry attempts
    minConfirmations: 2     // Minimum confirmations required
}
```

### Fee Constants
```javascript
{
    BASE_FEE: 0.000005,     // Base transaction fee
    RENT_EXEMPTION: 0.00089088  // Minimum balance for rent exemption
}
```

### Connection Configuration
```javascript
{
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 120000, // 2 minutes
    wsEndpoint: process.env.QUICKNODE_MAINNET_WSS
}
```

### Database Integration
Requires tables:
```sql
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    type TEXT NOT NULL,
    amount DECIMAL NOT NULL,
    balance_before DECIMAL NOT NULL,
    balance_after DECIMAL NOT NULL,
    status TEXT NOT NULL,
    metadata JSONB,
    description TEXT,
    processed_at TIMESTAMP
);

CREATE TABLE seed_wallets (
    identifier TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    private_key TEXT NOT NULL,
    purpose TEXT
);
```

## Core API Reference

### FaucetManager.sendSOL(toAddress, amount)
Sends SOL to a specified address with automatic fee handling.

**Parameters:**
- `toAddress` (string): Recipient's Solana address
- `amount` (number): Amount of SOL to send

**Returns:**
```javascript
{
    success: true,
    transaction: {
        // Transaction details
        wallet_address: string,
        type: string,
        amount: number,
        status: string,
        metadata: {
            blockchain_signature: string,
            confirmation: {
                confirmed: boolean,
                signature: string,
                slot: number,
                confirmations: number,
                fee: number,
                timestamp: number
            },
            fees: {
                baseFee: number,
                rentExemption: number,
                isNewAccount: boolean
            }
        }
    },
    confirmation: {
        // Confirmation details
    }
}
```

### FaucetManager.transferSOL(fromWalletId, toAddress, amount, options)
Flexible wallet-to-wallet transfer with enhanced options.

**Parameters:**
- `fromWalletId` (string): Source wallet identifier
- `toAddress` (string): Destination address
- `amount` (number): Amount to transfer
- `options` (object): Additional options
  - `description` (string): Transaction description
  - `metadata` (object): Custom metadata

**Returns:**
```javascript
{
    success: true,
    transaction: {
        // Transaction details
    },
    confirmation: {
        // Confirmation details
    },
    balances: {
        source: {
            before: number,
            after: number
        },
        target: {
            before: number,
            after: number
        }
    },
    fees: {
        base: number,
        rent: number,
        total: number
    }
}
```

### FaucetManager.batchTransfer(transfers)
Execute multiple transfers in a single operation.

**Parameters:**
```javascript
transfers: [
    {
        from: string,    // Source wallet ID
        to: string,      // Destination address
        amount: number,  // Amount to transfer
        options: {       // Optional parameters
            description: string,
            metadata: object
        }
    }
]
```

**Returns:**
```javascript
{
    successful: [],      // Successful transfers
    failed: [],         // Failed transfers
    totalProcessed: number,
    totalAmount: number,
    startTime: Date,
    endTime: Date,
    duration: number
}
```

## Monitoring and Analytics

### FaucetManager.systemCheck()
Comprehensive system health check.

**Returns:**
```javascript
{
    status: 'healthy' | 'error',
    timestamp: Date,
    faucet: {
        balance: number,
        canFundUsers: number,
        address: string
    },
    network: {
        version: string,
        endpoint: string,
        commitment: string
    },
    database: string,
    walletGeneration: string,
    encryption: string
}
```

### FaucetManager.getTransactionStats(timeframe)
Get detailed transaction statistics.

**Parameters:**
- `timeframe` (string): '1h' | '24h' | '7d' | '30d'

**Returns:**
```javascript
{
    total: number,
    successful: number,
    failed: number,
    totalAmount: number,
    byType: {
        [type: string]: {
            count: number,
            amount: number,
            successful: number,
            failed: number
        }
    },
    timeframe: string
}
```

### FaucetManager.getAdminDashboardData()
Get comprehensive dashboard data.

**Returns:**
```javascript
{
    timestamp: Date,
    faucet: {
        // Faucet status
    },
    system: {
        // System health
    },
    transactions: {
        recent: [],
        stats: {
            '24h': {},
            '7d': {}
        }
    },
    warnings: [
        {
            level: 'critical' | 'warning',
            message: string,
            details: string
        }
    ],
    fees: {
        // Fee constants
    }
}
```

## Error Handling

### Error Types
The system uses `SolanaWalletError` with detailed error codes:
- `WALLET_NOT_FOUND`: Wallet doesn't exist
- `INSUFFICIENT_BALANCE`: Not enough SOL for transfer
- `CONFIRMATION_FAILED`: Transaction confirmation failed
- `TRANSFER_FAILED`: General transfer failure
- `FEE_CALCULATION_FAILED`: Error calculating fees
- `KEY_MISMATCH`: Public key verification failed

### Error Response Format
```javascript
{
    name: 'SolanaWalletError',
    code: string,
    message: string,
    details: {
        // Context-specific error details
    }
}
```

## Usage Examples

### Basic SOL Transfer
```javascript
try {
    const result = await FaucetManager.sendSOL(
        'recipientAddress',
        0.1
    );
    console.log('Transfer successful:', result.transaction);
} catch (error) {
    console.error('Transfer failed:', error.code, error.details);
}
```

### Wallet-to-Wallet Transfer
```javascript
const result = await FaucetManager.transferSOL(
    'source-wallet-id',
    'destination-address',
    0.5,
    {
        description: 'Prize payout',
        metadata: { contestId: '123' }
    }
);
```

### Batch Transfer
```javascript
const batchResult = await FaucetManager.batchTransfer([
    {
        from: 'wallet1',
        to: 'address1',
        amount: 0.1
    },
    {
        from: 'wallet2',
        to: 'address2',
        amount: 0.2,
        options: {
            description: 'Batch payment'
        }
    }
]);
```

### System Monitoring
```javascript
// Get system health
const health = await FaucetManager.systemCheck();

// Get transaction statistics
const stats = await FaucetManager.getTransactionStats('24h');

// Get dashboard data
const dashboard = await FaucetManager.getAdminDashboardData();
```

## CLI Interface
```bash
# Check faucet balance
node faucet-manager.js balance

# Recover SOL from test wallets
node faucet-manager.js recover

# Update configuration
node faucet-manager.js config <amount> <min> <max>
```

## Best Practices

### Transaction Safety
1. **Pre-transfer Checks**
   - Balance verification
   - Fee calculation
   - Account existence check
   - Public key verification

2. **Transaction Handling**
   - Multiple confirmation attempts
   - Detailed transaction logging
   - Error tracking
   - Balance updates verification

### Monitoring
1. **System Health**
   - Regular health checks
   - Balance monitoring
   - Error rate tracking
   - Transaction success rate

2. **Performance Metrics**
   - Transaction latency
   - Confirmation times
   - Error patterns
   - Usage statistics

## Future Improvements
1. Real-time transaction monitoring
2. Advanced analytics dashboard
3. Automated recovery scheduling
4. Custom fee strategies
5. Enhanced batch processing
6. Transaction simulation 