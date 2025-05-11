// tests/token-price-ws-test.js
// Test WebSocket-based token price monitoring

import solanaEngine from '../services/solana-engine/index.js';
import tokenPriceWs from '../services/market-data/token-price-ws.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Force console.log to display correctly
const originalLog = console.log;
console.log = (...args) => {
    process.stdout.write(args.join(' ') + '\n');
};

// Run time in seconds
const RUN_TIME = 120; // 2 minutes

async function testTokenPriceWebSocket() {
    console.log('Initializing SolanaEngine...');
    await solanaEngine.initialize();
    
    console.log('Initializing token price WebSocket monitoring...');
    tokenPriceWs.onPriceUpdate((priceUpdate) => {
        console.log(`[PRICE UPDATE] ${priceUpdate.symbol}: $${priceUpdate.price} (${priceUpdate.source})`);
    });
    
    // Configure WebSocket
    const wsConfig = {
        maxTokensToMonitor: 10, // Lower to just monitor a few tokens for testing
        minimumPriorityScore: 0, // Set to 0 since tokens don't have priority scores yet
        storePriceHistory: false,
        subscriptionBatchSize: 5
    };
    
    try {
        // Initialize WebSocket monitoring
        const initialized = await tokenPriceWs.initialize(solanaEngine, wsConfig);

        // Display the actual result we get
        console.log('Initialize result:', initialized);

        if (!initialized) {
            console.log('Failed to initialize token price WebSocket monitoring');
            process.exit(1);
        } else {
            console.log('Token price WebSocket monitoring initialized successfully');
        }
    } catch (error) {
        console.error('Error initializing token price WebSocket:', error);
        process.exit(1);
    }
    
    // Log initial stats
    console.log('Initial stats:', tokenPriceWs.getStats());
    
    // Run for specified time
    console.log(`Test will run for ${RUN_TIME} seconds...`);
    
    // Log stats every 10 seconds
    const statsInterval = setInterval(() => {
        const stats = tokenPriceWs.getStats();
        console.log(`\nCurrent stats (${new Date().toISOString()}):`);
        console.log(`- Connected: ${stats.connected}`);
        console.log(`- Tokens monitored: ${stats.tokenCount}`);
        console.log(`- Pools monitored: ${stats.poolCount}`);
        console.log(`- Price updates received: ${stats.priceUpdates}`);
        console.log(`- Reconnections: ${stats.reconnections}`);
        console.log(`- Errors: ${stats.errors}`);
    }, 10000);
    
    // Set timeout to end test
    setTimeout(async () => {
        clearInterval(statsInterval);
        
        console.log('\nTest complete, cleaning up...');
        await tokenPriceWs.cleanup();
        
        console.log('Cleanup complete, exiting.');
        process.exit(0);
    }, RUN_TIME * 1000);
}

// Run the test
testTokenPriceWebSocket().catch(error => {
    console.error('Error in test:', error);
    process.exit(1);
});