# Wallet Generator Documentation

## Overview
The Wallet Generator is a secure and efficient system for managing Solana wallets throughout the application. It provides robust functionality for generating, encrypting, storing, and retrieving wallets with features like automatic encryption, caching, and database persistence.

## Key Features
- **Secure Wallet Generation**: Creates Solana keypairs with automatic encryption
- **Encryption System**: AES-256-GCM encryption for private keys
- **Efficient Caching**: LRU cache implementation with TTL
- **Database Integration**: Persistent storage of encrypted wallet data
- **Error Handling**: Comprehensive error system with detailed codes
- **Cache Management**: Automatic cleanup and maintenance
- **Initialization System**: Automatic loading of existing wallets
- **Wallet Lifecycle**: Complete wallet lifecycle management (create, import, deactivate)
- **Metadata Support**: Custom metadata for wallets
- **Verification System**: Wallet integrity verification
- **Import/Export**: Support for importing existing wallets
- **Batch Operations**: List and filter multiple wallets
- **Statistics**: Cache and performance monitoring

## Technical Details

### Cache Configuration
```javascript
{
    max: 1000,           // Maximum number of cached wallets
    ttl: 15 * 60 * 1000  // 15-minute Time-To-Live
}
```

### Encryption Details
- Algorithm: AES-256-GCM
- Key Source: Environment variable (WALLET_ENCRYPTION_KEY)
- Format: Hex-encoded encryption with IV and auth tag
- Additional Security: Unique IV per encryption, auth tag verification

### Database Integration
Requires table:
```sql
CREATE TABLE seed_wallets (
    identifier TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    private_key TEXT NOT NULL,
    purpose TEXT,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB
);
```

## Core API Reference

### WalletGenerator.generateWallet(identifier, options)
Generates or retrieves a wallet for the given identifier.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet
- `options` (object):
  - `forceNew` (boolean): Force creation of new wallet even if exists
  - `metadata` (object): Custom metadata for the wallet
  - `fromPrivateKey` (string): Import existing private key

**Returns:**
```javascript
{
    publicKey: string,    // Base58 encoded public key
    secretKey: string,    // Encrypted private key
    timestamp: number,    // Generation timestamp
    metadata: object     // Custom metadata
}
```

### WalletGenerator.getWallet(identifier)
Retrieves an existing wallet by its identifier.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
```javascript
{
    publicKey: string,    // Base58 encoded public key
    secretKey: string,    // Encrypted private key
    timestamp: number,    // Last access timestamp
    metadata: object     // Custom metadata
}
```

### WalletGenerator.getKeypair(identifier)
Gets a Solana Keypair instance for the wallet.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
- `Keypair`: Solana Keypair instance

### WalletGenerator.importWallet(identifier, privateKey, options)
Imports an existing wallet.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet
- `privateKey` (string): Base64 encoded private key
- `options` (object): Additional options (same as generateWallet)

**Returns:**
- Same as generateWallet

### WalletGenerator.deactivateWallet(identifier)
Deactivates a wallet.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
- `boolean`: Success status

### WalletGenerator.updateWalletMetadata(identifier, metadata)
Updates wallet metadata.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet
- `metadata` (object): New metadata

**Returns:**
- `boolean`: Success status

### WalletGenerator.listWallets(filter)
Lists all active wallets.

**Parameters:**
- `filter` (object): Optional filter criteria

**Returns:**
```javascript
[{
    identifier: string,
    publicKey: string,
    metadata: object
}]
```

### WalletGenerator.verifyWallet(identifier)
Verifies wallet integrity.

**Parameters:**
- `identifier` (string): Unique identifier for the wallet

**Returns:**
```javascript
{
    exists: boolean,
    valid: boolean,
    error: string | null
}
```

### WalletGenerator.getCacheStats()
Get cache statistics.

**Returns:**
```javascript
{
    size: number,
    maxSize: number,
    ttl: number,
    keys: string[]
}
```

## Error Handling

### Error Types
The system uses `WalletGeneratorError` with detailed error codes:
- `MISSING_ENCRYPTION_KEY`: Encryption key not found in environment
- `ENCRYPTION_FAILED`: Private key encryption failed
- `DECRYPTION_FAILED`: Private key decryption failed
- `INIT_FAILED`: Cache initialization failed
- `GENERATION_FAILED`: Wallet generation failed
- `RETRIEVAL_FAILED`: Wallet retrieval failed
- `WALLET_NOT_FOUND`: Wallet doesn't exist
- `KEYPAIR_CREATION_FAILED`: Failed to create Solana keypair
- `DEACTIVATION_FAILED`: Failed to deactivate wallet
- `METADATA_UPDATE_FAILED`: Failed to update metadata
- `LIST_FAILED`: Failed to list wallets

## Usage Examples

### Generate New Wallet with Metadata
```javascript
try {
    const wallet = await WalletGenerator.generateWallet('user-123', {
        metadata: {
            type: 'user',
            createdAt: new Date(),
            purpose: 'contest-participation'
        }
    });
    console.log('New wallet generated:', wallet.publicKey);
} catch (error) {
    console.error('Wallet generation failed:', error.code, error.details);
}
```

### Import Existing Wallet
```javascript
try {
    const wallet = await WalletGenerator.importWallet(
        'imported-wallet-1',
        existingPrivateKey,
        { metadata: { source: 'import' } }
    );
    console.log('Wallet imported:', wallet.publicKey);
} catch (error) {
    console.error('Import failed:', error.code, error.details);
}
```

### Wallet Lifecycle Management
```javascript
// Create wallet
const wallet = await WalletGenerator.generateWallet('contest-123');

// Update metadata
await WalletGenerator.updateWalletMetadata('contest-123', {
    status: 'active',
    lastUsed: new Date()
});

// Verify integrity
const verification = await WalletGenerator.verifyWallet('contest-123');
if (!verification.valid) {
    console.error('Wallet verification failed:', verification.error);
}

// Deactivate when done
await WalletGenerator.deactivateWallet('contest-123');
```

### Batch Operations
```javascript
// List all contest wallets
const contestWallets = await WalletGenerator.listWallets({
    metadata: {
        type: 'contest'
    }
});

// Process multiple wallets
for (const wallet of contestWallets) {
    const keypair = await WalletGenerator.getKeypair(wallet.identifier);
    // Use keypair for operations
}
```

## Best Practices

### Security
1. **Environment Configuration**
   - Secure storage of encryption key
   - Regular key rotation
   - Proper environment isolation
   - Monitoring of key usage

2. **Key Management**
   - Private key encryption at rest
   - Secure key transmission
   - Access control implementation
   - Regular key verification

3. **Wallet Lifecycle**
   - Proper deactivation of unused wallets
   - Regular integrity verification
   - Metadata maintenance
   - Access logging

### Performance
1. **Cache Optimization**
   - Regular cache cleanup
   - Appropriate TTL settings
   - Cache size monitoring
   - Hit rate optimization

2. **Database Interaction**
   - Connection pooling
   - Query optimization
   - Error handling
   - Index maintenance

3. **Batch Operations**
   - Use listWallets for bulk operations
   - Implement rate limiting
   - Monitor performance metrics
   - Optimize large operations

## Integration Guidelines

### Setup Requirements
1. **Environment Variables**
   ```bash
   WALLET_ENCRYPTION_KEY=<32-byte-hex-key>
   DATABASE_URL_PROD=<database-connection-string>
   ```

2. **Database Setup**
   - Create required tables
   - Set up proper indexes
   - Configure access permissions
   - Set up monitoring

3. **Application Integration**
   ```javascript
   import { WalletGenerator } from './utils/solana-suite/wallet-generator';
   
   // The module self-initializes on import
   // But you can manually reinitialize if needed:
   await WalletGenerator.initialize();
   ```

### Error Handling Strategy
1. **Implement try-catch blocks**
   ```javascript
   try {
       const wallet = await WalletGenerator.generateWallet(userId);
   } catch (error) {
       if (error.code === 'ENCRYPTION_FAILED') {
           // Handle encryption errors
       } else if (error.code === 'GENERATION_FAILED') {
           // Handle generation errors
       }
   }
   ```

2. **Monitor error patterns**
   - Track error frequencies
   - Set up alerts for critical errors
   - Implement automatic recovery
   - Log detailed error context

## Monitoring and Maintenance

### Key Metrics
1. **Cache Performance**
   - Hit/miss ratio
   - Cache size
   - Cleanup frequency
   - Memory usage

2. **Wallet Operations**
   - Generation success rate
   - Retrieval latency
   - Error frequency
   - Verification success rate

3. **Security Metrics**
   - Failed decryption attempts
   - Invalid key attempts
   - Unauthorized access attempts
   - Key rotation status

### Maintenance Tasks
1. Regular cache cleanup
2. Database index optimization
3. Encryption key rotation
4. Performance monitoring
5. Error log analysis
6. Integrity verification
7. Metadata cleanup
8. Access pattern analysis

## Future Improvements
1. Multi-encryption key support
2. Advanced caching strategies
3. Batch wallet operations
4. Real-time monitoring dashboard
5. Automated key rotation
6. Enhanced security features
7. Performance optimizations
8. Extended error handling
9. Wallet recovery system
10. Transaction signing integration 