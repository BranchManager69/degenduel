// services/vanity-wallet/generators/local-generator.js

/**
 * Local Vanity Wallet Generator using solana-keygen
 * 
 * This module uses the native solana-keygen grind command to generate vanity wallet addresses.
 * Significantly more efficient than a pure JavaScript implementation.
 */

import { spawn, exec } from 'child_process';
import { cpus, loadavg, totalmem, freemem } from 'os';
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
const DEFAULT_WORKERS = 5; // Use 5 threads as requested
const DEFAULT_CPU_LIMIT = 50; // Lower CPU usage limit to 50%
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
    
    // Check for and kill any orphaned solana-keygen processes
    this.cleanupOrphanedProcesses();
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initialized ${fancyColors.RESET} with solana-keygen grind, ${this.numWorkers} threads (reduced), ${this.cpuLimit}% CPU limit (lowered)`);
  }
  
  /**
   * Monitor resource usage for a running job
   * @param {string} jobId The ID of the job to monitor
   * @param {number} processPid The PID of the solana-keygen process
   * @returns {number} The interval ID for cleanup
   */
  monitorResourceUsage(jobId, processPid) {
    const interval = setInterval(() => {
      try {
        // Get process stats if it's still running
        if (this.activeJobs.has(jobId)) {
          // Get system stats
          const load = loadavg();
          const systemMemory = totalmem();
          const freeMemoryVal = freemem();
          const memoryUsedPercent = Math.round((systemMemory - freeMemoryVal) / systemMemory * 100);
          const loadColor = load[0] > 1.5 ? fancyColors.RED : (load[0] > 1.0 ? fancyColors.YELLOW : fancyColors.GREEN);
          const memColor = memoryUsedPercent > 80 ? fancyColors.RED : (memoryUsedPercent > 70 ? fancyColors.YELLOW : fancyColors.GREEN);
          
          // Log detailed resource information with color-coded status
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.CYAN}RESOURCE MONITOR${fancyColors.RESET} Job ${jobId} (PID: ${processPid}) - Load: ${loadColor}${load[0].toFixed(2)}${fancyColors.RESET} | Memory: ${memColor}${Math.round((systemMemory-freeMemoryVal)/1024/1024)}MB (${memoryUsedPercent}%)${fancyColors.RESET}`);
        } else {
          // Job no longer active, clear interval
          clearInterval(interval);
        }
      } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Resource monitoring error:${fancyColors.RESET} ${error.message}`);
        clearInterval(interval);
      }
    }, 30000); // Log every 30 seconds
    
    return interval;
  }
  
  /**
   * Clean up any orphaned solana-keygen processes from previous runs
   */
  cleanupOrphanedProcesses() {
    try {
      // Use ps command to find solana-keygen processes
      exec('ps aux | grep solana-keygen | grep -v grep', (error, stdout, stderr) => {
        if (stdout) {
          const processes = stdout.trim().split('\n');
          logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ORPHANED PROCESSES ${fancyColors.RESET} Found ${processes.length} orphaned solana-keygen processes`);
          
          // Kill each orphaned process
          processes.forEach(process => {
            try {
              const parts = process.trim().split(/\s+/);
              const pid = parts[1];
              
              logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Killing orphaned process${fancyColors.RESET} PID: ${pid}`);
              
              // Kill the process
              exec(`kill -9 ${pid}`, (killError) => {
                if (killError) {
                  logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to kill process ${pid}:${fancyColors.RESET} ${killError.message}`);
                } else {
                  logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Killed orphaned process${fancyColors.RESET} PID: ${pid}`);
                }
              });
            } catch (parseError) {
              logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error parsing process info:${fancyColors.RESET} ${parseError.message}`);
            }
          });
        }
      });
      
      // Also check for cpulimit processes that might be orphaned
      exec('ps aux | grep cpulimit | grep -v grep', (error, stdout, stderr) => {
        if (stdout) {
          const processes = stdout.trim().split('\n');
          logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ORPHANED CPULIMIT ${fancyColors.RESET} Found ${processes.length} orphaned cpulimit processes`);
          
          // Kill each orphaned cpulimit process
          processes.forEach(process => {
            try {
              const parts = process.trim().split(/\s+/);
              const pid = parts[1];
              
              logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Killing orphaned cpulimit${fancyColors.RESET} PID: ${pid}`);
              
              // Kill the process
              exec(`kill -9 ${pid}`, (killError) => {
                if (killError) {
                  logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to kill cpulimit process ${pid}:${fancyColors.RESET} ${killError.message}`);
                } else {
                  logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Killed orphaned cpulimit${fancyColors.RESET} PID: ${pid}`);
                }
              });
            } catch (parseError) {
              logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error parsing process info:${fancyColors.RESET} ${parseError.message}`);
            }
          });
        }
      });
      
      // Check for orphaned files in the output directory
      const files = fs.readdirSync(this.outputDir).filter(f => f !== '.' && f !== '..');
      if (files.length > 0) {
        logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ORPHANED FILES ${fancyColors.RESET} Found ${files.length} files in temp directory`);
        
        // Log and remove each orphaned file
        files.forEach(file => {
          try {
            const filePath = path.join(this.outputDir, file);
            logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Removing orphaned file:${fancyColors.RESET} ${file}`);
            fs.unlinkSync(filePath);
            logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Removed orphaned file${fancyColors.RESET}`);
          } catch (fileError) {
            logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error removing orphaned file:${fancyColors.RESET} ${fileError.message}`);
          }
        });
      }
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error during orphaned process cleanup:${fancyColors.RESET} ${error.message}`);
    }
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
    
    // Enhanced logging with more details and highlighted formatting
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STARTING ${fancyColors.RESET} Keygen job ${job.id} - ${fancyColors.CYAN}pattern: ${fancyColors.YELLOW}${job.pattern}${fancyColors.RESET}, case-sensitive: ${job.caseSensitive ? 'yes' : 'no'}, suffix: ${job.isSuffix ? 'yes' : 'no'}, file: ${outputFile}`);
    
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
    
    // Log PID for tracking
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Started solana-keygen process with PID ${process.pid} for job ${job.id}${fancyColors.RESET}`);
    
    // Start resource monitoring
    const monitorInterval = this.monitorResourceUsage(job.id, process.pid);
    
    // Calculate CPU limit value (percentage of total CPU)
    const cpuLimitValue = Math.floor(this.cpuLimit);
    
    // Create job info for tracking
    const jobInfo = {
      job,
      process,
      startTime,
      cpulimitProcess: null,
      outputPath: outputFile,
      monitorInterval // Store for cleanup
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
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Progress for job ${job.id} (PID: ${process.pid}): ${output.trim()}${fancyColors.RESET}`);
      }
    });
    
    // Handle stderr data
    process.stderr.on('data', (data) => {
      const output = data.toString();
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Keygen Error ${fancyColors.RESET} Job ${job.id} (PID: ${process.pid}): ${output.trim()}`, {
        error: output.trim(),
        jobId: job.id,
        processPid: process.pid
      });
    });
    
    // Handle process completion
    process.on('close', async (code) => {
      // Track end time
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Clear resource monitoring
      if (jobInfo.monitorInterval) {
        clearInterval(jobInfo.monitorInterval);
      }
      
      // Kill cpulimit process if it exists
      if (jobInfo.cpulimitProcess) {
        try {
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Stopping CPU limit process for job ${job.id}${fancyColors.RESET}`);
          process.kill(jobInfo.cpulimitProcess.pid);
        } catch (error) {
          // Ignore errors from already terminated processes
          logApi.debug(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}CPU limiter already stopped:${fancyColors.RESET} ${error.message}`);
        }
      }
      
      // Enhanced completion log with status icon
      const icon = code === 0 ? '✅' : '❌';
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${code === 0 ? fancyColors.GREEN : fancyColors.RED}${icon} Process ${process.pid} for job ${job.id} exited with code ${code} after ${(duration/1000).toFixed(2)}s${fancyColors.RESET}`);
      
      if (code === 0) {
        // Success - keypair was generated 
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} SUCCESS ${fancyColors.RESET} Vanity address ${fancyColors.YELLOW}${job.pattern}${fancyColors.RESET} generated for job ${job.id} in ${fancyColors.GREEN}${(duration / 1000).toFixed(2)}s${fancyColors.RESET}`);
        
        try {
          // Check if file exists and log stats
          if (fs.existsSync(outputFile)) {
            const fileStats = fs.statSync(outputFile);
            logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Output file created:${fancyColors.RESET} ${outputFile} (size: ${fileStats.size} bytes)`);
          } else {
            logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Expected output file not found:${fancyColors.RESET} ${outputFile}`);
          }
          
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