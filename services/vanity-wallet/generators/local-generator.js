// services/vanity-wallet/generators/local-generator.js

/**
 * Local Vanity Wallet Generator
 * 
 * This module provides a pure JavaScript implementation for generating Solana vanity wallet addresses.
 * It uses worker threads to parallelize the workload across CPU cores.
 */

import { Keypair } from '@solana/web3.js';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Determine current file directory for worker scripts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const NUM_CPUS = cpus().length;
const DEFAULT_WORKERS = Math.max(1, NUM_CPUS - 1); // Leave one CPU for the main thread

/**
 * Worker thread implementation
 * This code runs in separate threads to search for vanity addresses
 */
if (!isMainThread) {
  const { pattern, isSuffix, caseSensitive, startIndex, batchSize } = workerData;
  
  // Convert pattern to proper case form for comparison
  const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
  
  // Create randomness source for Solana keypairs
  const getRandomValues = size => crypto.randomBytes(size);
  
  // Function to check if address matches pattern
  const matchesPattern = (address, pattern, isSuffix, caseSensitive) => {
    const compareAddress = caseSensitive ? address : address.toLowerCase();
    
    if (isSuffix) {
      // Check if address ends with pattern
      return compareAddress.endsWith(pattern);
    } else {
      // Check if address starts with pattern directly
      return compareAddress.startsWith(pattern);
    }
  };
  
  // Search for a vanity address
  let attempts = 0;
  const startTime = Date.now();
  
  // Process a batch of keypairs
  for (let i = 0; i < batchSize; i++) {
    attempts++;
    
    // Generate a Solana keypair
    const keypair = Keypair.generate({ randomBytes: getRandomValues });
    const address = keypair.publicKey.toString();
    
    // Check if address matches the pattern
    if (matchesPattern(address, searchPattern, isSuffix, caseSensitive)) {
      // Found a match!
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Return the result to the main thread
      parentPort.postMessage({
        found: true,
        address,
        keypair: Array.from(keypair.secretKey),
        attempts,
        duration,
        rate: attempts / (duration / 1000)
      });
      
      // Exit this worker
      break;
    }
    
    // Check if we should report progress
    if (attempts % 10000 === 0) {
      parentPort.postMessage({
        found: false,
        attempts,
        duration: Date.now() - startTime,
        batchComplete: false
      });
    }
  }
  
  // Batch completed without finding a match
  parentPort.postMessage({
    found: false,
    attempts,
    duration: Date.now() - startTime,
    batchComplete: true
  });
}

/**
 * LocalVanityGenerator class
 * Manages the process of generating vanity addresses using worker threads
 */
class LocalVanityGenerator {
  /**
   * Constructor
   * @param {Object} options Configuration options
   * @param {number} options.numWorkers Number of worker threads to use
   * @param {number} options.batchSize Number of attempts per batch
   * @param {number} options.maxAttempts Maximum number of attempts before giving up
   */
  constructor(options = {}) {
    this.numWorkers = options.numWorkers || DEFAULT_WORKERS;
    this.batchSize = options.batchSize || 10000;
    this.maxAttempts = options.maxAttempts || 50000000; // 50 million attempts
    this.activeJobs = new Map();
    this.jobQueue = [];
    this.isProcessing = false;
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initialized ${fancyColors.RESET} with ${this.numWorkers} workers and batch size ${this.batchSize}`);
  }
  
  /**
   * Add a job to the generator queue
   * @param {Object} job Job configuration
   * @param {string} job.id Unique job ID
   * @param {string} job.pattern The pattern to search for
   * @param {boolean} job.isSuffix Whether to match the pattern at the end of the address
   * @param {boolean} job.caseSensitive Whether the pattern matching is case sensitive
   * @param {Function} job.onComplete Callback function when job completes
   * @param {Function} job.onProgress Optional callback function for progress updates
   * @returns {boolean} Whether the job was added successfully
   */
  addJob(job) {
    if (!job.id || !job.pattern || typeof job.onComplete !== 'function') {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Invalid Job ${fancyColors.RESET} Missing required job properties`);
      return false;
    }
    
    if (this.activeJobs.has(job.id)) {
      logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Duplicate ${fancyColors.RESET} Job ID ${job.id} already exists`);
      return false;
    }
    
    // Add job to queue
    this.jobQueue.push(job);
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Queued ${fancyColors.RESET} Job ${job.id} for pattern ${job.pattern} (${this.jobQueue.length} in queue)`);
    
    // Start processing if not already running
    if (!this.isProcessing) {
      this.processNextJob();
    }
    
    return true;
  }
  
  /**
   * Cancel a job by ID
   * @param {string} jobId The ID of the job to cancel
   * @returns {boolean} Whether the job was cancelled successfully
   */
  cancelJob(jobId) {
    // Check if the job is in the queue
    const queueIndex = this.jobQueue.findIndex(job => job.id === jobId);
    if (queueIndex >= 0) {
      // Remove job from queue
      const job = this.jobQueue.splice(queueIndex, 1)[0];
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Cancelled ${fancyColors.RESET} Queued job ${jobId}`);
      
      // Notify completion with cancelled status
      job.onComplete({
        status: 'Cancelled',
        id: jobId,
        attempts: 0,
        duration_ms: 0
      });
      
      return true;
    }
    
    // Check if the job is active
    if (this.activeJobs.has(jobId)) {
      const jobInfo = this.activeJobs.get(jobId);
      
      // Terminate all workers
      jobInfo.workers.forEach(worker => {
        try {
          worker.terminate();
        } catch (error) {
          // Ignore errors from already terminated workers
        }
      });
      
      // Remove from active jobs
      this.activeJobs.delete(jobId);
      
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Cancelled ${fancyColors.RESET} Active job ${jobId}`);
      
      // Notify completion with cancelled status
      jobInfo.job.onComplete({
        status: 'Cancelled',
        id: jobId,
        attempts: jobInfo.attempts,
        duration_ms: Date.now() - jobInfo.startTime
      });
      
      // Start next job if there's one in the queue
      this.processNextJob();
      
      return true;
    }
    
    // Job not found
    logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Cannot cancel job ${jobId}: not found${fancyColors.RESET}`);
    return false;
  }
  
  /**
   * Process the next job in the queue
   */
  processNextJob() {
    if (this.jobQueue.length === 0) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    const job = this.jobQueue.shift();
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Processing ${fancyColors.RESET} Job ${job.id} for pattern ${job.pattern}`);
    
    // Start workers for this job
    this.startWorkers(job);
  }
  
  /**
   * Start worker threads to process a job
   * @param {Object} job The job to process
   */
  startWorkers(job) {
    const startTime = Date.now();
    const pattern = job.caseSensitive ? job.pattern : job.pattern.toLowerCase();
    
    // Setup job tracking
    const jobInfo = {
      job,
      workers: [],
      attempts: 0,
      startTime,
      found: false
    };
    
    this.activeJobs.set(job.id, jobInfo);
    
    // Create workers
    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker(__filename, {
        workerData: {
          pattern,
          isSuffix: job.isSuffix || false,
          caseSensitive: job.caseSensitive !== false,
          startIndex: i,
          batchSize: this.batchSize
        }
      });
      
      // Add worker to tracking
      jobInfo.workers.push(worker);
      
      // Handle messages from worker
      worker.on('message', message => {
        if (jobInfo.found) {
          // We already found a result, ignore additional messages
          return;
        }
        
        // Update attempt count
        jobInfo.attempts += message.attempts;
        
        // Check for successful result
        if (message.found) {
          jobInfo.found = true;
          
          // Terminate all workers for this job
          jobInfo.workers.forEach(w => {
            try {
              if (w !== worker) {
                w.terminate();
              }
            } catch (error) {
              // Ignore errors from already terminated workers
            }
          });
          
          // Calculate final statistics
          const duration = message.duration;
          const attempts = jobInfo.attempts;
          const rate = attempts / (duration / 1000);
          
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Found ${fancyColors.RESET} Vanity address for job ${job.id}: ${message.address}`);
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Generated in ${duration}ms with ${attempts} attempts (${Math.round(rate)} addresses/sec)${fancyColors.RESET}`);
          
          // Clean up this job
          this.activeJobs.delete(job.id);
          
          // Call completion callback
          job.onComplete({
            status: 'Completed',
            id: job.id,
            result: {
              address: message.address,
              keypair_bytes: message.keypair
            },
            attempts,
            duration_ms: duration,
            rate_per_second: Math.round(rate)
          });
          
          // Start next job if there's one in the queue
          this.processNextJob();
        } 
        else if (message.batchComplete) {
          // Worker completed its batch without finding a match
          
          // Update progress if callback provided
          if (job.onProgress) {
            job.onProgress({
              id: job.id,
              attempts: jobInfo.attempts,
              duration_ms: Date.now() - startTime
            });
          }
          
          // Check if we've exceeded max attempts
          if (jobInfo.attempts >= this.maxAttempts) {
            // Too many attempts, give up
            logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Failed ${fancyColors.RESET} Exceeded maximum attempts (${this.maxAttempts}) for job ${job.id}`);
            
            // Terminate all workers for this job
            jobInfo.workers.forEach(w => {
              try {
                w.terminate();
              } catch (error) {
                // Ignore errors from already terminated workers
              }
            });
            
            // Clean up this job
            this.activeJobs.delete(job.id);
            
            // Call completion callback with failure
            job.onComplete({
              status: 'Failed',
              id: job.id,
              error: 'Exceeded maximum attempts',
              attempts: jobInfo.attempts,
              duration_ms: Date.now() - startTime
            });
            
            // Start next job if there's one in the queue
            this.processNextJob();
          } 
          else {
            // Start another batch with this worker
            try {
              worker.terminate();
            } catch (error) {
              // Ignore errors from already terminated workers
            }
            
            // Remove this worker
            const index = jobInfo.workers.indexOf(worker);
            if (index >= 0) {
              jobInfo.workers.splice(index, 1);
            }
            
            // Create a new worker to replace it
            const newWorker = new Worker(__filename, {
              workerData: {
                pattern,
                isSuffix: job.isSuffix || false,
                caseSensitive: job.caseSensitive !== false,
                startIndex: i,
                batchSize: this.batchSize
              }
            });
            
            jobInfo.workers.push(newWorker);
            
            // Setup event handlers for new worker (recursive)
            newWorker.on('message', message => worker.emit('message', message));
            newWorker.on('error', error => worker.emit('error', error));
            newWorker.on('exit', code => worker.emit('exit', code));
          }
        }
        else {
          // Progress update
          
          // Only send progress updates occasionally to avoid overwhelming the callback
          if (job.onProgress && jobInfo.attempts % 100000 === 0) {
            job.onProgress({
              id: job.id,
              attempts: jobInfo.attempts,
              duration_ms: Date.now() - startTime
            });
          }
        }
      });
      
      // Handle worker errors
      worker.on('error', error => {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Worker Error ${fancyColors.RESET} Job ${job.id}: ${error.message}`, {
          error: error.message,
          stack: error.stack,
          jobId: job.id
        });
      });
      
      // Handle worker exit
      worker.on('exit', code => {
        if (code !== 0 && !jobInfo.found) {
          logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Worker exited with code ${code} for job ${job.id}${fancyColors.RESET}`);
        }
      });
    }
  }
  
  /**
   * Get the status of current jobs
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      queuedJobs: this.jobQueue.length,
      activeJobs: Array.from(this.activeJobs.entries()).map(([id, info]) => ({
        id,
        pattern: info.job.pattern,
        attempts: info.attempts,
        runtime_ms: Date.now() - info.startTime
      }))
    };
  }
  
  /**
   * Get the number of jobs in the queue
   * @returns {number} Number of queued jobs
   */
  get queueLength() {
    return this.jobQueue.length;
  }
  
  /**
   * Get the number of active jobs
   * @returns {number} Number of active jobs
   */
  get activeJobCount() {
    return this.activeJobs.size;
  }
}

export default LocalVanityGenerator;