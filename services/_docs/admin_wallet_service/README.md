# Admin Wallet Service

## Overview

The Admin Wallet Service manages the DegenDuel treasury and administrative wallet operations. It's responsible for handling critical on-chain transaction operations that maintain the financial infrastructure of the platform.

## Key Responsibilities

### Treasury Management
- Maintains and monitors the DegenDuel treasury wallet
- Tracks balances and transaction history
- Manages fund allocation between different platform functions

### Transaction Operations
- **Emergency Fund Recovery**: Administrative recovery of lost or stuck funds
- **System Withdrawals**: Manages withdrawals to/from the treasury
- **Fee Collection**: Collects platform fees from various sources
- **Operational Transactions**: Executes maintenance transactions
- **Contest Seeding**: Provides initial funds for new contests
- **Manual Fund Transfers**: Supports administrative fund movements

### Monitoring Operations
- **Balance Monitoring**: Tracks treasury wallet health and balance
- **Transaction Monitoring**: Records and verifies all treasury transactions
- **Audit Trail**: Maintains comprehensive logs of all administrative actions

## Migration to SolanaEngine

### Current Status
The Admin Wallet Service currently uses SolanaServiceManager for blockchain interactions. As part of our infrastructure upgrade, it needs to be migrated to use the SolanaEngine directly.

### Migration Plan

1. **Infrastructure Changes**
   - Create admin-wallet subfolder structure
   - Move adminWalletService.js to the new folder structure
   - Create index.js for proper exports

2. **SolanaEngine Integration**
   - Replace SolanaServiceManager imports with solanaEngine
   - Update all blockchain interaction methods to use SolanaEngine
   - Add explicit endpoint selection for critical transactions
   - Implement proper error handling and retry logic
   - Add initialization checks for SolanaEngine availability

3. **Enhanced Transaction Reliability**
   - Utilize endpoint rotation for basic operations
   - Use low-latency endpoint selection for time-sensitive transactions
   - Implement health-aware endpoint selection for critical operations
   - Add transaction status reporting with endpoint information

4. **Testing Strategy**
   - Test balance checking with multiple endpoints
   - Verify transaction creation and signing
   - Test transaction submission with explicit endpoint selection
   - Validate recovery procedures with the new implementation

## Implementation Details

### Code Structure
The new structure will follow the established pattern:
```
/services/admin-wallet/
  ├── adminWalletService.js   # Main service implementation
  └── index.js                # Service exports
```

### SolanaEngine Integration
Replace current transaction methods:

```javascript
// BEFORE: Using SolanaServiceManager
const connection = SolanaServiceManager.getConnection();
const balance = await connection.getBalance(publicKey);
const signature = await connection.sendTransaction(transaction);

// AFTER: Using SolanaEngine
// For balance checking 
const balance = await solanaEngine.executeConnectionMethod('getBalance', publicKey);

// For transactions
const signature = await solanaEngine.sendTransaction(transaction, signers, {
  // Optionally select specific endpoint for critical transactions
  endpointId: 'endpoint-2', // Use the low-latency endpoint
  fallbackToRotation: true  // Fall back to other endpoints if needed
});
```

### Performance Considerations
- Treasury operations typically involve smaller transaction volumes but higher value
- Choose endpoints based on operation criticality:
  - Regular balance checks: Use standard endpoint rotation
  - Critical transfers: Use lowest-latency endpoint
  - Large transactions: Use most reliable endpoint

## Configuration

Additional environment variables for SolanaEngine configuration:
```
# Treasury operations RPC settings
TREASURY_OPERATIONS_PREFERRED_ENDPOINT=endpoint-2
TREASURY_OPERATIONS_FALLBACK_ENABLED=true
```

## Logging

Enhanced logging will include:
- Endpoint selection information
- Transaction performance metrics
- Retry/fallback events
- Endpoint health status during critical operations

## Security Considerations

- All transaction approvals must still go through proper authentication
- No change to existing security protocols for transaction authorization
- Enhanced visibility into transaction processing with SolanaEngine

## Future Enhancements

- Implement smart endpoint selection based on transaction type
- Add transaction simulation before sending to prevent errors
- Implement transaction batching for improved efficiency
- Develop comprehensive treasury analytics dashboard

## References

- [SolanaEngine Documentation](/services/_docs/solana_engine_service/README.md)
- [Migration Guide](/services/_docs/solana_engine_service/MIGRATION.md)