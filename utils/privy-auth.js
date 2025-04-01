// Import Privy SDK
import { PrivyClient } from '@privy-io/server-auth';
import { logApi } from './logger-suite/logger.js';

// Create a logger specifically for Privy auth
const privyLogger = logApi.forService('PRIVY_AUTH');

// Check for required environment variables
if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
  privyLogger.error(`Missing required Privy environment variables \n\t`, {
    hasAppId: !!process.env.PRIVY_APP_ID,
    hasAppSecret: !!process.env.PRIVY_APP_SECRET
  });
}

// Get shortened versions of credentials for logging (first 6 chars only)
const truncatedAppId = process.env.PRIVY_APP_ID 
  ? `${process.env.PRIVY_APP_ID.substring(0, 6)}...` 
  : 'missing';
const truncatedAppSecret = process.env.PRIVY_APP_SECRET 
  ? `${process.env.PRIVY_APP_SECRET.substring(0, 6)}...` 
  : 'missing';

// Log Privy client initialization
privyLogger.info(`Initializing Privy client \n\t`, {
  appId: truncatedAppId,
  appIdLength: process.env.PRIVY_APP_ID?.length,
  appSecretProvided: !!process.env.PRIVY_APP_SECRET
});

// Create a Privy client with your project details
let privyClient;
try {
  privyClient = new PrivyClient(
    process.env.PRIVY_APP_ID,
    process.env.PRIVY_APP_SECRET
  );
  
  privyLogger.info(`Privy client initialized successfully \n\t`);
} catch (error) {
  privyLogger.error(`Failed to initialize Privy client \n\t`, {
    error: error.message,
    stack: error.stack
  });
  
  // Create a dummy client that logs errors when methods are called
  privyClient = {
    verifyAuthToken: async () => {
      privyLogger.error(`Attempted to verify auth token with unconfigured Privy client \n\t`);
      throw new Error('Privy client not properly initialized');
    },
    getUser: async () => {
      privyLogger.error(`Attempted to get user with unconfigured Privy client \n\t`);
      throw new Error('Privy client not properly initialized');
    }
  };
}

export default privyClient;