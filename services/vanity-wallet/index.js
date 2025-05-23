// services/vanity-wallet/index.js

/**
 * Vanity Wallet Service Entry Point
 */

import vanityWalletService, { getDashboardData } from './vanity-wallet-service.js';
import VanityApiClient from './vanity-api-client.js';

// Export components
export { VanityApiClient, getDashboardData };
export default vanityWalletService;