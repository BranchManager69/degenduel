// tests/test-vanity-service-lifecycle.js

/**
 * Test to verify that vanity wallet service lifecycle methods are working correctly
 * This tests the initialize, start, and stop methods
 */

import vanityWalletService from '../services/vanity-wallet/index.js';
import { logApi } from '../utils/logger-suite/logger.js';

async function runTest() {
  try {
    // Test initialization
    logApi.info('Testing service initialization...');
    const initResult = await vanityWalletService.initialize();
    logApi.info(`Initialization result: ${initResult}`, {
      isInitialized: vanityWalletService.isInitialized,
      isOperational: vanityWalletService.isOperational
    });
    console.log('Service initialized:', vanityWalletService.isInitialized);

    // Test starting the service
    logApi.info('Testing service start...');
    const startResult = await vanityWalletService.start();
    logApi.info(`Start result: ${startResult}`, {
      isStarted: vanityWalletService.isStarted,
      hasInterval: !!vanityWalletService.operationInterval
    });
    console.log('Service started:', vanityWalletService.isStarted);
    
    // Wait a moment to let the service perform at least one operation
    logApi.info('Waiting for 2 seconds to let service perform operations...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test stopping the service
    logApi.info('Testing service stop...');
    const stopResult = await vanityWalletService.stop();
    logApi.info(`Stop result: ${stopResult}`, {
      isStarted: vanityWalletService.isStarted,
      hasInterval: !!vanityWalletService.operationInterval
    });
    console.log('Service stopped (isStarted should be false):', !vanityWalletService.isStarted);
    
    // Verify that all operations were successful
    if (initResult && startResult && stopResult && 
        vanityWalletService.isInitialized && !vanityWalletService.isStarted) {
      logApi.info('All lifecycle tests passed successfully!');
    } else {
      logApi.error('Some lifecycle tests failed');
      process.exit(1);
    }
  } catch (error) {
    logApi.error('Test failed with error:', error);
    console.error(error);
    process.exit(1);
  }
}

// Run the test
runTest();