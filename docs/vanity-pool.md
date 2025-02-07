# Vanity Pool Documentation

## Overview
The Vanity Pool is a high-performance system for generating Solana wallets with custom address patterns. It utilizes worker threads for parallel processing, making it efficient for generating vanity addresses while maintaining security and reliability.

## Key Features
- **Multi-threaded Generation**: Utilizes available CPU cores for parallel processing
- **Pattern Matching**: Supports start, end, or contains pattern matching
- **Case Sensitivity**: Optional case-sensitive pattern matching
- **Timeout Control**: Configurable timeouts for generation attempts
- **Batch Processing**: Support for multiple vanity wallet requests
- **Complexity Analysis**: Pattern complexity estimation and validation
- **Worker Management**: Efficient worker thread pool management
- **Progress Monitoring**: Real-time generation status tracking
- **Integration with WalletGenerator**: Seamless wallet creation and storage

## Technical Details

### Worker Configuration
```javascript
{
    maxWorkers: cpus().length - 1,  // Uses all cores except one
    attemptsPerSecondPerCore: 50000 // Approximate generation attempts
}
```

### Pattern Constraints
- Valid characters: Base58 character set (1-9, A-H, J-N, P-Z, a-k, m-z)
- Length: 1-20 characters
- Position options: start, end, anywhere
- Case sensitivity: optional

## Core API Reference

### VanityPool.generateVanityWallet(options)
Generates a wallet with a vanity address matching the specified pattern.

**Parameters:**
```javascript
{
    pattern: string,          // The desired address pattern
    identifier: string,       // Unique identifier for the wallet
    isCaseSensitive?: boolean, // Case-sensitive matching (default: false)
    position?: string,        // Pattern position: 'start'|'end'|'anywhere' (default: 'start')
    timeout?: number,         // Generation timeout in ms (default: 300000)
    metadata?: object         // Additional wallet metadata
}
```

**Returns:**
```javascript
{
    publicKey: string,    // The generated vanity address
    secretKey: string,    // Encrypted private key
    timestamp: number,    // Generation timestamp
    metadata: {
        vanity: {
            pattern: string,
            position: string,
            isCaseSensitive: boolean
        },
        ...customMetadata
    }
}
```

### VanityPool.generateBatch(requests)
Processes multiple vanity wallet generation requests.

**Parameters:**
```javascript
requests: [
    {
        pattern: string,
        identifier: string,
        ...options
    }
]
```

**Returns:**
```javascript
{
    successful: [{
        request: object,
        wallet: object
    }],
    failed: [{
        request: object,
        error: {
            code: string,
            message: string,
            details: object
        }
    }],
    timing: {
        start: number,
        end: number,
        duration: number
    }
}
```

### VanityPool.validatePattern(pattern)
Validates a pattern for generation.

**Parameters:**
- `pattern` (string): The pattern to validate

**Throws:**
- `INVALID_PATTERN`: Pattern contains invalid characters
- `INVALID_LENGTH`: Pattern length out of bounds

### VanityPool.validatePatternComplexity(pattern)
Analyzes pattern complexity and feasibility.

**Parameters:**
- `pattern` (string): The pattern to analyze

**Returns:**
```javascript
{
    complexity: number,       // Computational complexity
    isReasonable: boolean,   // Whether generation is feasible
    estimatedTime: {
        estimatedAttempts: number,
        estimatedSeconds: number,
        cores: number
    }
}
```

### VanityPool.getActiveWorkers()
Gets current worker pool status.

**Returns:**
```javascript
{
    total: number,      // Total available workers
    active: number,     // Currently active workers
    available: number,  // Available workers
    queue: number       // Queued tasks
}
```

## Error Handling

### Error Types
The system uses `VanityGeneratorError` with detailed error codes:
- `INVALID_PATTERN`: Pattern contains invalid characters
- `INVALID_LENGTH`: Pattern length out of bounds
- `GENERATION_TIMEOUT`: Generation exceeded timeout
- `WORKER_ERROR`: Worker thread error
- `GENERATION_FAILED`: General generation failure

### Error Response Format
```javascript
{
    name: 'VanityGeneratorError',
    code: string,
    message: string,
    details: {
        pattern?: string,
        identifier?: string,
        originalError?: string
    }
}
```

## Usage Examples

### Generate Simple Vanity Wallet
```javascript
try {
    const wallet = await VanityPool.generateVanityWallet({
        pattern: 'DEGEN',
        identifier: 'contest-wallet',
        position: 'start',
        metadata: {
            purpose: 'contest'
        }
    });
    console.log('Generated address:', wallet.publicKey);
} catch (error) {
    console.error('Generation failed:', error.code, error.details);
}
```

### Batch Generation
```javascript
const results = await VanityPool.generateBatch([
    {
        pattern: 'WIN',
        identifier: 'winner-1',
        position: 'start'
    },
    {
        pattern: 'LUCK',
        identifier: 'winner-2',
        position: 'start'
    }
]);

console.log(`Successfully generated: ${results.successful.length}`);
console.log(`Failed: ${results.failed.length}`);
```

### Pattern Complexity Analysis
```javascript
const analysis = VanityPool.validatePatternComplexity('DEGEN');
if (!analysis.isReasonable) {
    console.log(`Pattern too complex. Estimated time: ${analysis.estimatedTime.estimatedSeconds}s`);
}
```

## Best Practices

### Performance
1. **Pattern Selection**
   - Start with shorter patterns
   - Use less specific patterns
   - Consider case-insensitive matching
   - Validate complexity before generation

2. **Resource Management**
   - Monitor worker pool status
   - Use appropriate timeouts
   - Implement batch processing for multiple requests
   - Consider server load

### Security
1. **Pattern Validation**
   - Validate all input patterns
   - Check pattern complexity
   - Implement rate limiting
   - Monitor generation attempts

2. **Key Management**
   - Secure storage of generated keys
   - Proper encryption of private keys
   - Access control implementation
   - Regular security audits

## Integration Guidelines

### Setup Requirements
1. **System Resources**
   - Multiple CPU cores recommended
   - Sufficient memory for worker threads
   - Stable network connection
   - Proper error handling

2. **Application Integration**
```javascript
import { VanityPool } from './utils/solana-suite/vanity-pool';

// Check system capability
const workers = VanityPool.getActiveWorkers();
console.log(`Available workers: ${workers.available}`);

// Validate pattern before generation
const analysis = VanityPool.validatePatternComplexity(pattern);
if (analysis.isReasonable) {
    // Proceed with generation
}
```

### Error Handling Strategy
```javascript
try {
    const analysis = VanityPool.validatePatternComplexity(pattern);
    if (!analysis.isReasonable) {
        throw new Error('Pattern too complex');
    }
    
    const wallet = await VanityPool.generateVanityWallet({
        pattern,
        timeout: analysis.estimatedTime.estimatedSeconds * 1000 * 2
    });
} catch (error) {
    if (error.code === 'GENERATION_TIMEOUT') {
        // Handle timeout
    } else if (error.code === 'INVALID_PATTERN') {
        // Handle invalid pattern
    }
}
```

## Monitoring and Maintenance

### Key Metrics
1. **Performance Metrics**
   - Generation success rate
   - Average generation time
   - Worker utilization
   - Queue length

2. **Resource Usage**
   - CPU utilization
   - Memory usage
   - Worker thread status
   - Error frequency

### Maintenance Tasks
1. Monitor worker pool health
2. Track generation statistics
3. Analyze error patterns
4. Optimize pattern matching
5. Update complexity thresholds

## Future Improvements
1. GPU acceleration support
2. Advanced pattern matching
3. Progress callbacks
4. Distributed generation
5. Pattern suggestions
6. Performance optimizations
7. Extended timeout strategies
8. Custom character sets 