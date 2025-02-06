# Faucet Manager Documentation

## Overview
The Faucet Manager is a specialized module in the Solana suite designed to manage test SOL distribution and recovery. It provides a controlled environment for distributing test SOL to users while maintaining proper balance management and transaction logging.

## Key Features
- **Automated SOL Distribution**: Manages test SOL distribution to users
- **Balance Management**: Monitors and maintains faucet wallet balance
- **Transaction Recovery**: Recovers unused SOL from test wallets
- **Transaction Logging**: Comprehensive transaction tracking
- **Configurable Settings**: Adjustable distribution parameters
- **Cache Management**: Efficient caching of wallet information

## Technical Details

### Default Configuration
```javascript
{
    defaultAmount: 0.025,    // Default SOL amount per distribution
    minFaucetBalance: 0.05,  // Minimum balance to maintain
    maxTestUsers: 10         // Maximum concurrent test users
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

## API Reference

### FaucetManager.getFaucetWallet()
Retrieves or creates the faucet wallet.

**Returns:**
```javascript
{
    publicKey: string,    // Faucet wallet public key
    secretKey: string     // Encrypted private key
}
```

### FaucetManager.checkBalance()
Checks the current faucet wallet balance.

**Returns:**
```javascript
{
    balance: number,      // Current balance in SOL
    available: number,    // Available for distribution
    canFundUsers: number  // Number of users that can be funded
}
```

### FaucetManager.sendSOL(toAddress, amount)
Sends SOL to a specified address.

**Parameters:**
- `toAddress` (string): Recipient's Solana address
- `amount` (number): Amount of SOL to send

**Returns:**
- `boolean`: Success status of the transaction

### FaucetManager.recoverFromTestWallets()
Recovers SOL from test wallets created in the last 24 hours.

## Command Line Interface
The module provides a CLI for common operations:
```bash
# Check faucet balance
node faucet-manager.js balance

# Recover SOL from test wallets
node faucet-manager.js recover

# Update faucet configuration
node faucet-manager.js config <amount> <min> <max>
```

## Error Handling
The module uses the `SolanaWalletError` class with detailed error information:
- Error name
- Error code
- Detailed error message
- Additional context (when available)

## Security Considerations

### Transaction Safety
1. **Balance Checks**
   - Minimum balance maintenance
   - Maximum distribution limits
   - Transaction amount validation

2. **Wallet Security**
   - Encrypted private key storage
   - Secure key management
   - Limited access to faucet wallet

### Best Practices
1. Regular balance monitoring
2. Automated recovery of unused funds
3. Transaction logging for audit trails
4. Rate limiting for distributions
5. Error handling with rollbacks

## Usage Examples

### Distributing SOL to Test User
```javascript
try {
    const success = await FaucetManager.sendSOL(
        'userWalletAddress',
        0.025
    );
    if (success) {
        console.log('SOL distributed successfully');
    }
} catch (error) {
    console.error('Distribution failed:', error.code);
}
```

### Checking Faucet Balance
```javascript
try {
    const balance = await FaucetManager.checkBalance();
    console.log('Current balance:', balance, 'SOL');
} catch (error) {
    console.error('Balance check failed:', error.code);
}
```

## Performance Optimization

### Caching Strategy
- LRU cache implementation
- 15-minute TTL for cached data
- Automatic cache cleanup
- Maximum 1000 entries

### Transaction Optimization
- Batch processing for recoveries
- Connection pooling
- Efficient balance checking

## Integration Guidelines

### Prerequisites
1. Solana network access
2. Database setup
3. Environment configuration
4. Sufficient initial SOL balance

### Implementation Steps
1. Configure environment variables
2. Initialize faucet wallet
3. Set up monitoring
4. Implement recovery schedule
5. Configure distribution limits

## Monitoring and Maintenance

### Key Metrics
- Faucet balance
- Distribution frequency
- Recovery success rate
- Error frequency
- Cache performance

### Maintenance Tasks
1. Regular balance checks
2. Periodic fund recovery
3. Transaction log review
4. Configuration updates
5. Performance monitoring

## Troubleshooting

### Common Issues

1. **Insufficient Balance**
   - Check faucet wallet balance
   - Review distribution limits
   - Verify recovery process

2. **Failed Transactions**
   - Check network status
   - Verify recipient address
   - Review transaction logs

3. **Recovery Issues**
   - Check wallet age criteria
   - Verify wallet permissions
   - Review recovery logs

## Business Integration

### Use Cases
1. **Development Testing**
   - Automated test wallet funding
   - Controlled SOL distribution
   - Easy cleanup

2. **Demo Environments**
   - Demonstration wallet setup
   - Controlled fund management
   - Automatic recovery

3. **User Onboarding**
   - Initial wallet funding
   - Controlled distribution
   - Usage monitoring

### Benefits
1. Automated fund management
2. Controlled distribution
3. Fund recovery capability
4. Comprehensive logging
5. Configuration flexibility

## Future Improvements
1. Enhanced recovery strategies
2. Advanced monitoring tools
3. Additional distribution patterns
4. Improved rate limiting
5. Extended CLI capabilities 