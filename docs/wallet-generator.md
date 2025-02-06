# Wallet Generator Documentation

## Overview
The Wallet Generator module is a crucial component of the Solana suite that manages the creation, storage, and retrieval of Solana wallets. It provides a secure and efficient way to handle wallet operations with features like encryption, caching, and database persistence.

## Key Features
- **Secure Wallet Generation**: Creates new Solana keypairs with proper encryption
- **Caching System**: Implements LRU (Least Recently Used) caching for improved performance
- **Database Integration**: Persists wallets in a database for long-term storage
- **Encryption**: Uses AES-256-GCM encryption for private key storage
- **Error Handling**: Comprehensive error handling with custom error types
- **Connection Pooling**: Optimized database connections for better performance

## Technical Details

### Configuration
The module requires the following environment variables:
- `DATABASE_URL`: Connection string for the database
- `WALLET_ENCRYPTION_KEY`: 64-character hex string for wallet encryption

### Cache Configuration
```javascript
{
    max: 1000,           // Maximum number of wallets in cache
    ttl: 15 * 60 * 1000  // Time-to-live: 15 minutes
}
```

### Database Schema
```sql
CREATE TABLE seed_wallets (
    identifier TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    private_key TEXT NOT NULL,
    purpose TEXT
);
```

## API Reference

### WalletGenerator.generateWallet(identifier)
Generates or retrieves a wallet for the given identifier.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
```javascript
{
    publicKey: string,    // Solana public key
    secretKey: string,    // Encrypted private key
    timestamp: number     // Creation/update timestamp
}
```

### WalletGenerator.getWallet(identifier)
Retrieves an existing wallet by identifier.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
- Same as generateWallet, or undefined if not found

### WalletGenerator.cleanupCache()
Removes expired entries from the cache (older than 1 hour).

## Error Handling
The module uses the `WalletGeneratorError` class with the following error codes:
- `MISSING_ENCRYPTION_KEY`: Encryption key not configured
- `ENCRYPTION_FAILED`: Failed to encrypt wallet data
- `INIT_FAILED`: Cache initialization failed
- `GENERATION_FAILED`: Wallet generation failed
- `RETRIEVAL_FAILED`: Wallet retrieval failed

## Security Considerations

### Encryption
- Uses AES-256-GCM for private key encryption
- Implements unique IVs for each encryption operation
- Stores encrypted keys in the database

### Best Practices
1. Regular cache cleanup to prevent memory leaks
2. Secure key storage using environment variables
3. Database connection pooling for stability
4. Error handling with detailed logging
5. Type validation for input parameters

## Usage Examples

### Creating a New Wallet
```javascript
try {
    const wallet = await WalletGenerator.generateWallet('user-123');
    console.log('New wallet created:', wallet.publicKey);
} catch (error) {
    console.error('Wallet generation failed:', error.code);
}
```

### Retrieving an Existing Wallet
```javascript
try {
    const wallet = await WalletGenerator.getWallet('user-123');
    if (wallet) {
        console.log('Wallet found:', wallet.publicKey);
    } else {
        console.log('Wallet not found');
    }
} catch (error) {
    console.error('Wallet retrieval failed:', error.code);
}
```

## Performance Optimization
1. **Caching Strategy**
   - LRU cache implementation
   - Automatic cache cleanup
   - Configurable cache size and TTL

2. **Database Optimization**
   - Connection pooling (2-10 connections)
   - Selective field querying
   - Prepared statements

## Integration Guidelines

### Prerequisites
1. Node.js environment
2. PostgreSQL database
3. Proper environment variables setup

### Implementation Steps
1. Configure environment variables
2. Initialize database schema
3. Import and use the WalletGenerator class
4. Implement error handling
5. Monitor cache usage

## Monitoring and Maintenance

### Key Metrics to Monitor
- Cache hit/miss ratio
- Database connection pool usage
- Encryption/decryption performance
- Error rates and types

### Regular Maintenance Tasks
1. Review and rotate encryption keys
2. Monitor database indexes
3. Audit wallet access patterns
4. Review error logs

## Troubleshooting

### Common Issues and Solutions

1. **Encryption Key Issues**
   - Verify WALLET_ENCRYPTION_KEY is set
   - Ensure key is 64 characters hex
   - Check key permissions

2. **Database Connection Issues**
   - Verify DATABASE_URL
   - Check connection pool settings
   - Monitor connection timeouts

3. **Cache Performance Issues**
   - Adjust cache size
   - Review TTL settings
   - Monitor memory usage

## Future Improvements
1. Implement wallet recovery mechanisms
2. Add multi-factor authentication
3. Enhance monitoring capabilities
4. Add wallet activity tracking
5. Implement rate limiting 