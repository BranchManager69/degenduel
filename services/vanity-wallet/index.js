// services/vanity-wallet/index.js

/**
 * Vanity Wallet Service Entry Point
 */

import VanityWalletService from './vanity-wallet-service.js';
import VanityApiClient from './vanity-api-client.js';

// Create a singleton instance of the service
const vanityWalletService = new VanityWalletService();

export { VanityWalletService, VanityApiClient };
export default vanityWalletService;