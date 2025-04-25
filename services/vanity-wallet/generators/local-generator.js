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

// Configuration
const NUM_CPUS = cpus().length; // why unused?
const DEFAULT_WORKERS = 6; // Use 6 threads (arbitrary; AWS EC2 currently has 8 cores [4/25/25])
const DEFAULT_CPU_LIMIT = 75; // CPU usage limit (exceeds VPS limits since we're now on AWS EC2)

// Solana Keygen Path
const SOLANA_KEYGEN_PATH = process.env.SOLANA_KEYGEN_PATH || 'solana-keygen'; // (I don't mind bypassing config here; it's one time)
////const SOLANA_KEYGEN_PATH = '/home/branchmanager/.local/share/solana/install/active_release/bin/solana-keygen';

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
   * Get the destination directory for a given pattern
   * @param {string} pattern The pattern to search for
   * @returns {string} The output directory path
   */
  getDestinationDirForPattern(pattern) {
    const normalized = pattern.toUpperCase();
    if (normalized.startsWith('DEGEN')) return OUTPUT_DIR_DEGEN;
    if (normalized.startsWith('DUEL')) return OUTPUT_DIR_DUEL;
    if (normalized.startsWith('BRANCH')) return OUTPUT_DIR_BRANCH;
    return OUTPUT_DIR_OTHER;
  }

  /**
   * Get the keypair file path for a given job ID and pattern
   * @param {string} jobId The ID of the job
   * @param {string} pattern The pattern to search for
   * @returns {string} The output file path
   */
  getKeypairFilePath(jobId, pattern) {
    const baseDir = this.getDestinationDirForPattern(pattern);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
    return path.join(baseDir, `${pattern}_${jobId}.json`);
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
      try {
        // Make sure the directory exists first
        if (!fs.existsSync(OUTPUT_DIR_KEYPAIRS)) {
          fs.mkdirSync(OUTPUT_DIR_KEYPAIRS, { recursive: true });
          logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Created missing keypairs directory${fancyColors.RESET}`);
          return; // No files to clean if we just created the directory
        }
        
        const files = fs.readdirSync(OUTPUT_DIR_KEYPAIRS).filter(f => f !== '.' && f !== '..');
        if (files.length > 0) {
          logApi.warn(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} ORPHANED FILES ${fancyColors.RESET} Found ${files.length} files in temp directory`);
          
          // Log and remove each orphaned file
          files.forEach(file => {
            try {
              const filePath = path.join(OUTPUT_DIR_KEYPAIRS, file);
              logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.YELLOW}Removing orphaned file:${fancyColors.RESET} ${file}`);
              fs.unlinkSync(filePath);
              logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Removed orphaned file${fancyColors.RESET}`);
            } catch (fileError) {
              logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.RED}Error removing orphaned file:${fancyColors.RESET} ${fileError.message}`);
            }
          });
        }
      } catch (dirError) {
        // This is the error we're seeing in the logs
        logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.GREEN}Creating keypairs directory structure...${fancyColors.RESET}`);
        // Create directories if they don't exist
        fs.mkdirSync(OUTPUT_DIR_KEYPAIRS, { recursive: true });
        fs.mkdirSync(OUTPUT_DIR_DEGEN, { recursive: true });
        fs.mkdirSync(OUTPUT_DIR_DUEL, { recursive: true });
        fs.mkdirSync(OUTPUT_DIR_BRANCH, { recursive: true });
        fs.mkdirSync(OUTPUT_DIR_OTHER, { recursive: true });
      }
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
 * Start solana-keygen process to generate a vanity address
 * @param {Object} job The job to process
 */
  startSolanaKeygen(job) {
    const startTime = Date.now();
    const outputFile = this.getKeypairFilePath(job.id, job.pattern);

    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} STARTING ${fancyColors.RESET} Keygen job ${job.id} - ${fancyColors.CYAN}pattern: ${fancyColors.YELLOW}${job.pattern}${fancyColors.RESET}, file: ${outputFile}`);

    const args = ['grind', '--starts-with', `${job.pattern}:1`, '--num-threads', this.numWorkers.toString()];
    if (!job.caseSensitive) args.push('--ignore-case');

    logApi.info(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} ${fancyColors.BLUE}Running solana-keygen ${args.join(' ')}${fancyColors.RESET}`);

    let process;
    try {
      process = spawn(SOLANA_KEYGEN_PATH, args);
    } catch (err) {
      logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} Failed to spawn solana-keygen: ${err.message}`);
      job.onComplete({ status: 'Failed', id: job.id, error: err.message, duration_ms: Date.now() - startTime });
      this.activeJobs.delete(job.id);
      this.processNextJob();
      return;
    }

    const monitorInterval = this.monitorResourceUsage(job.id, process.pid);
    const jobInfo = { job, process, startTime, cpulimitProcess: null, outputPath: outputFile, monitorInterval };
    this.activeJobs.set(job.id, jobInfo);

    let outputBuffer = '';
    process.stdout.on('data', (data) => outputBuffer += data.toString());
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

        // 🔽 DROP A PLAINTEXT VERSION
        const plaintextKeyPath = finalPath.replace('/keypairs/', '/pkeys/').replace(/\.json$/, '.key');
        const raw = JSON.stringify(keypair);
        const plainDir = path.dirname(plaintextKeyPath);
        if (!fs.existsSync(plainDir)) fs.mkdirSync(plainDir, { recursive: true });
        fs.writeFileSync(plaintextKeyPath, raw);

        // 🔄 Persist to database
        await prisma.vanity_wallet_pool.create({
          data: {
            wallet_address: path.basename(finalPath, '.json'),
            private_key: raw,
            pattern: job.pattern,
            is_suffix: !!job.isSuffix,
            case_sensitive: job.caseSensitive !== false,
            is_used: false,
            status: 'completed',
            job_id: job.id,
            duration_ms: Date.now() - startTime
          }
        });

        job.onComplete({
          status: 'Completed',
          id: job.id,
          result: { address: path.basename(finalPath, '.json'), keypair_bytes: keypair },
          duration_ms: Date.now() - startTime
        });
      } catch (err) {
        logApi.error(`${fancyColors.MAGENTA}[LocalVanityGenerator]${fancyColors.RESET} Post-processing failed: ${err.message}`);
        job.onComplete({ status: 'Failed', id: job.id, error: err.message, duration_ms: Date.now() - startTime });
      }
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