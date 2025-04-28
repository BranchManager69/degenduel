# Token Events Guide

This guide explains how services can listen to and respond to token-related events in the DegenDuel system.

## Available Token Events

The token detection system emits the following events:

| Event | Description | Payload |
|-------|-------------|---------|
| `token:new` | Emitted when a new token is discovered | `{ address: string, discoveredAt: string }` |
| `tokens:significant_change` | Emitted when there's a large change in the token list | `{ added: number, removed: number, timestamp: string }` |

## How to Listen for Token Events

Any service can listen for these events by using the shared `serviceEvents` module.

### Basic Example

```javascript
// Import the service events module
import serviceEvents from '../../utils/service-suite/service-events.js';

// Listen for new token events
serviceEvents.on('token:new', async (tokenInfo) => {
  console.log(`New token detected: ${tokenInfo.address}`);
  
  // Do something with the token
  await processNewToken(tokenInfo);
});

// Listen for significant changes
serviceEvents.on('tokens:significant_change', (changeInfo) => {
  console.log(`Significant token list change: +${changeInfo.added}, -${changeInfo.removed}`);
  
  // Maybe update caches, alert monitoring, etc.
});
```

## Implementing a Token Processor Service

Here's a complete example of a service that processes new tokens:

```javascript
// services/token-processor/token-processor-service.js

import { BaseService } from '../../utils/service-suite/base-service.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';

class TokenProcessorService extends BaseService {
  constructor() {
    super({
      name: 'token_processor_service',
      description: 'Processes new tokens',
      layer: 'PROCESSING',
      criticalLevel: 'low'
    });
    
    // Service state
    this.processed = 0;
  }
  
  async initialize() {
    try {
      logApi.info(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} Initializing token processor service...`);
      
      // Register event listeners
      serviceEvents.on('token:new', this.handleNewToken.bind(this));
      
      this.isInitialized = true;
      logApi.info(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token processor service ready`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization failed:${fancyColors.RESET}`, error);
      return false;
    }
  }
  
  async handleNewToken(tokenInfo) {
    try {
      logApi.debug(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} Processing new token: ${tokenInfo.address}`);
      
      // Your token processing logic here - examples:
      // 1. Fetch additional token metadata
      // 2. Check if the token meets certain criteria
      // 3. Store token in database
      // 4. Update other services
      
      // Example implementation:
      await this.fetchTokenMetadata(tokenInfo.address);
      
      this.processed++;
      logApi.debug(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} Processed token: ${tokenInfo.address}`);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing token:${fancyColors.RESET}`, error);
    }
  }
  
  async fetchTokenMetadata(address) {
    // Example implementation - replace with your logic
    return { address, name: 'Unknown', symbol: 'UNKNOWN' };
  }
  
  async performOperation() {
    // Nothing to do here - this service is event-driven
    return { success: true, processed: this.processed };
  }
  
  async stop() {
    try {
      // Remove event listeners
      serviceEvents.removeListener('token:new', this.handleNewToken);
      
      await super.stop();
      logApi.info(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STOPPED ${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.GOLD}[TokenProcessorSvc]${fancyColors.RESET} ${fancyColors.RED}Error stopping service:${fancyColors.RESET}`, error);
    }
  }
}

// Create and export singleton instance
const tokenProcessorService = new TokenProcessorService();
export default tokenProcessorService;
```

## Best Practices

1. **Decouple Processing**: Keep token detection separate from token processing
2. **Use Event Handlers**: Don't directly call functions from token detection
3. **Error Handling**: Always include error handling in event listeners
4. **Batch Processing**: If appropriate, consider batching token processing
5. **Graceful Shutdown**: Remove event listeners when stopping your service

## Debugging

To debug token events, you can temporarily add a global listener in your service:

```javascript
if (process.env.NODE_ENV === 'development') {
  serviceEvents.on('token:new', (tokenInfo) => {
    logApi.debug(`[DEBUG] 'token:new' event received: ${JSON.stringify(tokenInfo)}`);
  });
}
```

## Advanced: Creating Your Own Token Events

You can create and emit your own token-related events:

```javascript
// After processing a token, emit a custom event
serviceEvents.emit('token:processed', {
  address: tokenAddress,
  processingResult: result,
  timestamp: new Date().toISOString()
});
```

Other services can then listen for your custom event.

## Related Services

- `tokenDetectionService.js` - Detects new tokens and emits events
- `tokenListDeltaTracker.js` - Tracks token list changes using Redis
- `jupiterClient.js` - Provides access to Jupiter token list API