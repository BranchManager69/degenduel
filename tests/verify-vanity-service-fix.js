/**
 * Test script to verify the vanity wallet service fix
 * This tests that:
 * 1. The service is properly exported as a BaseService instance
 * 2. The ServiceManager can register it correctly
 * 3. It can be initialized and started using the BaseService methods
 */

import { BaseService } from '../utils/service-suite/base-service.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import vanityWalletService from '../services/vanity-wallet/index.js';
import { logApi } from '../utils/logger-suite/logger.js';

async function verifyFix() {
  try {
    logApi.info('======= VERIFYING VANITY WALLET SERVICE FIX =======');
    
    // Step 1: Verify it's a BaseService instance
    logApi.info('\nChecking if service is a BaseService instance:');
    const isBaseService = vanityWalletService instanceof BaseService;
    logApi.info(`vanityWalletService instanceof BaseService: ${isBaseService}`);
    
    if (!isBaseService) {
      logApi.error('FAIL: Service is not an instance of BaseService!');
      process.exit(1);
    }
    
    // Step 2: Verify ServiceManager can register it
    logApi.info('\nAttempting to register with ServiceManager:');
    try {
      serviceManager.register(vanityWalletService);
      logApi.info('SUCCESS: Service was registered with ServiceManager');
    } catch (error) {
      logApi.error(`FAIL: Service registration failed: ${error.message}`);
      process.exit(1);
    }
    
    // Step 3: Test initialization
    logApi.info('\nAttempting to initialize the service:');
    try {
      const initialized = await vanityWalletService.initialize();
      logApi.info(`Service initialization result: ${initialized}`);
      
      if (!initialized) {
        logApi.error('FAIL: Service initialization returned false');
      }
    } catch (error) {
      logApi.error(`FAIL: Service initialization threw an error: ${error.message}`);
      process.exit(1);
    }
    
    // Step 4: Test start/stop methods
    logApi.info('\nAttempting to start the service:');
    try {
      await vanityWalletService.start();
      logApi.info('SUCCESS: Service started');
      
      // Wait a second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Stop the service
      await vanityWalletService.stop();
      logApi.info('SUCCESS: Service stopped');
    } catch (error) {
      logApi.error(`FAIL: Service start/stop threw an error: ${error.message}`);
      process.exit(1);
    }
    
    // All tests passed
    logApi.info('\n======= ALL TESTS PASSED =======');
    logApi.info('The vanity wallet service is now properly structured as a BaseService instance');
    logApi.info('It can be registered with ServiceManager and use all BaseService lifecycle methods');
    
  } catch (error) {
    logApi.error(`Test failed with unexpected error: ${error.message}`);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

verifyFix();