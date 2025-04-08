// services/vanity-wallet/generators/local-generator.js

/**
 * Local Vanity Wallet Generator using solana-keygen
 * 
 * This module uses the native solana-keygen grind command to generate vanity wallet addresses.
 * Significantly more efficient than a pure JavaScript implementation.
 */

import { spawn } from 'child_process';
import { cpus } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Determine current file directory for temporary files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const NUM_CPUS = cpus().length;
const DEFAULT_WORKERS = Math.max(1, NUM_CPUS - 1); // Leave one CPU for the main thread
const DEFAULT_CPU_LIMIT = 75; // Default CPU usage limit (75%)
const SOLANA_KEYGEN_PATH = '/home/branchmanager/.local/share/solana/install/active_release/bin/solana-keygen';

/**
 * LocalVanityGenerator class
 * Manages the process of generating vanity addresses using solana-keygen grind
 */
class LocalVanityGenerator {
  /**
   * Constructor
   * @param {Object} options Configuration options
   * @param {number} options.numWorkers Number of worker threads to use
   * @param {number} options.batchSize Number of attempts per batch (not used with solana-keygen)
   * @param {number} options.maxAttempts Maximum number of attempts before giving up (not used with solana-keygen)
   * @param {number} options.cpuLimit CPU usage limit as percentage (default: 75%)
   */
  constructor(options = {}) {
    this.numWorkers = options.numWorkers || DEFAULT_WORKERS;
    this.cpuLimit = options.cpuLimit || DEFAULT_CPU_LIMIT;
    this.activeJobs = new Map();
    this.jobQueue = [];
    this.isProcessing = false;
    this.outputDir = path.join(__dirname, '../temp_keypairs');
    
    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initialized ${fancyColors.RESET} with solana-keygen grind, ${this.numWorkers} threads, ${this.cpuLimit}% CPU limit`);
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
      
      // Kill the solana-keygen process
      if (jobInfo.process) {
        try {
          process.kill(jobInfo.process.pid);
        } catch (error) {
          logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to kill solana-keygen process: ${error.message}${fancyColors.RESET}`);
        }
      }
      
      // Kill the cpulimit process
      if (jobInfo.cpulimitProcess) {
        try {
          process.kill(jobInfo.cpulimitProcess.pid);
        } catch (error) {
          // Ignore errors from already terminated processes
        }
      }
      
      // Remove from active jobs
      this.activeJobs.delete(jobId);
      
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Cancelled ${fancyColors.RESET} Active job ${jobId}`);
      
      // Notify completion with cancelled status
      jobInfo.job.onComplete({
        status: 'Cancelled',
        id: jobId,
        attempts: 0, // No accurate way to track with solana-keygen
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
    
    // Start the solana-keygen process for this job
    this.startSolanaKeygen(job);
  }
  
  /**
   * Generate a filename for a keypair based on job ID
   * @param {string} jobId Job ID
   * @param {string} pattern Pattern being searched for
   * @returns {string} The output file path
   */
  getKeypairFilePath(jobId, pattern) {
    return path.join(this.outputDir, `${pattern}_${jobId}.json`);
  }
  
  /**
   * Start solana-keygen process to generate a vanity address
   * @param {Object} job The job to process
   */
  startSolanaKeygen(job) {
    const startTime = Date.now();
    const outputFile = this.getKeypairFilePath(job.id, job.pattern);
    
    // Build the solana-keygen command arguments
    const args = ['grind'];
    
    // Add pattern to search for
    args.push('--starts-with');
    args.push(`${job.pattern}:1`); // Only generate 1 address
    
    // Set case sensitivity
    if (!job.caseSensitive) {
      args.push('--ignore-case');
    }
    
    // Set thread count
    args.push('--num-threads');
    args.push(this.numWorkers.toString());
    
    // Set output file
    args.push('--output');
    args.push(outputFile);
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Running solana-keygen ${args.join(' ')}${fancyColors.RESET}`);
    
    // Spawn the solana-keygen process
    const process = spawn(SOLANA_KEYGEN_PATH, args);
    
    // Calculate CPU limit value (percentage of total CPU)
    const cpuLimitValue = Math.floor(this.cpuLimit);
    
    // Create job info for tracking
    const jobInfo = {
      job,
      process,
      startTime,
      cpulimitProcess: null,
      outputPath: outputFile
    };
    
    this.activeJobs.set(job.id, jobInfo);
    
    // Set up CPU limiting with cpulimit
    if (this.cpuLimit < 100) {
      try {
        // Create the cpulimit command
        const cpulimitProcess = spawn('cpulimit', [
          '-p', process.pid.toString(),
          '-l', cpuLimitValue.toString()
        ]);
        
        // Store cpulimit process for cleanup
        jobInfo.cpulimitProcess = cpulimitProcess;
        
        // Log cpulimit status
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Applied CPU limit of ${this.cpuLimit}% to process ${process.pid}${fancyColors.RESET}`);
        
        // Handle cpulimit errors
        cpulimitProcess.on('error', (err) => {
          logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CPU Limit Error ${fancyColors.RESET} Job ${job.id}: ${err.message}`, {
            error: err.message,
            jobId: job.id
          });
        });
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CPU Limit Error ${fancyColors.RESET} Failed to apply CPU limit: ${error.message}`, {
          error: error.message,
          jobId: job.id
        });
      }
    }
    
    // Track output data for progress reporting
    let outputBuffer = '';
    
    // Handle stdout data
    process.stdout.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;
      
      // Check if we have progress information
      if (output.includes('Searching with') || output.includes('Generated') || output.includes('Found vanity address')) {
        // Send progress update if callback provided
        if (job.onProgress) {
          job.onProgress({
            id: job.id,
            attempts: 0, // No accurate way to track with solana-keygen
            duration_ms: Date.now() - startTime,
            output: output.trim()
          });
        }
        
        // Log progress
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Progress for job ${job.id}: ${output.trim()}${fancyColors.RESET}`);
      }
    });
    
    // Handle stderr data
    process.stderr.on('data', (data) => {
      const output = data.toString();
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Keygen Error ${fancyColors.RESET} Job ${job.id}: ${output.trim()}`, {
        error: output.trim(),
        jobId: job.id
      });
    });
    
    // Handle process completion
    process.on('close', async (code) => {
      // Kill cpulimit process if it exists
      if (jobInfo.cpulimitProcess) {
        try {
          process.kill(jobInfo.cpulimitProcess.pid);
        } catch (error) {
          // Ignore errors from already terminated processes
        }
      }
      
      const duration = Date.now() - startTime;
      
      if (code === 0) {
        // Success - keypair was generated
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Success ${fancyColors.RESET} Vanity address generated for job ${job.id} in ${(duration / 1000).toFixed(2)}s`);
        
        try {
          // Read the keypair file
          const keypairContent = fs.readFileSync(outputFile, 'utf8');
          const keypairArray = JSON.parse(keypairContent);
          
          // Get the public key from the first line of output that contains it
          let publicKey = '';
          const lines = outputBuffer.split('\n');
          for (const line of lines) {
            // Look for line with "pubkey:" or "address:"
            if (line.includes('pubkey:') || line.includes('address:')) {
              const parts = line.split(':');
              if (parts.length >= 2) {
                publicKey = parts[1].trim();
                break;
              }
            } else if (line.includes('Found vanity address')) {
              // Parse the address from "Found vanity address: DUEL..."
              const addressMatch = line.match(/Found vanity address: ([\w\d]+)/);
              if (addressMatch && addressMatch[1]) {
                publicKey = addressMatch[1];
                break;
              }
            }
          }
          
          // If we couldn't find the public key in the output,
          // try to read metadata from the generated file
          if (!publicKey && fs.existsSync(`${outputFile}.json`)) {
            try {
              const metadata = JSON.parse(fs.readFileSync(`${outputFile}.json`, 'utf8'));
              if (metadata.pubkey) {
                publicKey = metadata.pubkey;
              }
            } catch (metadataError) {
              logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to read metadata for job ${job.id}: ${metadataError.message}${fancyColors.RESET}`);
            }
          }
          
          // If we still don't have a public key, use the pattern as a fallback
          if (!publicKey) {
            publicKey = `${job.pattern}...`;
            logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Could not determine public key for job ${job.id}, using fallback${fancyColors.RESET}`);
          }
          
          // Clean up this job
          this.activeJobs.delete(job.id);
          
          // Call completion callback
          job.onComplete({
            status: 'Completed',
            id: job.id,
            result: {
              address: publicKey,
              keypair_bytes: keypairArray
            },
            duration_ms: duration
          });
          
          // Start next job if there's one in the queue
          this.processNextJob();
        } catch (error) {
          logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} File Error ${fancyColors.RESET} Job ${job.id}: ${error.message}`, {
            error: error.message,
            stack: error.stack,
            jobId: job.id
          });
          
          // Clean up this job
          this.activeJobs.delete(job.id);
          
          // Call completion callback with failure
          job.onComplete({
            status: 'Failed',
            id: job.id,
            error: `Failed to read keypair file: ${error.message}`,
            duration_ms: duration
          });
          
          // Start next job if there's one in the queue
          this.processNextJob();
        }
      } else {
        // Process exited with non-zero code
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Process Error ${fancyColors.RESET} Job ${job.id}: solana-keygen exited with code ${code}`, {
          error: `solana-keygen exited with code ${code}`,
          jobId: job.id
        });
        
        // Clean up this job
        this.activeJobs.delete(job.id);
        
        // Call completion callback with failure
        job.onComplete({
          status: 'Failed',
          id: job.id,
          error: `solana-keygen exited with code ${code}`,
          duration_ms: duration
        });
        
        // Start next job if there's one in the queue
        this.processNextJob();
      }
    });
    
    // Handle process errors
    process.on('error', (error) => {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Process Error ${fancyColors.RESET} Job ${job.id}: ${error.message}`, {
        error: error.message,
        stack: error.stack,
        jobId: job.id
      });
      
      // Kill cpulimit process if it exists
      if (jobInfo.cpulimitProcess) {
        try {
          process.kill(jobInfo.cpulimitProcess.pid);
        } catch (cpuError) {
          // Ignore errors from already terminated processes
        }
      }
      
      // Clean up this job
      this.activeJobs.delete(job.id);
      
      // Call completion callback with failure
      job.onComplete({
        status: 'Failed',
        id: job.id,
        error: error.message,
        duration_ms: Date.now() - startTime
      });
      
      // Start next job if there's one in the queue
      this.processNextJob();
    });
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