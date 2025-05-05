// tests/test-vanity-service-registration.js

/**
 * Test to verify that vanity wallet service can be registered with ServiceManager
 */

import serviceManager from '../utils/service-suite/service-manager.js';
import vanityWalletService from '../services/vanity-wallet/index.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Check if vanityWalletService is properly instantiated
logApi.info('Checking if vanityWalletService is an instance of BaseService');
console.log('vanityWalletService instanceof BaseService:', vanityWalletService instanceof BaseService);

// Check if it can be registered with ServiceManager
try {
  logApi.info('Attempting to register the service with ServiceManager');
  serviceManager.register(vanityWalletService);
  logApi.info('Registration successful');
  
  // Verify that the service was actually registered
  const registeredServices = Array.from(serviceManager.services.keys());
  console.log('Registered services:', registeredServices);
  console.log('vanity_wallet_service is registered:', registeredServices.includes('vanity_wallet_service'));
  
  logApi.info('Test passed successfully');
} catch (error) {
  logApi.error('Registration failed:', error);
  console.error(error);
  process.exit(1);
}