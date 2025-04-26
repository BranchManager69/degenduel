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
      DUEL: 5,  // Maintain 5 available DUEL addresses
      DEGEN: 3  // Maintain 3 available DEGEN addresses
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
   * Initialize the service
   */
  async init() {
    try {
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Initializing ${fancyColors.RESET} Vanity Wallet Service`);
      
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
      
      // Call BaseService initialize method
      await this.initialize();
      
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
   * Reset any jobs stuck in 'processing' state
   */
  async resetStuckJobs() {
    try {
      // Find jobs that have been in 'processing' state for too long
      const stuckJobs = await prisma.vanity_wallet_pool.findMany({
        where: {
          status: 'processing',
          updated_at: {
            // Stuck jobs are those in processing state for more than 30 minutes
            lt: new Date(Date.now() - 30 * 60 * 1000)
          }
        }
      });
      
      if (stuckJobs.length > 0) {
        logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} STUCK JOBS ${fancyColors.RESET} Found ${stuckJobs.length} stuck jobs in 'processing' state for >30 minutes`);
        
        // Reset stuck jobs to 'pending' state
        for (const job of stuckJobs) {
          logApi.warn(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.YELLOW}Resetting stuck job ${job.id}${fancyColors.RESET} (pattern: ${job.pattern}, stuck since ${job.updated_at})`);
          
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
      
      return stuckJobs.length;
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.RED}Error resetting stuck jobs:${fancyColors.RESET} ${error.message}`);
      return 0;
    }
  }
  
  /**
   * Called when the service stops
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
          
          for (let i = 0; i < jobsToCreate; i++) {
            await this.generateVanityAddress(pattern);
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
   */
  async generateVanityAddress(pattern) {
    try {
      // Start the generation process
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Generating ${fancyColors.RESET} Starting generation of ${pattern} address`);
      
      // Create the request, which will automatically be processed by the generator
      // Since we're now using the same generator instance, we don't need to submit it separately
      const dbRecord = await VanityApiClient.createVanityAddressRequest({
        pattern,
        isSuffix: false,
        caseSensitive: true,
        requestedBy: 'vanity_wallet_service',
        requestIp: '127.0.0.1'
      });
      
      logApi.info(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_BLUE}${fancyColors.WHITE} Submitted ${fancyColors.RESET} Job #${dbRecord.id} for pattern ${pattern}`);
      
      // The VanityApiClient will handle the rest (generation, encryption, storage)
    } catch (error) {
      logApi.error(`${serviceSpecificColors.vanityWallet.tag}[VanityWalletService]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} Error ${fancyColors.RESET} Generating ${pattern} address: ${error.message}`, {
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

export default VanityWalletService;