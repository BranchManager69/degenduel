// services/vanity-wallet/vanity-wallet-service.js

/**
 * Vanity Wallet Service
 * 
 * This service runs in the background and steadily generates DUEL and DEGEN vanity addresses.
 * It maintains a pool of available addresses for contests to use.
 */

import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, serviceSpecificColors } from '../../utils/colors.js';
import prisma from '../../config/prisma.js';
import config from '../../config/config.js';
import VanityApiClient from './vanity-api-client.js';
import { BaseService } from '../../utils/service-suite/base-service.js';
import { exec } from 'child_process';
import VanityWalletGeneratorManager from './generators/index.js';

class VanityWalletService extends BaseService {
  constructor() {
    // Pass proper configuration object to BaseService constructor with 60 second interval
    super({
      name: 'vanity_wallet_service',
      description: 'Vanity wallet generation and management',
      checkIntervalMs: 60000 // Check every 60 seconds (1 minute)
    });
    
    // Configuration
    this.patterns = ['DUEL', 'DEGEN'];
    this.targetCounts = {
      DUEL: 15,  // Maintain 15 available DUEL addresses (3x the original value of 5)
      DEGEN: 9   // Maintain 9 available DEGEN addresses (3x the original value of 3)
    };
    // Define pattern timeouts based on benchmark data
    this.patternTimeouts = {
      // Formula based on benchmarks: baseTime * characterSpace^(length - baseLength)
      // For a 3-character pattern like 'TST': ~20-60 seconds (typical)
      // For a 4-character pattern like 'DUEL' or 'DEGEN': ~100-500 seconds (typical)
      // For a 5-character pattern: ~10-30 minutes (typical)
      'DUEL': this.calculateTimeout('DUEL'),
      'DEGEN': this.calculateTimeout('DEGEN')
    };
    this.intervalMs = 60000; // Check every 60 seconds (1 minute)
    this.isGenerating = false;
    this.maxConcurrentJobs = 1; // Only generate one at a time to avoid high CPU usage
    
    // When true, only one service instance will be active even in a clustered environment
    this.singletonService = true;
    
    // Service interval for checkAndGenerateAddresses
    this.checkAndGenerateInterval = null;
    
    // Use the same generator instance as VanityApiClient for consistency
    this.generator = VanityWalletGeneratorManager.getInstance({
      numWorkers: config.vanityWallet?.numWorkers || undefined,
      batchSize: config.vanityWallet?.batchSize || undefined,
      maxAttempts: config.vanityWallet?.maxAttempts || undefined
    });
  }
  
  /**
   * Calculate an appropriate timeout based on pattern length and complexity
   * @param {string} pattern - The vanity address pattern
   * @param {boolean} caseSensitive - Whether the pattern is case sensitive
   * @returns {number} - Timeout in milliseconds
   */
  calculateTimeout(pattern, caseSensitive = true) {
    // Benchmark: 4-character case-sensitive pattern took ~106 seconds 
    const BASE_TIME_4_CHARS = 159; // seconds (with safety margin)
    const BASE_CHAR_COUNT = 4;
    
    // Character space depends on case sensitivity
    const charSpace = caseSensitive ? 58 : 33;
    
    // Calculate difficulty factor based on pattern length difference
    const lengthDiff = pattern.length - BASE_CHAR_COUNT;
    const difficultyFactor = lengthDiff >= 0 
      ? Math.pow(charSpace, lengthDiff)  // Each additional character multiplies difficulty by charSpace
      : 1 / Math.pow(charSpace, -lengthDiff); // Each fewer character divides difficulty by charSpace
    
    // Calculate timeout in milliseconds with reasonable limits
    const MIN_TIMEOUT = 60 * 1000;  // 60 seconds minimum
    const MAX_TIMEOUT = 30 * 60 * 1000; // 30 minutes maximum
    
    const calculatedTimeout = BASE_TIME_4_CHARS * difficultyFactor * 1000;
    const timeout = Math.min(Math.max(calculatedTimeout, MIN_TIMEOUT), MAX_TIMEOUT);
    
    logApi.info(`${fancyColors.MAGENTA}[VanityWalletService]${fancyColors.RESET} Calculated timeout for pattern "${pattern}" (${pattern.length} chars): ${Math.round(timeout/1000)} seconds`);
    return timeout;
  }
  
  /**
   * Initialize the service
   */
  async initialize() {
    try {
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initializing ${fancyColors.RESET} Vanity Wallet Service`);
      
      // Call parent class initialize method first
      await super.initialize();
      
      // Check if WALLET_ENCRYPTION_KEY is set
      if (!process.env.WALLET_ENCRYPTION_KEY) {
        logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Warning ${fancyColors.RESET} WALLET_ENCRYPTION_KEY is not set. Private keys will not be encrypted.`);
      }
      
      // Read configuration
      if (config.vanityWallet?.targetCounts) {
        this.targetCounts = config.vanityWallet.targetCounts;
      }
      
      if (config.vanityWallet?.checkIntervalMinutes) {
        this.intervalMs = 1000 * 60 * config.vanityWallet.checkIntervalMinutes;
        // Also update the base service check interval
        this.config.checkIntervalMs = this.intervalMs;
      } else {
        // Use default 60 second interval if not configured
        this.intervalMs = 60000; 
        this.config.checkIntervalMs = 60000;
      }
      
      if (config.vanityWallet?.maxConcurrentJobs) {
        this.maxConcurrentJobs = config.vanityWallet.maxConcurrentJobs;
      }
      
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Configuration: Check interval ${this.intervalMs/1000/60} minutes, Max concurrent jobs: ${this.maxConcurrentJobs}${fancyColors.RESET}`);
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Target counts: DUEL: ${this.targetCounts.DUEL}, DEGEN: ${this.targetCounts.DEGEN}${fancyColors.RESET}`);
      
      // Set as operational
      this.isOperational = true;
      
      return true;
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Initializing service: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
  
  /**
   * Legacy init method for backward compatibility
   * @deprecated Use initialize() instead
   */
  async init() {
    return this.initialize();
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
   * Called when the service starts via the BaseService lifecycle
   * This method is called by BaseService.start()
   */
  async onServiceStart() {
    logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Starting ${fancyColors.RESET} Vanity Wallet Service`);
    
    // Find and clean up any orphaned processes that might be using resources
    await this.cleanupOrphanedProcesses();
    
    // Reset stuck jobs in database
    await this.resetStuckJobs();
    
    // Set up status report interval (every 1 minute)
    this.statusReportInterval = setInterval(() => this.logJobStatus(), 60 * 1000);
    
    logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} Started ${fancyColors.RESET} Vanity Wallet Service`);
    
    // Run an initial check
    await this.checkAndGenerateAddresses();
    
    // Log initial job status
    await this.logJobStatus();
    
    // BaseService will handle the interval automatically via performOperation
    return true;
  }
  
  /**
   * Legacy start method for backward compatibility 
   * @deprecated Use BaseService.start() instead
   */
  async start() {
    return super.start();
  }
  
  /**
   * Log detailed status of all jobs
   */
  async logJobStatus() {
    try {
      // Get counts of addresses by status
      const statusCounts = await prisma.$queryRaw`
        SELECT pattern, status, COUNT(*) as count
        FROM vanity_wallet_pool
        WHERE status IN ('pending', 'processing', 'completed')
        GROUP BY pattern, status
        ORDER BY pattern, status
      `;
      
      // Get counts of completed and used addresses
      const completedUsedCounts = await prisma.$queryRaw`
        SELECT pattern, is_used, COUNT(*) as count
        FROM vanity_wallet_pool
        WHERE status = 'completed'
        GROUP BY pattern, is_used
        ORDER BY pattern, is_used
      `;
      
      // Get information about currently processing jobs
      const processingJobs = await prisma.vanity_wallet_pool.findMany({
        where: { status: 'processing' },
        orderBy: { updated_at: 'asc' },
        select: {
          id: true,
          pattern: true,
          created_at: true,
          updated_at: true,
          status: true
        }
      });
      
      // Calculate how long each job has been processing
      const processingDetails = processingJobs.map(job => {
        const processingTime = Date.now() - new Date(job.updated_at).getTime();
        const processingMinutes = Math.floor(processingTime / 60000);
        return {
          id: job.id,
          pattern: job.pattern,
          processingTime: processingMinutes
        };
      });
      
      // Format and log the results
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} JOB STATUS ${fancyColors.RESET} Vanity wallet generation status`);
      
      // Log status counts by pattern
      if (statusCounts.length > 0) {
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Pattern Counts:${fancyColors.RESET}`);
        for (const row of statusCounts) {
          const statusColor = 
            row.status === 'completed' ? fancyColors.GREEN : 
            row.status === 'processing' ? fancyColors.YELLOW : 
            fancyColors.BLUE;
          logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET}   ${row.pattern}: ${statusColor}${row.status}${fancyColors.RESET} = ${row.count}`);
        }
      } else {
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}No jobs found in database${fancyColors.RESET}`);
      }
      
      // Log details of currently processing jobs
      if (processingDetails.length > 0) {
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Currently Processing Jobs (${processingDetails.length}):${fancyColors.RESET}`);
        for (const job of processingDetails) {
          // Color code based on processing time
          const timeColor = 
            job.processingTime > 30 ? fancyColors.RED :
            job.processingTime > 15 ? fancyColors.YELLOW :
            fancyColors.GREEN;
          
          logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET}   Job #${job.id} (${job.pattern}): Processing for ${timeColor}${job.processingTime} minutes${fancyColors.RESET}`);
        }
      } else {
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}No jobs currently processing${fancyColors.RESET}`);
      }
      
      // Get summary of available and used addresses
      if (completedUsedCounts.length > 0) {
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Available/Used Addresses:${fancyColors.RESET}`);
        for (const row of completedUsedCounts) {
          const usedColor = row.is_used ? fancyColors.YELLOW : fancyColors.GREEN;
          logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET}   ${row.pattern}: ${usedColor}${row.is_used ? 'Used' : 'Available'}${fancyColors.RESET} = ${row.count}`);
        }
      }
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error getting job status: ${error.message}${fancyColors.RESET}`);
    }
  }
  
  /**
   * Clean up any orphaned solana-keygen processes
   */
  async cleanupOrphanedProcesses() {
    try {
      // Use ps command to find solana-keygen processes
      return new Promise((resolve) => {
        exec('ps aux | grep solana-keygen | grep -v grep', (error, stdout, stderr) => {
          if (stdout) {
            const processes = stdout.trim().split('\n');
            logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} ORPHANED PROCESSES ${fancyColors.RESET} Found ${processes.length} orphaned solana-keygen processes`);
            
            let killedCount = 0;
            let pendingKills = processes.length;
            
            // Kill each orphaned process
            processes.forEach(process => {
              try {
                const parts = process.trim().split(/\s+/);
                const pid = parts[1];
                
                logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Killing orphaned process${fancyColors.RESET} PID: ${pid}`);
                
                // Kill the process
                exec(`kill -9 ${pid}`, (killError) => {
                  pendingKills--;
                  
                  if (killError) {
                    logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to kill process ${pid}:${fancyColors.RESET} ${killError.message}`);
                  } else {
                    killedCount++;
                    logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Killed orphaned process${fancyColors.RESET} PID: ${pid}`);
                  }
                  
                  if (pendingKills === 0) {
                    logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Cleanup complete:${fancyColors.RESET} Killed ${killedCount} orphaned processes`);
                    resolve(killedCount);
                  }
                });
              } catch (parseError) {
                pendingKills--;
                logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error parsing process info:${fancyColors.RESET} ${parseError.message}`);
                
                if (pendingKills === 0) {
                  resolve(killedCount);
                }
              }
            });
          } else {
            // No orphaned processes found
            resolve(0);
          }
        });
      });
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error during orphaned process cleanup:${fancyColors.RESET} ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Reset any jobs stuck in 'processing' state and detect invalid wallet addresses
   */
  async resetStuckJobs() {
    try {
      // Find jobs that have been in 'processing' state for too long
      const stuckJobs = await prisma.vanity_wallet_pool.findMany({
        where: {
          status: 'processing',
          updated_at: {
            // Stuck jobs are those in processing state for more than 15 minutes (reduced from 30)
            lt: new Date(Date.now() - 15 * 60 * 1000)
          }
        }
      });
      
      if (stuckJobs.length > 0) {
        logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} STUCK JOBS ${fancyColors.RESET} Found ${stuckJobs.length} stuck jobs in 'processing' state for >15 minutes`);
        
        // Reset stuck jobs to 'pending' state
        for (const job of stuckJobs) {
          logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Resetting stuck job ${job.id}${fancyColors.RESET} (pattern: ${job.pattern}, stuck since ${job.updated_at})`);
          
          // Check if any solana-keygen processes exist for this job
          try {
            const jobPid = await this.findJobProcessId(job.id);
            if (jobPid) {
              logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Found process for job ${job.id}, PID: ${jobPid}, killing...${fancyColors.RESET}`);
              try {
                await this.killProcess(jobPid);
                logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Killed process ${jobPid} for job ${job.id}${fancyColors.RESET}`);
              } catch (killError) {
                logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to kill process ${jobPid} for job ${job.id}: ${killError.message}${fancyColors.RESET}`);
              }
            }
          } catch (processError) {
            logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error checking process for job ${job.id}: ${processError.message}${fancyColors.RESET}`);
          }
          
          await prisma.vanity_wallet_pool.update({
            where: { id: job.id },
            data: {
              status: 'pending',
              updated_at: new Date()
            }
          });
        }
        
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Reset ${stuckJobs.length} stuck jobs to 'pending' state${fancyColors.RESET}`);
      }
      
      // Also check for invalid completed wallet addresses (like job_id_pattern format)
      const invalidWalletAddresses = await prisma.vanity_wallet_pool.findMany({
        where: {
          status: 'completed',
          OR: [
            { wallet_address: { contains: '_' } },
            { wallet_address: { startsWith: 'DUEL_' } },
            { wallet_address: { startsWith: 'DEGEN_' } },
            { wallet_address: { endsWith: '_DUEL' } },
            { wallet_address: { endsWith: '_DEGEN' } }
          ]
        }
      });
      
      if (invalidWalletAddresses.length > 0) {
        logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} INVALID WALLETS ${fancyColors.RESET} Found ${invalidWalletAddresses.length} completed wallets with invalid address format`);
        
        // Mark them as failed so they can be regenerated
        for (const wallet of invalidWalletAddresses) {
          logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Invalid wallet address format: ${wallet.wallet_address} for job ${wallet.id}${fancyColors.RESET}`);
          
          await prisma.vanity_wallet_pool.update({
            where: { id: wallet.id },
            data: {
              status: 'failed',
              updated_at: new Date(),
              completed_at: new Date()
            }
          });
        }
        
        logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.GREEN}Marked ${invalidWalletAddresses.length} wallets with invalid addresses as failed${fancyColors.RESET}`);
      }
      
      return stuckJobs.length + invalidWalletAddresses.length;
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error resetting stuck jobs:${fancyColors.RESET} ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Find process ID for a job
   * @param {string} jobId The job ID to find
   * @returns {Promise<string|null>} The process ID if found, null otherwise
   */
  async findJobProcessId(jobId) {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      
      // Look for solana-keygen process with the job ID
      exec(`ps -ef | grep solana-keygen | grep ${jobId} | grep -v grep`, (error, stdout) => {
        if (error || !stdout.trim()) {
          // No process found
          resolve(null);
          return;
        }
        
        // Parse the process ID from ps output
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 2) {
          resolve(parts[1]);
        } else {
          resolve(null);
        }
      });
    });
  }
  
  /**
   * Kill a process by PID
   * @param {string} pid The process ID to kill
   * @returns {Promise<boolean>} Whether the process was killed successfully
   */
  async killProcess(pid) {
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      
      exec(`kill -9 ${pid}`, (error) => {
        if (error) {
          reject(new Error(`Failed to kill process ${pid}: ${error.message}`));
          return;
        }
        
        resolve(true);
      });
    });
  }
  
  /**
   * Called when the service stops - part of the BaseService lifecycle
   * This method is called by BaseService.stop()
   */
  async onServiceStop() {
    logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} Stopping ${fancyColors.RESET} Vanity Wallet Service`);
    
    // Clean up the status report interval
    if (this.statusReportInterval) {
      clearInterval(this.statusReportInterval);
      this.statusReportInterval = null;
    }
    
    // Clean up any resources if needed
    // BaseService will handle clearing the main service interval
    return true;
  }
  
  /**
   * Legacy stop method for backward compatibility
   * @deprecated Use BaseService.stop() instead
   */
  async stop() {
    return super.stop();
  }
  
  /**
   * Check the current pool of addresses and generate more if needed
   */
  async checkAndGenerateAddresses() {
    // Skip if we're already generating
    if (this.isGenerating) {
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Already generating addresses, skipping check${fancyColors.RESET}`);
      return;
    }
    
    try {
      this.isGenerating = true;
      
      // Check current count of available addresses for each pattern
      const counts = {};
      
      // Also check for pending and processing jobs to avoid creating too many
      const pendingJobsCount = await prisma.vanity_wallet_pool.count({
        where: {
          status: { in: ['pending', 'processing'] }
        }
      });
      
      // If there are too many pending jobs already, skip creating more
      const MAX_PENDING_JOBS = 10; // Hard limit to avoid endless generation
      if (pendingJobsCount >= MAX_PENDING_JOBS) {
        logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} TOO MANY JOBS ${fancyColors.RESET} There are already ${pendingJobsCount} pending/processing vanity wallet jobs. Limiting to ${MAX_PENDING_JOBS} maximum.`);
        
        // Clean up any excess jobs if there are too many (50+)
        if (pendingJobsCount > 50) {
          logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CLEANUP ${fancyColors.RESET} Cancelling excess jobs (${pendingJobsCount} > 50)`);
          
          // First, check for stuck processing jobs (they may indicate a problem)
          const stuckProcessingJobs = await prisma.vanity_wallet_pool.findMany({
            where: {
              status: 'processing',
              updated_at: {
                lt: new Date(Date.now() - 1000 * 60 * 30) // Older than 30 minutes
              }
            },
            orderBy: {
              created_at: 'asc'
            }
          });
          
          // If there are stuck processing jobs, cancel them first
          if (stuckProcessingJobs.length > 0) {
            logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} STUCK JOBS ${fancyColors.RESET} Found ${stuckProcessingJobs.length} stuck processing jobs older than 30 minutes`);
            
            for (const job of stuckProcessingJobs) {
              try {
                await prisma.vanity_wallet_pool.update({
                  where: { id: job.id },
                  data: {
                    status: 'cancelled',
                    updated_at: new Date(),
                    completed_at: new Date()
                  }
                });
                
                logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Cancelled stuck processing job #${job.id} for pattern ${job.pattern}${fancyColors.RESET}`);
              } catch (cancelError) {
                logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to cancel stuck job #${job.id}: ${cancelError.message}${fancyColors.RESET}`);
              }
            }
          }
          
          // Find the oldest pending and processing jobs to cancel
          const jobsToCancel = await prisma.vanity_wallet_pool.findMany({
            where: {
              status: { in: ['pending', 'processing'] }
            },
            orderBy: {
              created_at: 'asc'
            },
            take: pendingJobsCount - 10 // Leave 10 jobs in the queue
          });
          
          // Cancel these jobs
          for (const job of jobsToCancel) {
            try {
              await prisma.vanity_wallet_pool.update({
                where: { id: job.id },
                data: {
                  status: 'cancelled',
                  updated_at: new Date(),
                  completed_at: new Date()
                }
              });
              
              logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Cancelled excess job #${job.id} for pattern ${job.pattern} (status: ${job.status})${fancyColors.RESET}`);
            } catch (cancelError) {
              logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Failed to cancel job #${job.id}: ${cancelError.message}${fancyColors.RESET}`);
            }
          }
        }
        
        return; // Skip generating more addresses
      }
      
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
        
        // Also count pending/processing jobs for this pattern
        const pendingCount = await prisma.vanity_wallet_pool.count({
          where: {
            pattern,
            status: { in: ['pending', 'processing'] }
          }
        });
        
        counts[pattern] = count;
        
        // Check if we need to generate more, accounting for pending jobs
        const target = this.targetCounts[pattern] || 0;
        const effectiveCount = count + pendingCount; // Count existing + in-progress
        const needed = Math.max(0, target - effectiveCount);
        
        if (needed > 0) {
          logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Generating ${fancyColors.RESET} Need to generate ${needed} ${pattern} addresses (current: ${count}, pending: ${pendingCount}, target: ${target})`);
          
          // Generate addresses one by one (not all at once to avoid CPU spikes)
          const remainingJobSlots = MAX_PENDING_JOBS - pendingJobsCount;
          const jobsToCreate = Math.min(needed, this.maxConcurrentJobs, remainingJobSlots);
          
          // Configure generation options based on pattern preferences
          const options = {};
          
          // For DUEL and DEGEN, use default prefix search
          // You can customize specific pattern settings here
          if (pattern === 'DUEL' || pattern === 'DEGEN') {
            options.isSuffix = false;
            options.caseSensitive = true;
            options.numThreads = config.vanityWallet?.numWorkers || 4;
          }
          
          for (let i = 0; i < jobsToCreate; i++) {
            await this.generateVanityAddress(pattern, options);
          }
        } else {
          logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${serviceSpecificColors.vanityWallet.success}Target met: ${pendingCount}/${target} ${pattern} jobs in progress${fancyColors.RESET}`);
        }
      }
      
      // Log current status with clear separation between available and pending
      // Get pending counts for each pattern - using same query as above
      const duelPendingCount = await prisma.vanity_wallet_pool.count({
        where: {
          pattern: "DUEL",
          status: { in: ['pending', 'processing'] }
        }
      });
      const degenPendingCount = await prisma.vanity_wallet_pool.count({
        where: {
          pattern: "DEGEN",
          status: { in: ['pending', 'processing'] }
        }
      });
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${serviceSpecificColors.vanityWallet.info}Available addresses: DUEL: ${counts.DUEL || 0}, DEGEN: ${counts.DEGEN || 0} | Pending jobs: DUEL: ${duelPendingCount || 0}, DEGEN: ${degenPendingCount || 0}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Checking and generating addresses: ${error.message}`, {
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
   * @param {Object} options - Optional configuration overrides
   * @param {boolean} options.isSuffix - Whether to search for a suffix (default: false)
   * @param {boolean} options.caseSensitive - Whether pattern matching is case sensitive (default: true)
   * @param {number} options.numThreads - Number of threads to use (default: from config)
   * @param {number} options.cpuLimit - CPU usage limit as percentage (default: from config)
   */
  async generateVanityAddress(pattern, options = {}) {
    try {
      // Get configuration or use defaults
      const isSuffix = options.isSuffix !== undefined ? options.isSuffix : false;
      const caseSensitive = options.caseSensitive !== undefined ? options.caseSensitive : true;
      const numThreads = options.numThreads || config.vanityWallet?.numWorkers || 4;
      const cpuLimit = options.cpuLimit || config.vanityWallet?.cpuLimit || 75;
      
      // Start the generation process
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Generating ${fancyColors.RESET} Starting generation of ${pattern} address (${isSuffix ? 'suffix' : 'prefix'}, ${caseSensitive ? 'case-sensitive' : 'case-insensitive'}, ${numThreads} threads, ${cpuLimit}% CPU)`);
      
      // Calculate theoretical probability
      const charSpace = caseSensitive ? 58 : 33; // Base58 character set size
      const theoreticalAttempts = Math.pow(charSpace, pattern.length);
      const timeout = this.calculateTimeout(pattern, caseSensitive);
      
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BLUE}Estimated difficulty: 1 in ${theoreticalAttempts.toLocaleString()} chance, timeout: ${Math.round(timeout/1000)}s${fancyColors.RESET}`);
      
      // Create the request with enhanced options
      const dbRecord = await VanityApiClient.createVanityAddressRequest({
        pattern,
        isSuffix,
        caseSensitive,
        numThreads,
        cpuLimit,
        requestedBy: 'vanity_wallet_service',
        requestIp: '127.0.0.1'
      });
      
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Submitted ${fancyColors.RESET} Job #${dbRecord.id} for pattern ${pattern}`);
      
      // The VanityApiClient will handle the rest (generation, encryption, storage)
      return dbRecord;
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Generating ${pattern} address: ${error.message}`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
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
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Getting status: ${error.message}`, {
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

/**
 * Dashboard methods
 */

/**
 * Get dashboard data for the vanity wallet UI
 * @returns {Promise<Object>} Dashboard data
 */
async function getDashboardData() {
  try {
    // Fetch generator status
    const queuedJobs = await prisma.vanity_wallet_jobs.count({
      where: { status: 'queued' }
    });
    
    const activeJobs = await prisma.vanity_wallet_jobs.findMany({
      where: { status: 'processing' },
      select: {
        id: true,
        pattern: true,
        started_at: true
      }
    });
    
    const generatorStatus = {
      queuedJobs,
      activeJobs: activeJobs.map(job => ({
        id: job.id,
        pattern: job.pattern,
        runtime_ms: Date.now() - new Date(job.started_at).getTime()
      }))
    };
    
    // Fetch system health metrics
    const jobCounts = {
      total: await prisma.vanity_wallet_jobs.count(),
      active: await prisma.vanity_wallet_jobs.count({ where: { status: 'processing' } }),
      queued: await prisma.vanity_wallet_jobs.count({ where: { status: 'queued' } }),
      completed: await prisma.vanity_wallet_jobs.count({ where: { status: 'completed' } }),
      failed: await prisma.vanity_wallet_jobs.count({ where: { status: 'failed' } }),
      cancelled: await prisma.vanity_wallet_jobs.count({ where: { status: 'cancelled' } })
    };
    
    const successRate = jobCounts.total > 0 ? 
      (jobCounts.completed / jobCounts.total * 100) : 0;
    
    const completedJobs = await prisma.vanity_wallet_jobs.findMany({
      where: { status: 'completed' },
      orderBy: { completed_at: 'desc' },
      take: 1
    });
    
    const lastCompletion = completedJobs.length > 0 ? {
      id: completedJobs[0].id,
      pattern: completedJobs[0].pattern,
      completed_at: completedJobs[0].completed_at,
      duration_ms: new Date(completedJobs[0].completed_at) - new Date(completedJobs[0].started_at),
      attempts: completedJobs[0].attempts
    } : null;
    
    const oldestPendingJob = await prisma.vanity_wallet_jobs.findFirst({
      where: { status: 'queued' },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        pattern: true,
        created_at: true
      }
    });
    
    // Calculate average completion time
    const avgCompletionTimeData = await prisma.vanity_wallet_jobs.findMany({
      where: { status: 'completed' },
      select: {
        started_at: true,
        completed_at: true
      }
    });
    
    let avgCompletionTimeMs = 0;
    if (avgCompletionTimeData.length > 0) {
      const totalDuration = avgCompletionTimeData.reduce((sum, job) => {
        const duration = new Date(job.completed_at) - new Date(job.started_at);
        return sum + duration;
      }, 0);
      avgCompletionTimeMs = totalDuration / avgCompletionTimeData.length;
    }
    
    // Check generator health
    const isGeneratorRunning = await prisma.vanity_wallet_jobs.count({
      where: { status: 'processing' }
    }) > 0;
    
    const stalledJobs = await prisma.vanity_wallet_jobs.findMany({
      where: {
        status: 'processing',
        started_at: {
          lt: new Date(Date.now() - 3600000) // 1 hour ago
        }
      },
      select: {
        id: true,
        pattern: true,
        started_at: true
      }
    });
    
    const recentCompletions = await prisma.vanity_wallet_jobs.findMany({
      where: {
        status: 'completed',
        completed_at: {
          gt: new Date(Date.now() - 600000) // 10 minutes ago
        }
      },
      orderBy: { completed_at: 'desc' },
      take: 5,
      select: {
        id: true,
        pattern: true,
        completed_at: true,
        attempts: true
      }
    });
    
    const hasRecentCompletions = recentCompletions.length > 0;
    
    // Determine overall status
    let generatorHealthStatus = 'healthy';
    if (!isGeneratorRunning) {
      generatorHealthStatus = 'inactive';
    } else if (stalledJobs.length > 0) {
      generatorHealthStatus = 'stalled';
    } else if (!hasRecentCompletions && jobCounts.active === 0) {
      generatorHealthStatus = 'inactive';
    }
    
    const systemHealth = {
      jobCounts,
      successRate,
      avgCompletionTimeMs,
      avgCompletionTimeFormatted: formatMilliseconds(avgCompletionTimeMs),
      lastCompletion,
      oldestPendingJob,
      systemConfig: {
        numWorkers: 4, // Placeholder values - replace with actual config
        cpuLimit: 75,
        maxAttempts: 5000000
      },
      generatorHealth: {
        status: generatorHealthStatus,
        isHealthy: generatorHealthStatus === 'healthy',
        hasRecentCompletions,
        stalledJobs,
        recentCompletions
      }
    };
    
    // Performance metrics
    // Get completed jobs for analysis
    const completedJobsData = await prisma.vanity_wallet_jobs.findMany({
      where: { status: 'completed' },
      orderBy: { completed_at: 'desc' }
    });
    
    // Process for performance metrics
    const processedJobs = completedJobsData.map(job => {
      const durationMs = new Date(job.completed_at) - new Date(job.started_at);
      const attemptsPerSecond = durationMs > 0 ? 
        Math.round(job.attempts / (durationMs / 1000)) : 0;
      
      return {
        id: job.id,
        pattern: job.pattern,
        patternLength: job.pattern.length,
        isSuffix: job.is_suffix,
        caseSensitive: job.case_sensitive,
        attempts: job.attempts,
        durationMs,
        durationFormatted: formatMilliseconds(durationMs),
        attemptsPerSecond,
        completedAt: job.completed_at
      };
    });
    
    // Calculate overall performance stats
    const totalAttempts = processedJobs.reduce((sum, job) => sum + job.attempts, 0);
    const totalDuration = processedJobs.reduce((sum, job) => sum + job.durationMs, 0);
    const avgAttemptsPerSecond = totalDuration > 0 ? 
      Math.round(totalAttempts / (totalDuration / 1000)) : 0;
    
    // Find fastest and slowest jobs
    const sortedBySpeed = [...processedJobs].sort((a, b) => b.attemptsPerSecond - a.attemptsPerSecond);
    const fastestJob = sortedBySpeed.length > 0 ? sortedBySpeed[0] : null;
    const slowestJob = sortedBySpeed.length > 0 ? sortedBySpeed[sortedBySpeed.length - 1] : null;
    
    // Get performance by pattern length
    const byPatternLength = [];
    const patternLengths = [...new Set(processedJobs.map(job => job.patternLength))].sort();
    
    for (const length of patternLengths) {
      const jobsWithLength = processedJobs.filter(job => job.patternLength === length);
      const count = jobsWithLength.length;
      
      if (count === 0) continue;
      
      const lengthAttempts = jobsWithLength.reduce((sum, job) => sum + job.attempts, 0);
      const lengthDuration = jobsWithLength.reduce((sum, job) => sum + job.durationMs, 0);
      const avgLengthDurationMs = Math.round(lengthDuration / count);
      const lengthAttemptsPerSecond = lengthDuration > 0 ? 
        Math.round(lengthAttempts / (lengthDuration / 1000)) : 0;
      
      byPatternLength.push({
        patternLength: length,
        avgAttemptsPerSecond: lengthAttemptsPerSecond,
        avgDurationMs: avgLengthDurationMs,
        avgDurationFormatted: formatMilliseconds(avgLengthDurationMs),
        count,
        successRate: 100 // All these are completed jobs
      });
    }
    
    // Calculate performance by case sensitivity
    const caseSensitiveJobs = processedJobs.filter(job => job.caseSensitive);
    const caseInsensitiveJobs = processedJobs.filter(job => !job.caseSensitive);
    
    const caseSensitiveAttempts = caseSensitiveJobs.reduce((sum, job) => sum + job.attempts, 0);
    const caseSensitiveDuration = caseSensitiveJobs.reduce((sum, job) => sum + job.durationMs, 0);
    const avgCaseSensitive = caseSensitiveDuration > 0 ? 
      Math.round(caseSensitiveAttempts / (caseSensitiveDuration / 1000)) : 0;
    
    const caseInsensitiveAttempts = caseInsensitiveJobs.reduce((sum, job) => sum + job.attempts, 0);
    const caseInsensitiveDuration = caseInsensitiveJobs.reduce((sum, job) => sum + job.durationMs, 0);
    const avgCaseInsensitive = caseInsensitiveDuration > 0 ? 
      Math.round(caseInsensitiveAttempts / (caseInsensitiveDuration / 1000)) : 0;
    
    const performanceMetrics = {
      overall: {
        avgAttemptsPerSecond,
        totalJobsAnalyzed: processedJobs.length,
        mostRecentJob: processedJobs.length > 0 ? processedJobs[0] : null,
        fastestJob,
        slowestJob
      },
      byPatternLength,
      caseOptions: {
        avgCaseSensitive,
        avgCaseInsensitive,
        caseSensitiveCount: caseSensitiveJobs.length,
        caseInsensitiveCount: caseInsensitiveJobs.length
      },
      recentJobData: processedJobs.slice(0, 20) // Last 20 jobs for visualization
    };
    
    // Pattern statistics
    // Count pattern occurrences and collect metrics
    const patternData = {};
    
    completedJobsData.forEach(job => {
      const pattern = job.pattern;
      
      if (!patternData[pattern]) {
        patternData[pattern] = {
          count: 0,
          successful: 0,
          durations: [],
          attempts: []
        };
      }
      
      patternData[pattern].count++;
      patternData[pattern].successful++;
      
      const duration = new Date(job.completed_at) - new Date(job.started_at);
      patternData[pattern].durations.push(duration);
      patternData[pattern].attempts.push(job.attempts);
    });
    
    // Generate popular patterns data
    const popularPatterns = Object.entries(patternData)
      .map(([pattern, data]) => {
        const avgDurationMs = data.durations.length > 0 ? 
          Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length) : 0;
        const avgAttempts = data.attempts.length > 0 ? 
          Math.round(data.attempts.reduce((a, b) => a + b, 0) / data.attempts.length) : 0;
        
        return {
          pattern,
          count: data.count,
          successful: data.successful,
          successRate: (data.successful / data.count * 100).toFixed(1),
          avgDurationMs,
          avgDurationFormatted: formatMilliseconds(avgDurationMs),
          avgAttempts
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 patterns
    
    // Generate length distribution data
    const lengthDistribution = {};
    
    completedJobsData.forEach(job => {
      const length = job.pattern.length;
      
      if (!lengthDistribution[length]) {
        lengthDistribution[length] = {
          count: 0,
          successful: 0,
          durations: [],
          attempts: []
        };
      }
      
      lengthDistribution[length].count++;
      lengthDistribution[length].successful++;
      
      const duration = new Date(job.completed_at) - new Date(job.started_at);
      lengthDistribution[length].durations.push(duration);
      lengthDistribution[length].attempts.push(job.attempts);
    });
    
    const lengthStats = Object.entries(lengthDistribution)
      .map(([length, data]) => {
        const avgDurationMs = data.durations.length > 0 ? 
          Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length) : 0;
        const avgAttempts = data.attempts.length > 0 ? 
          Math.round(data.attempts.reduce((a, b) => a + b, 0) / data.attempts.length) : 0;
        
        return {
          length: parseInt(length),
          count: data.count,
          successful: data.successful,
          successRate: (data.successful / data.count * 100).toFixed(1),
          avgDurationMs,
          avgDurationFormatted: formatMilliseconds(avgDurationMs),
          avgAttempts
        };
      })
      .sort((a, b) => a.length - b.length);
    
    // Recently completed jobs
    const recentlyCompleted = processedJobs.slice(0, 20); // Last 20 completed jobs
    
    const patternStats = {
      popularPatterns,
      lengthDistribution: lengthStats,
      recentlyCompleted
    };
    
    // Other sections
    // Completion time statistics
    // Calculate probability and estimated attempts for different pattern lengths
    const theoreticalEstimates = [];
    
    // Character set sizes (a-z, A-Z, 0-9 for case-sensitive; a-z, 0-9 for case-insensitive)
    const caseSensitiveSize = 62;
    const caseInsensitiveSize = 36;
    
    // Calculate for pattern lengths 1-8
    for (let patternLength = 1; patternLength <= 8; patternLength++) {
      // Calculate probability for case-sensitive
      const caseSensitiveProbability = 1 / Math.pow(caseSensitiveSize, patternLength);
      const caseSensitiveEstimatedAttempts = Math.round(1 / caseSensitiveProbability);
      
      // Calculate probability for case-insensitive
      const caseInsensitiveProbability = 1 / Math.pow(caseInsensitiveSize, patternLength);
      const caseInsensitiveEstimatedAttempts = Math.round(1 / caseInsensitiveProbability);
      
      theoreticalEstimates.push({
        patternLength,
        caseSensitive: {
          probability: caseSensitiveProbability,
          estimatedAttempts: caseSensitiveEstimatedAttempts
        },
        caseInsensitive: {
          probability: caseInsensitiveProbability,
          estimatedAttempts: caseInsensitiveEstimatedAttempts
        }
      });
    }
    
    // Create real-world estimates based on actual performance
    const realWorldEstimates = theoreticalEstimates.map(theoretical => {
      const { patternLength } = theoretical;
      
      // Find performance data for this pattern length
      const lengthData = byPatternLength.find(item => item.patternLength === patternLength);
      
      const actualAvgAttempts = lengthData ? lengthData.avgAttemptsPerSecond : avgAttemptsPerSecond;
      const actualAvgDurationMs = lengthData ? lengthData.avgDurationMs : 0;
      
      // Calculate estimated completion time
      const estimatedCompletionTimeCaseSensitiveMs = actualAvgAttempts > 0 ? 
        Math.round(theoretical.caseSensitive.estimatedAttempts / actualAvgAttempts * 1000) : 
        Number.MAX_SAFE_INTEGER;
      
      const estimatedCompletionTimeCaseInsensitiveMs = actualAvgAttempts > 0 ? 
        Math.round(theoretical.caseInsensitive.estimatedAttempts / actualAvgAttempts * 1000) : 
        Number.MAX_SAFE_INTEGER;
      
      return {
        patternLength,
        actualAvgAttempts,
        actualAvgDurationMs,
        actualAvgDurationFormatted: formatMilliseconds(actualAvgDurationMs),
        actualAttemptsPerSecond: lengthData ? lengthData.avgAttemptsPerSecond : avgAttemptsPerSecond,
        theoreticalEstimates: theoretical,
        estimatedCompletionTimeCaseSensitiveMs,
        estimatedCompletionTimeCaseSensitiveFormatted: formatMilliseconds(estimatedCompletionTimeCaseSensitiveMs),
        estimatedCompletionTimeCaseInsensitiveMs,
        estimatedCompletionTimeCaseInsensitiveFormatted: formatMilliseconds(estimatedCompletionTimeCaseInsensitiveMs)
      };
    });
    
    const completionTimeStats = {
      theoreticalEstimates,
      realWorldEstimates,
      globalAvgAttemptsPerSecond: avgAttemptsPerSecond
    };
    
    // Time series data
    // Create raw time series data
    const rawTimeSeries = processedJobs.map(job => ({
      timestamp: new Date(job.completedAt).getTime(),
      date: job.completedAt,
      jobId: job.id,
      pattern: job.pattern,
      patternLength: job.patternLength,
      attemptsPerSecond: job.attemptsPerSecond,
      durationMs: job.durationMs
    }));
    
    // Create daily time series
    // Group by date (YYYY-MM-DD)
    const dailyData = {};
    
    completedJobsData.forEach(job => {
      const date = new Date(job.completed_at).toISOString().split('T')[0];
      
      if (!dailyData[date]) {
        dailyData[date] = {
          jobs: [],
          totalAttempts: 0,
          totalDurationMs: 0
        };
      }
      
      const durationMs = new Date(job.completed_at) - new Date(job.started_at);
      
      dailyData[date].jobs.push({
        id: job.id,
        pattern: job.pattern,
        patternLength: job.pattern.length,
        attempts: job.attempts,
        durationMs
      });
      
      dailyData[date].totalAttempts += job.attempts;
      dailyData[date].totalDurationMs += durationMs;
    });
    
    // Convert to array and calculate averages
    const dailyTimeSeries = Object.entries(dailyData)
      .map(([date, data]) => {
        const avgAttemptsPerSecond = data.totalDurationMs > 0 ? 
          Math.round(data.totalAttempts / (data.totalDurationMs / 1000)) : 0;
        
        return {
          date,
          totalJobs: data.jobs.length,
          totalAttempts: data.totalAttempts,
          totalDurationMs: data.totalDurationMs,
          avgAttemptsPerSecond,
          jobs: data.jobs
        };
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate 7-day moving average
    const movingAverage = [];
    
    if (dailyTimeSeries.length >= 7) {
      for (let i = 6; i < dailyTimeSeries.length; i++) {
        const window = dailyTimeSeries.slice(i - 6, i + 1);
        const totalAttempts = window.reduce((sum, day) => sum + day.totalAttempts, 0);
        const totalDurationMs = window.reduce((sum, day) => sum + day.totalDurationMs, 0);
        const avgAttemptsPerSecond = totalDurationMs > 0 ? 
          Math.round(totalAttempts / (totalDurationMs / 1000)) : 0;
        
        movingAverage.push({
          date: dailyTimeSeries[i].date,
          avgAttemptsPerSecond
        });
      }
    }
    
    // Group by pattern length for trends
    const patternLengthData = {};
    
    completedJobsData.forEach(job => {
      const length = job.pattern.length;
      
      if (!patternLengthData[length]) {
        patternLengthData[length] = [];
      }
      
      const durationMs = new Date(job.completed_at) - new Date(job.started_at);
      const attemptsPerSecond = durationMs > 0 ? 
        Math.round(job.attempts / (durationMs / 1000)) : 0;
      
      patternLengthData[length].push({
        date: job.completed_at,
        attemptsPerSecond,
        durationMs,
        attempts: job.attempts
      });
    });
    
    // Calculate trends for each pattern length
    const patternLengthTrends = {};
    
    Object.entries(patternLengthData).forEach(([length, data]) => {
      if (data.length < 2) return; // Skip if not enough data
      
      // Sort by date
      data.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // Group into time periods (e.g., months)
      const periods = {};
      
      data.forEach(point => {
        const date = new Date(point.date);
        const year = date.getFullYear();
        const month = date.getMonth();
        const periodKey = `${year}-${month}`;
        
        if (!periods[periodKey]) {
          periods[periodKey] = {
            startDate: new Date(year, month, 1),
            endDate: new Date(year, month + 1, 0),
            dataPoints: [],
            totalAttempts: 0,
            totalDurationMs: 0
          };
        }
        
        periods[periodKey].dataPoints.push(point);
        periods[periodKey].totalAttempts += point.attempts;
        periods[periodKey].totalDurationMs += point.durationMs;
      });
      
      // Calculate averages for each period
      patternLengthTrends[length] = Object.values(periods).map(period => {
        const avgAttemptsPerSecond = period.totalDurationMs > 0 ? 
          Math.round(period.totalAttempts / (period.totalDurationMs / 1000)) : 0;
        
        return {
          startDate: period.startDate,
          endDate: period.endDate,
          avgAttemptsPerSecond,
          dataPoints: period.dataPoints
        };
      });
    });
    
    const timeSeriesData = {
      rawTimeSeries,
      dailyTimeSeries,
      movingAverage,
      patternLengthTrends
    };
    
    // System resource utilization
    // Import OS module for system information
    const os = require('os');
    
    // CPU information
    const cpus = os.cpus();
    const cpu = {
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      speed: cpus[0]?.speed || 0,
      loadAvg: os.loadavg()
    };
    
    // Memory information
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const memory = {
      totalMemory,
      freeMemory,
      usedMemory: totalMemory - freeMemory,
      usedPercentage: Math.round((totalMemory - freeMemory) / totalMemory * 100)
    };
    
    // Disk information
    let disk = {
      filesystem: 'Unknown',
      total: 'Unknown',
      used: 'Unknown',
      available: 'Unknown',
      usedPercentage: 'Unknown',
      mountPoint: '/'
    };
    
    try {
      // Try to get disk information using exec
      const { execSync } = require('child_process');
      const dfOutput = execSync('df -h /').toString();
      const lines = dfOutput.split('\n');
      
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        
        if (parts.length >= 6) {
          disk = {
            filesystem: parts[0],
            total: parts[1],
            used: parts[2],
            available: parts[3],
            usedPercentage: parts[4],
            mountPoint: parts[5]
          };
        }
      }
    } catch (diskError) {
      logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Unable to get disk information: ${diskError.message}${fancyColors.RESET}`);
    }
    
    // Process information
    let processes = {
      nodeProcesses: 0,
      solanaKeygenProcesses: 0
    };
    
    try {
      // Try to get process information using exec
      const { execSync } = require('child_process');
      const psOutput = execSync('ps -ef | grep -v grep | grep -c "node\\|nodejs"').toString();
      const solanaOutput = execSync('ps -ef | grep -v grep | grep -c "solana-keygen"').toString();
      
      processes = {
        nodeProcesses: parseInt(psOutput.trim(), 10) || 0,
        solanaKeygenProcesses: parseInt(solanaOutput.trim(), 10) || 0
      };
    } catch (procError) {
      logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Unable to get process information: ${procError.message}${fancyColors.RESET}`);
    }
    
    // Uptime information
    const uptime = {
      uptime: formatUptime(os.uptime())
    };
    
    const systemResources = {
      cpu,
      memory,
      disk,
      processes,
      uptime,
      timestamp: new Date()
    };
    
    // Return the complete dashboard data
    return {
      generatorStatus,
      systemHealth,
      performanceMetrics,
      patternStats,
      completionTimeStats,
      timeSeriesData,
      systemResources
    };
  } catch (error) {
    logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error fetching dashboard data: ${error.message}${fancyColors.RESET}`, {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Format milliseconds into a human-readable string
 * @param {number} ms - Milliseconds to format
 * @returns {string} Formatted time string
 */
function formatMilliseconds(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Format uptime in seconds to a human-readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor(((seconds % 86400) % 3600) / 60);
  const secs = Math.floor(((seconds % 86400) % 3600) % 60);
  
  const parts = [];
  
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// Create a singleton instance
const vanityWalletService = new VanityWalletService();

// Export the actual service instance directly
export { getDashboardData };
export default vanityWalletService;