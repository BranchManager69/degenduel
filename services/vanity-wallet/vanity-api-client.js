// services/vanity-wallet/vanity-api-client.js

/**
 * Vanity API Client
 * 
 * This module provides a client for generating vanity Solana addresses.
 * It handles creating vanity address requests, processing jobs, and managing the results.
 * 
 * Updated to use local generation instead of the GPU server.
 * 
 * @module VanityApiClient
 */

import { v4 as uuidv4 } from 'uuid';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { fancyColors } from '../../utils/colors.js';
import VanityWalletGeneratorManager from './generators/index.js';
import crypto from 'crypto';

// Config
import config from '../../config/config.js';

// Initialize the generator manager
const generatorManager = VanityWalletGeneratorManager.getInstance({
  numWorkers: config.vanityWallet?.numWorkers || undefined,
  batchSize: config.vanityWallet?.batchSize || undefined,
  maxAttempts: config.vanityWallet?.maxAttempts || undefined
});

/**
 * Client for generating and managing vanity Solana addresses
 */
class VanityApiClient {
  /**
   * Creates a new vanity address generation request
   * 
   * @param {Object} options - Request options
   * @param {string} options.pattern - The pattern to search for (e.g., "DUEL")
   * @param {boolean} options.isSuffix - Whether the pattern should be at the end of the address
   * @param {boolean} options.caseSensitive - Whether the pattern matching is case sensitive
   * @param {number} options.numThreads - Number of threads to use for generation (defaults to generator config)
   * @param {number} options.cpuLimit - CPU usage limit as percentage (defaults to generator config)
   * @param {string} options.requestedBy - The admin who requested this wallet
   * @param {string} options.requestIp - The IP address that requested this wallet
   * @returns {Promise<Object>} - The created database record
   */
  static async createVanityAddressRequest(options) {
    const {
      pattern,
      isSuffix = false,
      caseSensitive = true,
      numThreads = config.vanityWallet?.numWorkers,
      cpuLimit = config.vanityWallet?.cpuLimit,
      requestedBy,
      requestIp
    } = options;

    try {
      // Log request
      logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Creating ${fancyColors.RESET} vanity address request for pattern: ${pattern}`);

      // Create a record in our database
      const dbRecord = await prisma.vanity_wallet_pool.create({
        data: {
          pattern,
          is_suffix: isSuffix,
          case_sensitive: caseSensitive,
          status: 'pending', // 'pending' means waiting to be picked up for processing
          requested_by: requestedBy,
          request_ip: requestIp,
          created_at: new Date(),
          updated_at: new Date()
        }
      });

      logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.GREEN}Created database record #${dbRecord.id}${fancyColors.RESET}`);
      
      // Instead of waiting for GPU server to poll, start processing immediately
      try {
        // Mark as processing
        await prisma.vanity_wallet_pool.update({
          where: { id: dbRecord.id },
          data: {
            status: 'processing',
            updated_at: new Date()
          }
        });
        
        // Start the job with the local generator
        await generatorManager.addJob(
          {
            id: dbRecord.id.toString(),
            pattern,
            isSuffix,
            caseSensitive,
            numThreads,
            cpuLimit
          },
          // Completion callback
          async (result) => {
            await VanityApiClient.processLocalResult(dbRecord.id, result);
          },
          // Progress callback
          async (progress) => {
            // Only log progress occasionally to avoid flooding logs
            if (progress.attempts % 1000000 === 0) {
              logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BLUE}Job #${dbRecord.id} progress: ${progress.attempts} attempts, ${Math.round(progress.duration_ms / 1000)}s elapsed${fancyColors.RESET}`);
            }
          }
        );
        
        logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BLUE}Job #${dbRecord.id} submitted to local generator${fancyColors.RESET}`);
      } catch (generatorError) {
        logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Generator Error ${fancyColors.RESET} Failed to submit job to generator: ${generatorError.message}`, {
          error: generatorError.message,
          stack: generatorError.stack,
          jobId: dbRecord.id
        });
        
        // Update record to failed status
        await prisma.vanity_wallet_pool.update({
          where: { id: dbRecord.id },
          data: {
            status: 'failed',
            updated_at: new Date(),
            completed_at: new Date()
          }
        });
      }

      return dbRecord;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Creating vanity wallet request: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        options
      });

      throw error;
    }
  }

  /**
   * Process the result from the local generator
   * 
   * @param {number} requestId - The ID of the vanity wallet request in our database
   * @param {Object} result - The result from the local generator
   * @returns {Promise<Object>} - The updated database record
   */
  static async processLocalResult(requestId, result) {
    try {
      logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Processing ${fancyColors.RESET} local result for request #${requestId}`, {
        jobStatus: result.status
      });

      // Get the vanity wallet request
      const request = await prisma.vanity_wallet_pool.findUnique({
        where: { id: parseInt(requestId) }
      });

      if (!request) {
        throw new Error(`Vanity wallet request #${requestId} not found`);
      }

      // If the job was completed successfully
      if (result.status === 'Completed' && result.result) {
        const { address, keypair_bytes } = result.result;

        logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Success ${fancyColors.RESET} Vanity wallet generated: ${address}`, {
          address,
          pattern: request.pattern
        });

        // Convert keypair_bytes to a string for storage
        const privateKeyJson = JSON.stringify(keypair_bytes);
        
        // Encrypt the private key before storing it
        const encryptedPrivateKey = await this.encryptPrivateKey(privateKeyJson);

        // Update the database record
        const updatedRecord = await prisma.vanity_wallet_pool.update({
          where: { id: parseInt(requestId) },
          data: {
            wallet_address: address,
            private_key: encryptedPrivateKey,
            status: 'completed',
            attempts: result.attempts || 0,
            duration_ms: result.duration_ms || 0,
            completed_at: new Date(),
            updated_at: new Date()
          }
        });

        return updatedRecord;
      } 
      // If the job failed or was cancelled
      else if (result.status === 'Failed' || result.status === 'Cancelled') {
        logApi.warn(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Job ${result.status} ${fancyColors.RESET} Vanity wallet generation ${result.status.toLowerCase()}`, {
          jobId: result.id,
          error: result.error
        });

        // Update the database record
        const updatedRecord = await prisma.vanity_wallet_pool.update({
          where: { id: parseInt(requestId) },
          data: {
            status: result.status === 'Failed' ? 'failed' : 'cancelled',
            attempts: result.attempts || 0,
            duration_ms: result.duration_ms || 0,
            completed_at: new Date(),
            updated_at: new Date()
          }
        });

        return updatedRecord;
      }
      // Unknown status
      else {
        logApi.warn(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Unknown ${fancyColors.RESET} Unknown job status: ${result.status}`, {
          jobId: result.id,
          status: result.status
        });

        return request;
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Processing result: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        requestId,
        result
      });

      throw error;
    }
  }

  /**
   * Checks if there are any available vanity wallets with a given pattern
   * 
   * @param {string} pattern - The pattern to check for (optional)
   * @returns {Promise<Object|null>} - The vanity wallet if found, null otherwise
   */
  static async getAvailableVanityWallet(pattern = null) {
    try {
      // Build where clause
      const where = {
        status: 'completed',
        is_used: false,
        wallet_address: { not: null },
        private_key: { not: null }
      };

      // Add pattern filter if provided
      if (pattern) {
        where.pattern = pattern;
      }

      // Find the first available vanity wallet
      const vanityWallet = await prisma.vanity_wallet_pool.findFirst({
        where,
        orderBy: { completed_at: 'asc' } // Use oldest first (FIFO)
      });
      
      // If a wallet was found, decrypt its private key
      if (vanityWallet && vanityWallet.private_key) {
        try {
          // Decrypt the private key
          const decryptedPrivateKey = await this.decryptPrivateKey(vanityWallet.private_key);
          
          // Replace the encrypted key with the decrypted one
          vanityWallet.private_key = decryptedPrivateKey;
          
          logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.GREEN}Successfully decrypted private key for wallet #${vanityWallet.id}${fancyColors.RESET}`);
        } catch (decryptError) {
          logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Decrypting private key for wallet #${vanityWallet.id}: ${decryptError.message}`, {
            error: decryptError.message,
            stack: decryptError.stack,
            walletId: vanityWallet.id
          });
          
          // Continue with the encrypted private key
          logApi.warn(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.YELLOW}Continuing with encrypted private key${fancyColors.RESET}`);
        }
      }

      return vanityWallet;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting available vanity wallet: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        pattern
      });

      throw error;
    }
  }

  /**
   * Marks a vanity wallet as used by a contest
   * 
   * @param {number} walletId - The ID of the vanity wallet
   * @param {number} contestId - The ID of the contest
   * @returns {Promise<Object>} - The updated database record
   */
  static async assignVanityWalletToContest(walletId, contestId) {
    try {
      const updatedWallet = await prisma.vanity_wallet_pool.update({
        where: { id: walletId },
        data: {
          is_used: true,
          used_at: new Date(),
          used_by_contest: contestId,
          updated_at: new Date()
        }
      });

      logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Assigned ${fancyColors.RESET} Vanity wallet #${walletId} to contest #${contestId}`, {
        walletId,
        contestId,
        address: updatedWallet.wallet_address
      });

      return updatedWallet;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Assigning vanity wallet: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        walletId,
        contestId
      });

      throw error;
    }
  }

  /**
   * Gets all vanity wallets with optional filtering
   * 
   * @param {Object} options - Filter options
   * @param {string} options.status - Filter by status
   * @param {boolean} options.isUsed - Filter by usage status
   * @param {string} options.pattern - Filter by pattern
   * @param {number} options.limit - Maximum number of records to return
   * @param {number} options.offset - Number of records to skip
   * @returns {Promise<Array>} - The list of vanity wallets
   */
  static async getVanityWallets(options = {}) {
    try {
      const {
        status,
        isUsed,
        pattern,
        limit = 100,
        offset = 0
      } = options;

      // Build where clause
      const where = {};

      if (status) where.status = status;
      if (isUsed !== undefined) where.is_used = isUsed;
      if (pattern) where.pattern = pattern;

      // Get wallets with pagination
      const wallets = await prisma.vanity_wallet_pool.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset
      });

      // Get total count for pagination
      const total = await prisma.vanity_wallet_pool.count({ where });

      return {
        wallets,
        pagination: {
          total,
          limit,
          offset
        }
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting vanity wallets: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        options
      });

      throw error;
    }
  }

  /**
   * Gets the status of the local generator
   * 
   * @returns {Promise<Object>} The status information
   */
  static async getGeneratorStatus() {
    try {
      const status = generatorManager.getStatus();
      return {
        status: 'ok',
        generatorStatus: status
      };
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting generator status: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Cancels a vanity wallet generation job
   * 
   * @param {number} requestId - The ID of the request to cancel
   * @returns {Promise<Object>} The updated record
   */
  static async cancelVanityAddressRequest(requestId) {
    try {
      // Get the request
      const request = await prisma.vanity_wallet_pool.findUnique({
        where: { id: parseInt(requestId) }
      });
      
      if (!request) {
        throw new Error(`Vanity wallet request #${requestId} not found`);
      }
      
      // Only pending or processing jobs can be cancelled
      if (request.status !== 'pending' && request.status !== 'processing') {
        throw new Error(`Cannot cancel request with status '${request.status}'`);
      }
      
      // If it's processing, cancel it in the generator
      if (request.status === 'processing') {
        try {
          const cancelled = generatorManager.cancelJob(requestId.toString());
          logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.YELLOW}Cancelled job in generator: ${cancelled}${fancyColors.RESET}`);
        } catch (cancelError) {
          logApi.warn(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to cancel job in generator: ${cancelError.message}${fancyColors.RESET}`);
          // Continue even if generator cancel fails
        }
      }
      
      // Update the database record
      const updatedRecord = await prisma.vanity_wallet_pool.update({
        where: { id: parseInt(requestId) },
        data: {
          status: 'cancelled',
          completed_at: new Date(),
          updated_at: new Date()
        }
      });
      
      logApi.info(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Cancelled ${fancyColors.RESET} Vanity wallet request #${requestId}`);
      
      return updatedRecord;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Cancelling vanity wallet request: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        requestId
      });
      
      throw error;
    }
  }

  /**
   * Checks the health of the local generator
   * 
   * @returns {Promise<boolean>} - Always returns true for local generator
   */
  static async checkHealth() {
    try {
      // Local generator is always available
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Checking health: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Encrypts a private key before storing it in the database
   * 
   * @param {string} privateKeyJson - The private key as a JSON string
   * @returns {Promise<string>} - The encrypted private key
   */
  static async encryptPrivateKey(privateKeyJson) {
    try {
      if (!process.env.WALLET_ENCRYPTION_KEY) {
        logApi.warn(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Warning ${fancyColors.RESET} No encryption key found, storing without encryption`);
        return privateKeyJson;
      }
      
      // Get the encryption key (should be a 32-byte/64-character hex string)
      const encryptionKey = Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex');
      
      // Create a random initialization vector
      const iv = crypto.randomBytes(16);
      
      // Create cipher
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      
      // Encrypt the data
      let encrypted = cipher.update(privateKeyJson, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get the auth tag
      const authTag = cipher.getAuthTag();
      
      // Format: iv:authTag:encryptedData
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Encrypting private key: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
  
  /**
   * Decrypts a private key retrieved from the database
   * 
   * @param {string} encryptedPrivateKey - The encrypted private key
   * @returns {Promise<string>} - The decrypted private key as a JSON string
   */
  static async decryptPrivateKey(encryptedPrivateKey) {
    try {
      // Check if this is an encrypted value (contains the format separator)
      if (!encryptedPrivateKey.includes(':')) {
        // Not encrypted, return as is (likely from before encryption was implemented)
        return encryptedPrivateKey;
      }
      
      if (!process.env.WALLET_ENCRYPTION_KEY) {
        throw new Error('Wallet encryption key not found in environment');
      }
      
      // Get the encryption key
      const encryptionKey = Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex');
      
      // Split the components
      const [ivHex, authTagHex, encryptedData] = encryptedPrivateKey.split(':');
      
      // Convert back to buffers
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      // Create decipher
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityApiClient]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Decrypting private key: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

export default VanityApiClient;