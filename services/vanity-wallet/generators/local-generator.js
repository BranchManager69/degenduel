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
import prisma from '../../../config/prisma.js';
import { Keypair } from '@solana/web3.js';

// Determine current file directory for temporary files
// (old way of storing found keypairs)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// (new way of storing found keypairs)
// Fix path to use absolute path from project root
const OUTPUT_DIR_KEYPAIRS = path.join(__dirname, '../../../../addresses/keypairs');
// Branded contest wallets (three flavors)
const OUTPUT_DIR_DEGEN = path.join(OUTPUT_DIR_KEYPAIRS, 'public/_DEGEN');
const OUTPUT_DIR_DUEL = path.join(OUTPUT_DIR_KEYPAIRS, 'public/_DUEL');
const OUTPUT_DIR_BRANCH = path.join(OUTPUT_DIR_KEYPAIRS, 'public/_BRANCH');
// Other vanity wallets
const OUTPUT_DIR_OTHER = path.join(OUTPUT_DIR_KEYPAIRS, 'other');

// Calculate number of worker threads based on available CPU cores
const DEFAULT_WORKERS = Math.max(2, Math.floor(cpus().length * 0.8)); // 80% of cores, min 2
const DEFAULT_CPU_LIMIT = 90; // 90% CPU limit

// Path to solana-keygen
const SOLANA_KEYGEN_PATH = process.env.SOLANA_KEYGEN_PATH || 'solana-keygen'; // (I don't mind bypassing config here; it's one time)

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
    
    // Make sure all output directories exist
    if (!fs.existsSync(OUTPUT_DIR_KEYPAIRS)) {
      fs.mkdirSync(OUTPUT_DIR_KEYPAIRS, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR_DEGEN)) {
      fs.mkdirSync(OUTPUT_DIR_DEGEN, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR_DUEL)) {
      fs.mkdirSync(OUTPUT_DIR_DUEL, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR_BRANCH)) {
      fs.mkdirSync(OUTPUT_DIR_BRANCH, { recursive: true });
    }
    if (!fs.existsSync(OUTPUT_DIR_OTHER)) {
      fs.mkdirSync(OUTPUT_DIR_OTHER, { recursive: true });
    }
    
    // Check for and kill any orphaned solana-keygen processes
    this.cleanupOrphanedProcesses();
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initialized ${fancyColors.RESET} with solana-keygen grind, ${this.numWorkers} threads (reduced), ${this.cpuLimit}% CPU limit (lowered)`);
  }

  /**
   * Process the next job in the queue
   * This starts a new solana-keygen process for the next job
   */
  async processNextJob() {
    // If already processing or no jobs in queue, skip
    if (this.isProcessing || this.jobQueue.length === 0) {
      return;
    }
    
    // If at max workers, skip
    if (this.activeJobs.size >= this.numWorkers) {
      return;
    }
    
    // Set processing flag
    this.isProcessing = true;
    
    try {
      // Get next job
      const job = this.jobQueue.shift();
      
      // Log job
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} PROCESSING ${fancyColors.RESET} Starting job ${job.id} for pattern ${job.pattern}`);
      
      // Start solana-keygen process
      const startTime = Date.now();
      
      // Update database status
      try {
        await prisma.vanity_wallet_pool.update({
          where: { id: parseInt(job.id) },
          data: {
            status: 'processing',
            updated_at: new Date()
          }
        });
      } catch (dbError) {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to update database status for job ${job.id}: ${dbError.message}${fancyColors.RESET}`);
      }
      
      // Set job parameters
      const isSuffix = job.isSuffix || false;
      const caseSensitive = job.caseSensitive !== false; // True by default
      const numThreads = job.numThreads || this.numWorkers;
      
      // Build solana-keygen command
      const options = ["grind", "--no-bip39-passphrase"]; // Base command options
      
      // Add pattern with count (solana-keygen requires PREFIX:COUNT format)
      if (isSuffix) {
        options.push('--ends-with', `${job.pattern}:1`);  // Only need 1 address
      } else {
        options.push('--starts-with', `${job.pattern}:1`);  // Only need 1 address
      }
      
      // Add case sensitivity
      if (!caseSensitive) {
        options.push('--ignore-case');
      }
      
      // Add num-threads parameter, allowing override per job
      options.push('--num-threads', numThreads.toString());
      
      // Create a temp file for output - but don't specify with flag (will use default)
      const outputFile = path.join('/tmp', `vanity-${job.id}-${Date.now()}.json`);
      
      // Start the process
      this.startSolanaKeygenProcess(job, options, startTime, outputFile);
    } catch (error) {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error starting job: ${error.message}${fancyColors.RESET}`);
    } finally {
      // Clear processing flag
      this.isProcessing = false;
      
      // Process next job if queue not empty and below max workers
      if (this.jobQueue.length > 0 && this.activeJobs.size < this.numWorkers) {
        this.processNextJob();
      }
    }
  }
  
  /**
   * Add a job to the processing queue
   * This is the standardized method name we'll use across the codebase
   * 
   * @param {Object} job - The job to queue
   * @param {string} job.id - Job ID
   * @param {string} job.pattern - Pattern to search for
   * @param {boolean} job.isSuffix - Whether pattern is suffix
   * @param {boolean} job.caseSensitive - Whether pattern is case sensitive
   * @param {Function} job.onComplete - Callback function called when job completes
   * @param {Function} [job.onProgress] - Optional callback for progress updates
   * @throws {Error} If the job is invalid or missing required properties
   */
  addJob(job) {
    // Validate job object
    if (!job) {
      throw new Error('Job cannot be null or undefined');
    }
    
    if (!job.id) {
      throw new Error('Job must have an id property');
    }
    
    if (!job.pattern) {
      throw new Error('Job must have a pattern property');
    }
    
    if (typeof job.onComplete !== 'function') {
      throw new Error('Job must have an onComplete callback function');
    }
    
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} QUEUING ${fancyColors.RESET} Job ${job.id} for pattern ${job.pattern}`);
    
    // Add to queue
    this.jobQueue.push(job);
    
    // Start processing if not already processing
    if (!this.isProcessing && this.activeJobs.size < this.numWorkers) {
      this.processNextJob();
    }
  }
  
  /**
   * Legacy method for compatibility
   * @deprecated Use addJob instead
   * @param {Object} job - The job to queue
   */
  queueJob(job) {
    // Log deprecation warning to help with migration
    logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}DEPRECATED: queueJob is deprecated, use addJob instead${fancyColors.RESET}`);
    
    // Forward to the standardized method
    this.addJob(job);
  }

  /**
   * Start a solana-keygen process to generate a vanity address
   * @param {Object} job The job to process
   * @param {Array<string>} options Command line options for solana-keygen
   * @param {number} startTime Timestamp when the job was started
   * @param {string} outputFile Path to save the keypair
   */
  startSolanaKeygenProcess(job, options, startTime, outputFile) {
    // Create a result object to track generation
    const result = { attempts: 0 };
    
    // Start the solana-keygen process
    const process = spawn(SOLANA_KEYGEN_PATH, options);
    
    // If the process fails to start, handle the error
    process.on('error', (error) => {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to start solana-keygen process: ${error.message}${fancyColors.RESET}`);
      
      // Remove from active jobs
      this.activeJobs.delete(job.id);
      
      // Call the completion callback with an error
      job.onComplete({
        status: 'Failed',
        id: job.id,
        error: `Failed to start solana-keygen: ${error.message}`,
        duration_ms: Date.now() - startTime
      });
      
      // Try to process the next job
      this.processNextJob();
      
      return;
    });

    const monitorInterval = this.monitorResourceUsage(job.id, process.pid);
    const jobInfo = { job, process, startTime, cpulimitProcess: null, outputPath: outputFile, monitorInterval };
    this.activeJobs.set(job.id, jobInfo);

    let outputBuffer = '';
    let lastAttemptCount = 0;
    
    // Capture stdout data, including attempt count
    process.stdout.on('data', (data) => {
      const dataStr = data.toString();
      outputBuffer += dataStr;
      
      // Parse attempt count from output
      const attemptMatch = dataStr.match(/Searched (\d+) keypairs/);
      if (attemptMatch && attemptMatch[1]) {
        lastAttemptCount = parseInt(attemptMatch[1], 10);
        
        // Store progress in result object
        result.attempts = lastAttemptCount;
        
        // Update database with attempts count
        try {
          prisma.vanity_wallet_pool.update({
            where: { id: parseInt(job.id) },
            data: { attempts: lastAttemptCount }
          }).catch(err => {
            // Ignore errors here, we'll just keep processing
            logApi.debug(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} Error updating attempts: ${err.message}`);
          });
        } catch (err) {
          // Ignore this error too
        }
        
        // Log progress every million attempts
        if (lastAttemptCount % 1000000 === 0) {
          const duration = Date.now() - startTime;
          const attemptsPerSec = Math.round(lastAttemptCount / (duration / 1000));
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Job ${job.id}${fancyColors.RESET} - ${lastAttemptCount.toLocaleString()} keypairs searched (${attemptsPerSec.toLocaleString()}/sec), runtime: ${Math.round(duration/1000)}s`);
        }
      }
    });
    
    process.stderr.on('data', (data) => logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} stderr: ${data}`));

    process.on('close', async () => {
      clearInterval(monitorInterval);
      this.activeJobs.delete(job.id);
      try {
        const line = outputBuffer.split('\n').find(l => l.includes('Wrote keypair to'));
        const match = line?.match(/Wrote keypair to (\S+\.json)/);
        if (!match) throw new Error('Output parsing failed');

        const originalPath = match[1];
        const finalPath = this.getKeypairFilePath(job.id, job.pattern);
        fs.renameSync(originalPath, finalPath);

        const keypair = JSON.parse(fs.readFileSync(finalPath, 'utf8'));

        // Get the actual Solana public key from the keypair
        const secretKey = Uint8Array.from(keypair);
        const wallet = Keypair.fromSecretKey(secretKey);
        const publicKey = wallet.publicKey.toString();

        // 🔽 DROP A PLAINTEXT VERSION
        const plaintextKeyPath = finalPath.replace('/keypairs/', '/pkeys/').replace(/\.json$/, '.key');
        const raw = JSON.stringify(keypair);
        const plainDir = path.dirname(plaintextKeyPath);
        if (!fs.existsSync(plainDir)) fs.mkdirSync(plainDir, { recursive: true });
        fs.writeFileSync(plaintextKeyPath, raw);

        // 🔄 Update existing record in database instead of creating a new one
        try {
          // Get theoretical probability based on pattern and case sensitivity
          const charSpace = job.caseSensitive !== false ? 58 : 33; // 58 for case-sensitive, 33 for case-insensitive
          const theoreticalAttempts = Math.pow(charSpace, job.pattern.length);
          const efficiency = (theoreticalAttempts / (result.attempts || lastAttemptCount || 1)) * 100;
          
          // Enhanced data collection - removed unsupported metadata field
          await prisma.vanity_wallet_pool.update({
            where: { id: parseInt(job.id) }, // Use the job ID to find the existing record
            data: {
              wallet_address: publicKey, // Use the actual Solana public key
              private_key: raw,
              status: 'completed',
              attempts: result.attempts || lastAttemptCount || 0, // Use the parsed attempt count
              duration_ms: Date.now() - startTime,
              completed_at: new Date(),
              updated_at: new Date()
              // Removed metadata field as it's not in the schema
            }
          });
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} UPDATED DB ${fancyColors.RESET} Successfully updated record for job #${job.id} with completed address ${publicKey}`);
        } catch (dbError) {
          logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} DB ERROR ${fancyColors.RESET} Failed to update database record for job #${job.id}: ${dbError.message}`, {
            error: dbError.message,
            stack: dbError.stack,
            jobId: job.id
          });
        }

        // Calculate performance metrics
        const charSpace = job.caseSensitive !== false ? 58 : 33;
        const theoreticalAttempts = Math.pow(charSpace, job.pattern.length);
        const attempts = result.attempts || lastAttemptCount || 0;
        const duration = Date.now() - startTime;
        const attemptsPerSec = Math.round(attempts / (duration / 1000));
        const efficiency = (theoreticalAttempts / (attempts || 1)) * 100;
        
        // Enhanced completion callback with detailed metrics
        job.onComplete({
          status: 'Completed',
          id: job.id,
          result: { 
            address: publicKey, 
            keypair_bytes: keypair,
            metrics: {
              theoretical_attempts: theoreticalAttempts,
              efficiency_percentage: efficiency,
              character_space: charSpace,
              attempts_per_second: attemptsPerSec,
              pattern_length: job.pattern.length,
              is_suffix: job.isSuffix || false,
              case_sensitive: job.caseSensitive !== false
            }
          },
          duration_ms: duration,
          attempts: attempts
        });
      } catch (err) {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} Post-processing failed: ${err.message}`);
        const attempts = result.attempts || lastAttemptCount || 0;
        const duration = Date.now() - startTime;
        
        job.onComplete({ 
          status: 'Failed', 
          id: job.id, 
          error: err.message, 
          duration_ms: duration,
          attempts: attempts,
          pattern: job.pattern,
          isSuffix: job.isSuffix || false,
          caseSensitive: job.caseSensitive !== false
        });
      }
      this.processNextJob();
    });
  }

  /**
   * Monitor resource usage of a solana-keygen process
   * @param {string} jobId The job ID
   * @param {number} processPid The PID of the solana-keygen process
   * @returns {number} The interval ID for clearing the monitor
   */
  monitorResourceUsage(jobId, processPid) {
    return setInterval(() => {
      try {
        // Get process stats if it's still running
        const load = loadavg();
        const systemMemory = totalmem();
        const freeMemoryVal = freemem();
        const memoryUsedPercent = Math.round(((systemMemory - freeMemoryVal) / systemMemory) * 100);
        
        // Calculate color coding for load and memory
        const loadColor = load[0] < 1 ? fancyColors.GREEN : (load[0] < 2 ? fancyColors.YELLOW : fancyColors.RED);
        const memColor = memoryUsedPercent < 60 ? fancyColors.GREEN : (memoryUsedPercent < 85 ? fancyColors.YELLOW : fancyColors.RED);
        
        // Log resource usage every minute (using a modulo on seconds)
        const now = new Date();
        if (now.getSeconds() % 60 === 0) {
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.CYAN}RESOURCE MONITOR${fancyColors.RESET} Job ${jobId} (PID: ${processPid}) - Load: ${loadColor}${load[0].toFixed(2)}${fancyColors.RESET} | Memory: ${memColor}${Math.round((systemMemory-freeMemoryVal)/1024/1024)}MB (${memoryUsedPercent}%)${fancyColors.RESET}`);
        }
      } catch (error) {
        // Ignore errors in resource monitoring
      }
    }, 5000); // Check every 5 seconds
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
          
          // Kill each orphaned process
          processes.forEach(process => {
            try {
              const parts = process.trim().split(/\s+/);
              const pid = parts[1];
              
              logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Killing orphaned cpulimit process${fancyColors.RESET} PID: ${pid}`);
              
              // Kill the process
              exec(`kill -9 ${pid}`, (killError) => {
                if (killError) {
                  logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to kill cpulimit process ${pid}:${fancyColors.RESET} ${killError.message}`);
                } else {
                  logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Killed orphaned cpulimit process${fancyColors.RESET} PID: ${pid}`);
                }
              });
            } catch (parseError) {
              logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error parsing cpulimit process info:${fancyColors.RESET} ${parseError.message}`);
            }
          });
        }
      });
      
      // Also check for temporary files in the output directory
      const tempPattern = /vanity-\d+-\d+\.json/;
      if (fs.existsSync('/tmp')) {
        fs.readdir('/tmp', (err, files) => {
          if (err) {
            logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to read /tmp directory:${fancyColors.RESET} ${err.message}`);
            return;
          }
          
          const tempFiles = files.filter(file => tempPattern.test(file));
          if (tempFiles.length > 0) {
            logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ORPHANED FILES ${fancyColors.RESET} Found ${tempFiles.length} temporary files in /tmp directory`);
            
            tempFiles.forEach(file => {
              try {
                const filePath = path.join('/tmp', file);
                fs.unlinkSync(filePath);
                logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Deleted temporary file:${fancyColors.RESET} ${file}`);
              } catch (unlinkError) {
                logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to delete temporary file:${fancyColors.RESET} ${unlinkError.message}`);
              }
            });
          }
        });
      }
      
      // Check the keypairs directory for stray and orphaned files
      if (fs.existsSync(OUTPUT_DIR_KEYPAIRS)) {
        fs.readdir(OUTPUT_DIR_KEYPAIRS, (err, files) => {
          if (err) {
            logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Failed to read keypairs directory:${fancyColors.RESET} ${err.message}`);
            return;
          }
          
          // Look for files that aren't the expected subdirectories
          const orphanedFiles = files.filter(file => !['public', 'other'].includes(file));
          if (orphanedFiles.length > 0) {
            logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ORPHANED FILES ${fancyColors.RESET} Found ${orphanedFiles.length} files in temp directory`);
            
            orphanedFiles.forEach(file => {
              try {
                const filePath = path.join(OUTPUT_DIR_KEYPAIRS, file);
                logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Removing orphaned file:${fancyColors.RESET} ${file}`);
                fs.unlinkSync(filePath);
              } catch (unlinkError) {
                logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error removing orphaned file:${fancyColors.RESET} ${unlinkError.message}`);
              }
            });
          }
        });
      }
    } catch (err) {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error cleaning up orphaned processes:${fancyColors.RESET} ${err.message}`);
    }
  }
  
  /**
   * Get the keypair file path for a given job
   * @param {string} jobId The job ID
   * @param {string} pattern The vanity pattern
   * @returns {string} The path to the keypair file
   */
  getKeypairFilePath(jobId, pattern) {
    const normalized = String(pattern).toUpperCase();
    let outputDir = OUTPUT_DIR_OTHER;
    
    if (normalized.startsWith('DEGEN')) {
      outputDir = OUTPUT_DIR_DEGEN;
    } else if (normalized.startsWith('DUEL')) {
      outputDir = OUTPUT_DIR_DUEL;
    } else if (normalized.startsWith('BRANCH')) {
      outputDir = OUTPUT_DIR_BRANCH;
    }
    
    // Create a unique filename based on the job ID and pattern
    return path.join(outputDir, `${jobId}_${pattern}.json`);
  }
  
  /**
   * Cancel a job
   * @param {string} jobId The job ID to cancel
   * @returns {boolean} True if job was cancelled, false otherwise
   */
  cancelJob(jobId) {
    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Requested to cancel job ${jobId}${fancyColors.RESET}`);
    
    if (!jobId) {
      logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Invalid job ID for cancellation${fancyColors.RESET}`);
      return false;
    }
    
    // Check if the job is in the queue
    const queueIndex = this.jobQueue.findIndex(job => job.id === jobId);
    if (queueIndex >= 0) {
      // Remove from queue
      const job = this.jobQueue.splice(queueIndex, 1)[0];
      
      logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Cancelled ${fancyColors.RESET} Queued job ${jobId}`);
      
      // Notify completion with cancelled status
      job.onComplete({
        status: 'Cancelled',
        id: jobId,
        error: 'Job was cancelled',
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