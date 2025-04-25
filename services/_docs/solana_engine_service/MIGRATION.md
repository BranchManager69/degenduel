# Migration from solanaService to SolanaEngine

## Overview

SolanaEngine is a new, comprehensive service that leverages premium APIs from Helius and Jupiter to provide enhanced Solana blockchain functionality. It is designed to eventually replace the existing solanaService and related services like tokenSyncService and marketDataService.

## Why Migrate?

### Limitations of Current Architecture

The current architecture has several limitations:

1. **Basic RPC Limitations**: solanaService relies on standard RPC endpoints which have rate limits and reliability issues
2. **Limited Token Data**: tokenSyncService must make multiple RPC calls to assemble complete token metadata
3. **Market Data Gaps**: marketDataService has to combine data from multiple sources with varying reliability
4. **Performance Issues**: The current approach requires many sequential RPC calls, leading to performance bottlenecks

### Benefits of SolanaEngine

1. **Premium API Access**: Direct access to Helius and Jupiter APIs for enhanced functionality
2. **Comprehensive Token Data**: Complete token metadata in a single request
3. **Real-time Market Data**: WebSocket-based price updates
4. **Enhanced Reliability**: Redundant data sources and improved caching
5. **Advanced Features**: Webhook support, enhanced transaction monitoring, and more

## Migration Strategy

The migration to SolanaEngine should be gradual to minimize disruption:

### Phase 1: Side-by-Side Operation (Current)

- SolanaEngine runs alongside existing services
- New code paths should use SolanaEngine
- Existing code continues to use solanaService

### Phase 2: Feature Parity Verification

- Confirm that SolanaEngine provides all functionality needed by dependent services
- Create adapter functions if necessary for backward compatibility
- Add deprecation notices to solanaService methods

### Phase 3: Gradual Migration

- Update services one by one to use SolanaEngine instead of solanaService
- Give priority to services with high RPC usage
- Monitor performance and reliability improvements

### Phase 4: Complete Transition

- Remove direct dependencies on solanaService
- Consider options for removing solanaService entirely or keeping it as a fallback
- Update documentation and training materials

## Code Changes Required

When migrating a service from solanaService to SolanaEngine, you'll need to:

### Import Updates

```javascript
// DEPRECATED - using old solanaService
import solanaService from '../../services/solanaService.js';

// RECOMMENDED - using new SolanaEngine
import { solanaEngine } from '../../services/solana-engine/index.js';
```

### Method Replacements

| Old Method (solanaService) | New Method (solanaEngine) |
|---------------------------|--------------------------|
| `solanaService.getTokenMetadata(mintAddress)` | `solanaEngine.getTokenData([mintAddress])` |
| `solanaService.getTokenPrice(mintAddress)` | `solanaEngine.getTokenPrice(mintAddress)` |
| `solanaService.sendTransaction(...)` | `solanaEngine.sendTransaction(...)` |

### Event Handling Updates

```javascript
// DEPRECATED - old event subscription
solanaService.on('tokenUpdate', handleTokenUpdate);

// RECOMMENDED - new event subscription
const unsubscribe = solanaEngine.onTokenUpdate(handleTokenUpdate);
```

## Feature Comparison

| Feature | solanaService | SolanaEngine |
|---------|---------------|--------------|
| Basic RPC Connection | ✅ | ✅ (via Helius) |
| Token Metadata | ⚠️ (limited) | ✅ (comprehensive) |
| Market Prices | ❌ | ✅ (real-time) |
| Websocket Support | ⚠️ (basic) | ✅ (advanced) |
| Transaction Building | ✅ | ✅ (enhanced) |
| Webhook Support | ❌ | ✅ |
| Redis Caching | ⚠️ (limited) | ✅ (comprehensive) |
| Rate Limit Handling | ⚠️ (basic) | ✅ (advanced) |
| Memory Efficiency | ⚠️ (moderate) | ✅ (optimized) |

## Current Status and Timeline

- **Current Status**: SolanaEngine has been implemented with full Helius and Jupiter integration
- **Next Step**: Verify functionality and begin updating dependent services
- **Target Completion**: [TBD]

## Questions and Support

For questions about the migration process or SolanaEngine functionality, contact the DegenDuel Core Team.