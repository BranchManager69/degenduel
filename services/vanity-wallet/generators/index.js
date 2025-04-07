// services/vanity-wallet/generators/index.js

/**
 * Vanity Wallet Generator Manager
 * 
 * This module manages the vanity wallet generator instances and provides a unified interface
 * for submitting jobs and retrieving results.
 */

import LocalVanityGenerator from './local-generator.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Singleton instance
let instance = null;

/**
 * VanityWalletGeneratorManager is a singleton class that manages the vanity wallet generator
 */
class VanityWalletGeneratorManager {
  /**
   * Constructor
   * @param {Object} options Configuration options
   */
  constructor(options = {}) {
    // Create the local generator
    this.localGenerator = new LocalVanityGenerator(options);
    
    // Job tracking
    this.jobCallbacks = new Map();
    
    logApi.info(`${fancyColors.MAGENTA}[VanityGeneratorManager]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Initialized ${fancyColors.RESET} Local vanity wallet generator`);
  }
  
  /**
   * Submit a new vanity wallet generation job
   * 
   * @param {Object} jobConfig Job configuration
   * @param {string} jobConfig.id Unique job ID
   * @param {string} jobConfig.pattern The pattern to search for
   * @param {boolean} jobConfig.isSuffix Whether the pattern should be at the end of the address
   * @param {boolean} jobConfig.caseSensitive Whether the pattern matching is case sensitive
   * @param {Function} onComplete Callback function when job completes
   * @param {Function} onProgress Optional callback function for progress updates
   * @returns {Promise<Object>} Job information
   */
  async submitJob(jobConfig, onComplete, onProgress) {
    if (!jobConfig.id) {
      throw new Error('Job ID is required');
    }
    
    if (!jobConfig.pattern) {
      throw new Error('Pattern is required');
    }
    
    if (typeof onComplete !== 'function') {
      throw new Error('Completion callback is required');
    }
    
    // Store callbacks
    this.jobCallbacks.set(jobConfig.id, {
      onComplete,
      onProgress: typeof onProgress === 'function' ? onProgress : null
    });
    
    // Create job for the generator
    const job = {
      id: jobConfig.id,
      pattern: jobConfig.pattern,
      isSuffix: jobConfig.isSuffix || false,
      caseSensitive: jobConfig.caseSensitive !== false,
      
      // Proxy callbacks to store results and clean up
      onComplete: (result) => {
        this.handleJobComplete(jobConfig.id, result);
      },
      onProgress: onProgress ? (progress) => {
        this.handleJobProgress(jobConfig.id, progress);
      } : null
    };
    
    // Submit to local generator
    if (!this.localGenerator.addJob(job)) {
      throw new Error(`Failed to add job ${jobConfig.id} to generator`);
    }
    
    logApi.info(`${fancyColors.MAGENTA}[VanityGeneratorManager]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Submitted ${fancyColors.RESET} Job ${jobConfig.id} for pattern ${jobConfig.pattern}`);
    
    // Return job information
    return {
      id: jobConfig.id,
      status: 'queued',
      queuePosition: this.localGenerator.activeJobCount === 0 ? 0 : this.localGenerator.queueLength
    };
  }
  
  /**
   * Cancel a job
   * 
   * @param {string} jobId The ID of the job to cancel
   * @returns {boolean} Whether the job was cancelled successfully
   */
  cancelJob(jobId) {
    if (!jobId) {
      throw new Error('Job ID is required');
    }
    
    return this.localGenerator.cancelJob(jobId);
  }
  
  /**
   * Get the status of current jobs
   * 
   * @returns {Object} Status information
   */
  getStatus() {
    return this.localGenerator.getStatus();
  }
  
  /**
   * Handle job completion
   * 
   * @param {string} jobId The ID of the completed job
   * @param {Object} result The job result
   */
  handleJobComplete(jobId, result) {
    // Get the callbacks
    const callbacks = this.jobCallbacks.get(jobId);
    
    if (!callbacks) {
      logApi.warn(`${fancyColors.MAGENTA}[VanityGeneratorManager]${fancyColors.RESET} ${fancyColors.YELLOW}No callbacks found for completed job ${jobId}${fancyColors.RESET}`);
      return;
    }
    
    // Call the completion callback
    try {
      callbacks.onComplete(result);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityGeneratorManager]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Callback Error ${fancyColors.RESET} Error in completion callback for job ${jobId}: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        jobId
      });
    }
    
    // Clean up
    this.jobCallbacks.delete(jobId);
  }
  
  /**
   * Handle job progress update
   * 
   * @param {string} jobId The ID of the job
   * @param {Object} progress Progress information
   */
  handleJobProgress(jobId, progress) {
    // Get the callbacks
    const callbacks = this.jobCallbacks.get(jobId);
    
    if (!callbacks || !callbacks.onProgress) {
      return;
    }
    
    // Call the progress callback
    try {
      callbacks.onProgress(progress);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[VanityGeneratorManager]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Callback Error ${fancyColors.RESET} Error in progress callback for job ${jobId}: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        jobId
      });
    }
  }
  
  /**
   * Get the singleton instance of the generator manager
   * 
   * @param {Object} options Configuration options
   * @returns {VanityWalletGeneratorManager} The generator manager instance
   */
  static getInstance(options = {}) {
    if (!instance) {
      instance = new VanityWalletGeneratorManager(options);
    }
    
    return instance;
  }
}

export default VanityWalletGeneratorManager;