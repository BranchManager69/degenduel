// services/vanity-wallet/vanity-wallet-service.js

/**
 * Vanity Wallet Service
 * 
 * This service runs in the background and steadily generates DUEL and DEGEN vanity addresses.
 * It maintains a pool of available addresses for contests to use.
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import config from '../../config/config.js';
import VanityApiClient from './vanity-api-client.js';
import { BaseService } from '../../utils/service-suite/base-service.js';

class VanityWalletService extends BaseService {
  constructor() {
    // Pass proper configuration object to BaseService constructor
    super({
      name: 'vanity_wallet_service',
      description: 'Vanity wallet generation and management'
    });
    
    // Configuration
    this.patterns = ['DUEL', 'DEGEN'];
    this.targetCounts = {
      DUEL: 5,  // Maintain 5 available DUEL addresses
      DEGEN: 3  // Maintain 3 available DEGEN addresses
    };
    this.intervalMs = 1000 * 60 * 5; // Check every 5 minutes
    this.isGenerating = false;
    this.maxConcurrentJobs = 1; // Only generate one at a time to avoid high CPU usage
    
    // When true, only one service instance will be active even in a clustered environment
    this.singletonService = true;
    
    // Service interval for checkAndGenerateAddresses
    this.checkAndGenerateInterval = null;
  }
  
  /**
   * Initialize the service
   */
  async init() {
    try {
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initializing ${fancyColors.RESET} Vanity Wallet Service`);
      
      // Check if WALLET_ENCRYPTION_KEY is set
      if (!process.env.WALLET_ENCRYPTION_KEY) {
        logApi.warn(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Warning ${fancyColors.RESET} WALLET_ENCRYPTION_KEY is not set. Private keys will not be encrypted.`);
      }
      
      // Read configuration
      if (config.vanityWallet?.targetCounts) {
        this.targetCounts = config.vanityWallet.targetCounts;
      }
      
      if (config.vanityWallet?.checkIntervalMinutes) {
        this.intervalMs = 1000 * 60 * config.vanityWallet.checkIntervalMinutes;
        // Also update the base service check interval
        this.config.checkIntervalMs = this.intervalMs;
      }
      
      if (config.vanityWallet?.maxConcurrentJobs) {
        this.maxConcurrentJobs = config.vanityWallet.maxConcurrentJobs;
      }
      
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Configuration: Check interval ${this.intervalMs/1000/60} minutes, Max concurrent jobs: ${this.maxConcurrentJobs}${fancyColors.RESET}`);
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Target counts: DUEL: ${this.targetCounts.DUEL}, DEGEN: ${this.targetCounts.DEGEN}${fancyColors.RESET}`);
      
      // Set as operational
      this.isOperational = true;
      
      // Call BaseService initialize method
      await this.initialize();
      
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Initializing service: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
  
  /**
   * Called when the service starts via the BaseService lifecycle
   * This is called automatically when start() is called on the service
   */
  async onPerformOperation() {
    // This method is called by BaseService.performOperation()
    // It's our main service operation that runs at each interval
    return this.checkAndGenerateAddresses();
  }
  
  /**
   * Called when the service starts
   */
  async onServiceStart() {
    logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Started ${fancyColors.RESET} Vanity Wallet Service`);
    
    // Run an initial check
    await this.checkAndGenerateAddresses();
    
    // BaseService will handle the interval automatically via performOperation
    return true;
  }
  
  /**
   * Called when the service stops
   */
  async onServiceStop() {
    logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Stopping ${fancyColors.RESET} Vanity Wallet Service`);
    
    // Clean up any resources if needed
    // BaseService will handle clearing the interval
    return true;
  }
  
  /**
   * Check the current pool of addresses and generate more if needed
   */
  async checkAndGenerateAddresses() {
    // Skip if we're already generating
    if (this.isGenerating) {
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Already generating addresses, skipping check${fancyColors.RESET}`);
      return;
    }
    
    try {
      this.isGenerating = true;
      
      // Check current count of available addresses for each pattern
      const counts = {};
      
      for (const pattern of this.patterns) {
        // Count available addresses for this pattern
        const count = await prisma.vanity_wallet_pool.count({
          where: {
            pattern,
            status: 'completed',
            is_used: false,
            wallet_address: { not: null },
            private_key: { not: null }
          }
        });
        
        counts[pattern] = count;
        
        // Check if we need to generate more
        const target = this.targetCounts[pattern] || 0;
        const needed = Math.max(0, target - count);
        
        if (needed > 0) {
          logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Generating ${fancyColors.RESET} Need to generate ${needed} ${pattern} addresses (current: ${count}, target: ${target})`);
          
          // Generate addresses one by one (not all at once to avoid CPU spikes)
          const jobsToCreate = Math.min(needed, this.maxConcurrentJobs);
          
          for (let i = 0; i < jobsToCreate; i++) {
            await this.generateVanityAddress(pattern);
          }
        } else {
          logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Have enough ${pattern} addresses (${count} available, target: ${target})${fancyColors.RESET}`);
        }
      }
      
      // Log current status
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Current vanity wallet status: DUEL: ${counts.DUEL || 0}, DEGEN: ${counts.DEGEN || 0}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Checking and generating addresses: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isGenerating = false;
    }
  }
  
  /**
   * Generate a single vanity address
   * 
   * @param {string} pattern - The pattern to generate
   */
  async generateVanityAddress(pattern) {
    try {
      // Start the generation process
      logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Generating ${fancyColors.RESET} Starting generation of ${pattern} address`);
      
      // Create the request
      await VanityApiClient.createVanityAddressRequest({
        pattern,
        isSuffix: false,
        caseSensitive: true,
        requestedBy: 'vanity_wallet_service',
        requestIp: '127.0.0.1'
      });
      
      // The VanityApiClient will handle the rest (generation, encryption, storage)
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Generating ${pattern} address: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
    }
  }
  
  /**
   * Get the current status of the service
   * 
   * @returns {Object} Status information
   */
  async getStatus() {
    try {
      // Count available addresses for each pattern
      const counts = {};
      
      for (const pattern of this.patterns) {
        const count = await prisma.vanity_wallet_pool.count({
          where: {
            pattern,
            status: 'completed',
            is_used: false,
            wallet_address: { not: null },
            private_key: { not: null }
          }
        });
        
        counts[pattern] = count;
      }
      
      // Count pending and processing addresses
      const pendingCount = await prisma.vanity_wallet_pool.count({
        where: {
          status: 'pending'
        }
      });
      
      const processingCount = await prisma.vanity_wallet_pool.count({
        where: {
          status: 'processing'
        }
      });
      
      return {
        status: 'operational',
        isGenerating: this.isGenerating,
        availableAddresses: counts,
        pendingJobs: pendingCount,
        processingJobs: processingCount,
        targetCounts: this.targetCounts,
        checkIntervalMinutes: this.intervalMs / (1000 * 60),
        maxConcurrentJobs: this.maxConcurrentJobs
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting status: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      
      return {
        status: 'error',
        error: error.message
      };
    }
  }
}

export default VanityWalletService;