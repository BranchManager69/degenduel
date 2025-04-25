// services/contestSchedulerService.js

/*
 * Contest Scheduler Service
 * 
 * This service is responsible for automatically creating new contests at scheduled intervals.
 * It ensures that there are always contests available for users to join.
 * 
 * The service is designed to work even during maintenance mode, using internal service authentication.
 * 
 * CONFIGURATION: Settings are stored in /config/contest-scheduler-config.js
 * Edit that file to adjust contest schedules, fees, durations, etc.
 */

// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { createContestWallet } from '../utils/solana-suite/solana-wallet.js';
import { Decimal } from '@prisma/client/runtime/library';
// Service authentication for maintenance bypass
import { generateServiceAuthHeader } from '../config/service-auth.js';

// Config
import { config } from '../config/config.js';
// Yet more Contest Scheduler Config
import SCHEDULER_CONFIG from '../config/contest-scheduler-config.js';
// Full contest scheduler service configuration
const CONTEST_SCHEDULER_CONFIG = {
    // Add service name to the imported config
    name: SERVICE_NAMES.CONTEST_SCHEDULER,
    // Include all settings from central configuration file
    ...SCHEDULER_CONFIG
};

// Contest Scheduler Service - Creates contests on a scheduled basis
/**
 * Contest Scheduler Service
 * @extends {BaseService}
 * 
 * This service is responsible for automatically creating new contests at scheduled intervals.
 * It ensures that there are always contests available for users to join.
 * 
 * The service is designed to work even during maintenance mode, using internal service authentication.
 * 
 * CONFIGURATION: Settings are stored in /config/contest-scheduler-config.js
 * Edit that file to adjust contest schedules, fees, durations, etc.
 */
class ContestSchedulerService extends BaseService {
    constructor() {
        super(CONTEST_SCHEDULER_CONFIG);
        
        // Service-specific state
        this.schedulerStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            contests: {
                created: 0, 
                scheduled: 0,
                failed: 0,
                createdDuringMaintenance: 0
            },
            performance: {
                lastOperationTimeMs: 0,
                averageOperationTimeMs: 0,
                lastScheduleCheckMs: 0,
                lastContestCreationMs: 0
            },
            maintenance: {
                lastOperationDuringMaintenance: false,
                operationsDuringMaintenance: 0,
                lastMaintenanceCheckTime: null
            },
            lastCreatedContests: [] // Array of recently created contests
        };
    }

    /**
     * Initialize the service
     */
    async initialize() {
        try {
            // Check if contest scheduler is disabled via service profile
            if (!config.services.contest_scheduler) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Contest Scheduler Service is disabled in the '${config.services.active_profile}' service profile`);
                return false;
            }
            
            // Call parent initialize first
            await super.initialize();
            
            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify({
                ...this.stats,
                schedulerStats: this.schedulerStats
            }));

            // Mark the service as started
            await serviceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            // Log the detailed initialization
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_MAGENTA} Starting Contest Scheduler Service... ${fancyColors.RESET}`);
            
            // Log detailed schedule information
            const schedules = this.config.contests.schedules.filter(s => s.enabled !== false);
            
            // Create a pretty formatted schedule summary
            const scheduleSummary = schedules.map(s => {
                const template = this.config.contests[s.template] || this.config.contests.defaultTemplate;
                
                // Format days nicely
                const days = s.days ? s.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(',') : 'All days';
                
                // Format hours - handling array of hours for tri-hourly
                let hourText;
                if (Array.isArray(s.hour)) {
                    hourText = s.hour.map(h => `${h}:${String(s.minute || 0).padStart(2, '0')}`).join(', ');
                } else {
                    hourText = `${s.hour || template.hour || 12}:${String(s.minute || template.minute || 0).padStart(2, '0')}`;
                }
                
                // Get duration and fee info
                const duration = s.durationHours || template.duration_hours || 1;
                const fee = s.entryFeeOverride || template.entry_fee;
                
                return `${fancyColors.GREEN}${s.name}${fancyColors.RESET}: ${fancyColors.YELLOW}${days}${fancyColors.RESET} at ${fancyColors.CYAN}${hourText}${fancyColors.RESET} | Duration: ${fancyColors.MAGENTA}${duration}h${fancyColors.RESET} | Fee: ${fancyColors.BLUE}${fee} SOL${fancyColors.RESET}`;
            }).join('\n\t');
            
            // Log startup banner
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} 🏆 CONTEST SCHEDULER INITIALIZED 🏆 ${fancyColors.RESET}`);
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_GREEN} Loaded ${schedules.length} active contest schedules:${fancyColors.RESET}\n\t${scheduleSummary}`);
            
            // Show maintenance mode bypass capabilities
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Supports operation during maintenance mode${fancyColors.RESET}`);
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest check interval: ${fancyColors.CYAN}${this.config.checkIntervalMs / (60 * 1000)} minutes${fancyColors.RESET}`);
            
            // Log the completion message
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_MAGENTA} ✅ ${fancyColors.BG_LIGHT_GREEN} Contest Scheduler Service initialized ${fancyColors.RESET}`);
            return true;
        } catch (error) {
            logApi.error('Contest Scheduler Service initialization error:', error);
            await this.handleError(error);
            throw error;
        }
    }

    /**
     * Create a new contest based on template
     */
    async createScheduledContest(schedule) {
        const startTime = Date.now();
        try {
            // Get template configuration
            const template = this.config.contests[schedule.template] || this.config.contests.defaultTemplate;
            if (!template) {
                throw new Error(`Template "${schedule.template}" not found in configuration`);
            }

            // Calculate contest times
            const now = new Date();
            const startTime = new Date();
            
            // Set start time to the next scheduled time
            if (Array.isArray(schedule.hour)) {
                // For schedules with multiple hours (like tri-hourly)
                const currentHour = now.getHours();
                // Find the next hour that is greater than current hour
                const nextHour = schedule.hour.find(h => h > currentHour);
                // If found, use it, otherwise use the first hour (for tomorrow)
                const hourToUse = nextHour !== undefined ? nextHour : schedule.hour[0];
                startTime.setHours(hourToUse);
            } else {
                // For single-hour schedules
                startTime.setHours(schedule.hour || template.hour || 12);
            }
            startTime.setMinutes(schedule.minute || template.minute || 0);
            startTime.setSeconds(0);
            startTime.setMilliseconds(0);
            
            // If the scheduled time has already passed today, find the next occurrence
            // For regular schedules (single hour), just find the next occurrence
            if (startTime <= now) {
                // For multi-hour schedules (like the tri-hourly schedule) find the next upcoming slot
                if (Array.isArray(schedule.hour)) {
                    // Get current hour
                    const currentHour = now.getHours();
                    
                    // Find the next hour in the array that is greater than the current hour
                    const nextHour = schedule.hour.find(h => h > currentHour);
                    
                    if (nextHour !== undefined) {
                        // We found a next slot today
                        startTime.setHours(nextHour);
                        startTime.setMinutes(schedule.minute || 0);
                        startTime.setSeconds(0);
                        startTime.setMilliseconds(0);
                    } else {
                        // No more slots today, move to first slot tomorrow
                        startTime.setDate(startTime.getDate() + 1);
                        startTime.setHours(schedule.hour[0]);
                        startTime.setMinutes(schedule.minute || 0);
                        startTime.setSeconds(0);
                        startTime.setMilliseconds(0);
                    }
                } else {
                    // Simple schedule (single hour value), move to tomorrow
                    startTime.setDate(startTime.getDate() + 1);
                }
            }
            
            // Check if this day of the week is included in the schedule
            const dayOfWeek = startTime.getDay(); // 0 = Sunday, 6 = Saturday
            if (schedule.days && !schedule.days.includes(dayOfWeek)) {
                // This day is not in the schedule, find the next valid day
                let daysToAdd = 1;
                let nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
                
                while (!schedule.days.includes(nextDayOfWeek) && daysToAdd < 7) {
                    daysToAdd++;
                    nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
                }
                
                startTime.setDate(startTime.getDate() + daysToAdd);
            }
            
            // Check if we're too close to the start time (within advance notice window)
            const advanceNoticeHours = schedule.advanceNoticeHours || template.advance_notice_hours || 1;
            const minimumAdvanceMs = advanceNoticeHours * 60 * 60 * 1000; 
            
            if (startTime.getTime() - now.getTime() < minimumAdvanceMs) {
                // Too close to start time, so move to the next scheduled occurrence
                startTime.setDate(startTime.getDate() + 1);
                
                // If specific days are configured, find the next valid day
                if (schedule.days) {
                    const newDayOfWeek = startTime.getDay();
                    if (!schedule.days.includes(newDayOfWeek)) {
                        let daysToAdd = 1;
                        let nextDayOfWeek = (newDayOfWeek + daysToAdd) % 7;
                        
                        while (!schedule.days.includes(nextDayOfWeek) && daysToAdd < 7) {
                            daysToAdd++;
                            nextDayOfWeek = (newDayOfWeek + daysToAdd) % 7;
                        }
                        
                        startTime.setDate(startTime.getDate() + daysToAdd);
                    }
                }
            }
            
            // Calculate end time - default to 1 hour now instead of 24
            const durationHours = schedule.durationHours || template.duration_hours || 1;
            const endTime = new Date(startTime);
            endTime.setHours(endTime.getHours() + durationHours);
            
            // Generate a unique contest code with hour to ensure uniqueness for hourly contests
            let hourStr = String(startTime.getHours()).padStart(2, '0');
            let minuteStr = String(startTime.getMinutes()).padStart(2, '0');
            const dateStr = startTime.toISOString().slice(0, 10).replace(/-/g, '');
            const contestCode = `${schedule.contestCodePrefix || template.contest_code || 'AUTO'}-${dateStr}-${hourStr}${minuteStr}`;
            
            // Build contest data
            const contestData = {
                name: schedule.nameOverride || template.name,
                contest_code: contestCode,
                description: schedule.descriptionOverride || template.description,
                entry_fee: new Decimal(schedule.entryFeeOverride || template.entry_fee),
                start_time: startTime,
                end_time: endTime,
                min_participants: schedule.minParticipantsOverride || template.min_participants,
                max_participants: schedule.maxParticipantsOverride || template.max_participants,
                allowed_buckets: schedule.allowedBucketsOverride || template.allowed_buckets,
                status: 'pending'
            };
            
            // Create contest and wallet in a transaction
            const result = await prisma.$transaction(async (prisma) => {
                // 1. Create contest first
                const contest = await prisma.contests.create({
                    data: contestData
                });

                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BG_LIGHT_GREEN} Created scheduled contest ${fancyColors.RESET}`);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Details: ${contest.name} (ID: ${contest.id}, Code: ${contest.contest_code})`);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Timeframe: ${new Date(contest.start_time).toLocaleString()} to ${new Date(contest.end_time).toLocaleString()}`);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Entry fee: ${contest.entry_fee}, Participants: ${contest.min_participants}-${contest.max_participants || 'unlimited'}`);
                
                // 2. Use contest wallet service to create wallet (this properly handles vanity wallets)
                // Import the service (already configured with proper vanity wallet handling)
                let contestWallet;
                try {
                    // Use the contest wallet service which properly sets is_vanity and vanity_type
                    // We need to import it here to avoid circular dependencies
                    const contestWalletService = (await import('../services/contestWalletService.js')).default;
                    contestWallet = await contestWalletService.createContestWallet(contest.id);
                    
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Created wallet for contest: ${contestWallet.wallet_address}`);
                    if (contestWallet.is_vanity) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Using ${contestWallet.vanity_type} vanity wallet!${fancyColors.RESET}`);
                    }
                } catch (walletError) {
                    // Fall back to direct wallet creation if service fails
                    logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Wallet service failed, falling back to direct wallet creation${fancyColors.RESET}`, walletError);
                    
                    // Direct wallet creation using the utility function
                    const { publicKey, encryptedPrivateKey } = await createContestWallet();
                    
                    // Create wallet record
                    contestWallet = await prisma.contest_wallets.create({
                        data: {
                            contest_id: contest.id,
                            wallet_address: publicKey,
                            private_key: encryptedPrivateKey,
                            balance: '0'
                        }
                    });
                }
                
                // Try to generate an image for the contest after wallet is created
                try {
                    // Import the contest image service
                    const contestImageService = (await import('../services/contestImageService.js')).default;
                    
                    // First set a placeholder image while we generate the real one
                    // Get a random placeholder from our collection
                    const fs = await import('fs/promises');
                    const path = await import('path');
                    
                    try {
                        // Get all placeholder files
                        const placeholdersDir = path.join(process.cwd(), 'public', 'images', 'contests', 'placeholders');
                        const files = await fs.readdir(placeholdersDir);
                        const pngFiles = files.filter(file => file.endsWith('.png'));
                        
                        if (pngFiles.length > 0) {
                            // Pick a random placeholder
                            const randomFile = pngFiles[Math.floor(Math.random() * pngFiles.length)];
                            const placeholderUrl = `/images/contests/placeholders/${randomFile}`;
                            
                            // Set the placeholder image URL in the database
                            await prisma.contests.update({
                                where: { id: contest.id },
                                data: { image_url: placeholderUrl }
                            });
                            
                            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Set temporary placeholder image for contest: ${placeholderUrl}`);
                        }
                    } catch (placeholderError) {
                        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to set placeholder image: ${placeholderError.message}`);
                    }
                    
                    // Now start the real image generation in a non-blocking way
                    contestImageService.getOrGenerateContestImage(contest)
                        .then(imageUrl => {
                            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Generated image for contest ${contest.id}: ${imageUrl}${fancyColors.RESET}`);
                        })
                        .catch(imageError => {
                            logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to generate contest image: ${imageError.message}${fancyColors.RESET}`);
                        });
                } catch (imageServiceError) {
                    logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Error initializing image service: ${imageServiceError.message}${fancyColors.RESET}`);
                }
                
                return { contest, wallet: contestWallet };
            });
            
            // Update stats
            this.schedulerStats.contests.created++;
            this.schedulerStats.contests.scheduled++;
            
            // Update performance metrics
            this.schedulerStats.performance.lastContestCreationMs = Date.now() - startTime;
            
            // Add to recently created contests list
            this.schedulerStats.lastCreatedContests.push({
                id: result.contest.id,
                name: result.contest.name,
                contest_code: result.contest.contest_code,
                start_time: result.contest.start_time,
                end_time: result.contest.end_time,
                created_at: new Date(),
                creation_time_ms: Date.now() - startTime
            });

            // Send Discord notification for contest creation
            try {
                const serviceEvents = (await import('../utils/service-suite/service-events.js')).default;
                const { SERVICE_EVENTS } = await import('../utils/service-suite/service-events.js');
                
                // Emit contest created event for Discord notification
                serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, {
                    id: result.contest.id,
                    name: result.contest.name,
                    contest_code: result.contest.contest_code,
                    start_time: result.contest.start_time,
                    end_time: result.contest.end_time,
                    prize_pool: result.contest.prize_pool,
                    entry_fee: result.contest.entry_fee,
                    status: result.contest.status,
                    wallet_address: result.wallet?.wallet_address || 'Unknown'
                });
                
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} 📢 Discord notification sent for new contest`);
            } catch (discordError) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to send Discord notification: ${discordError.message}${fancyColors.RESET}`);
            }
            
            // Keep only the last 10 created contests
            if (this.schedulerStats.lastCreatedContests.length > 10) {
                this.schedulerStats.lastCreatedContests.shift();
            }
            
            return result;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error creating scheduled contest:`, error);
            this.schedulerStats.contests.failed++;
            throw error;
        }
    }

    /**
     * Check if a contest with similar schedule already exists
     */
    async contestAlreadyExists(schedule) {
        const startTime = Date.now();
        try {
            // Get template
            const template = this.config.contests[schedule.template] || this.config.contests.defaultTemplate;
            if (!template) {
                throw new Error(`Template "${schedule.template}" not found in configuration`);
            }

            // Calculate start time window
            const now = new Date();
            const futureWindow = new Date(now);
            futureWindow.setDate(futureWindow.getDate() + 7); // Look up to a week ahead
            
            // Get all pending or active contests in the future
            const existingContests = await prisma.contests.findMany({
                where: {
                    status: { in: ['pending', 'active'] },
                    start_time: { gte: now, lt: futureWindow }
                }
            });
            
            // Check if any of the existing contests match this schedule
            const targetHour = schedule.hour || template.hour || 12;
            const targetMinute = schedule.minute || template.minute || 0;
            
            for (const contest of existingContests) {
                const contestHour = contest.start_time.getHours();
                const contestMinute = contest.start_time.getMinutes();
                
                // Check if hours and minutes match
                if (contestHour === targetHour && Math.abs(contestMinute - targetMinute) <= 5) {
                    // Check if the contest is on one of the scheduled days
                    const contestDay = contest.start_time.getDay();
                    if (!schedule.days || schedule.days.includes(contestDay)) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest already exists for schedule: ${schedule.name} (Contest ID: ${contest.id}, Code: ${contest.contest_code})`);
                        
                        // Update performance metric
                        this.schedulerStats.performance.lastScheduleCheckMs = Date.now() - startTime;
                        
                        return true;
                    }
                }
            }
            
            // Update performance metric
            this.schedulerStats.performance.lastScheduleCheckMs = Date.now() - startTime;
            
            return false;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error checking if contest exists:`, error);
            return true; // Assume contest exists on error to prevent duplicate creation
        }
    }

    /**
     * Execute the scheduled contest creation
     * This method will continue to work even during maintenance mode
     */
    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Check maintenance mode
            const isInMaintenance = await this.isInMaintenanceMode();
            
            if (isInMaintenance) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.YELLOW} System is in maintenance mode, but contest scheduler will continue to operate ${fancyColors.RESET}`);
            }
            
            // Get enabled schedules
            const enabledSchedules = this.config.contests.schedules.filter(s => s.enabled !== false);
            
            // Check each schedule
            let createdCount = 0;
            let skippedCount = 0;
            
            for (const schedule of enabledSchedules) {
                try {
                    // Check if a contest for this schedule already exists
                    const exists = await this.contestAlreadyExists(schedule);
                    
                    if (!exists) {
                        // Create contest for this schedule using internal DB transaction
                        // This works even during maintenance mode because we are using direct DB access
                        await this.createScheduledContest(schedule);
                        createdCount++;
                        
                        // If we're in maintenance mode, log with special notice and update stats
                        if (isInMaintenance) {
                            this.schedulerStats.contests.createdDuringMaintenance++;
                            this.schedulerStats.maintenance.operationsDuringMaintenance++;
                            this.schedulerStats.maintenance.lastMaintenanceCheckTime = new Date();
                            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.YELLOW} Created contest during maintenance mode: ${schedule.name}${fancyColors.RESET}`);
                        }
                    } else {
                        skippedCount++;
                    }
                } catch (scheduleError) {
                    logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error processing schedule ${schedule.name}:`, scheduleError);
                }
            }
            
            // Update performance stats
            this.schedulerStats.performance.lastOperationTimeMs = Date.now() - startTime;
            this.schedulerStats.performance.averageOperationTimeMs = 
                (this.schedulerStats.performance.averageOperationTimeMs * this.schedulerStats.operations.total + 
                (Date.now() - startTime)) / (this.schedulerStats.operations.total + 1);
            
            // Update operation stats
            this.schedulerStats.operations.total++;
            this.schedulerStats.operations.successful++;
            
            // Note maintenance mode in stats if applicable
            this.schedulerStats.maintenance.lastOperationDuringMaintenance = isInMaintenance;
            
            // Update maintenance stats
            if (isInMaintenance) {
                this.schedulerStats.maintenance.operationsDuringMaintenance++;
                this.schedulerStats.maintenance.lastMaintenanceCheckTime = new Date();
            }
            
            // Create a fancy banner for each run cycle
            const bannerStyle = isInMaintenance ? fancyColors.BG_YELLOW : fancyColors.BG_GREEN;
            const bannerText = isInMaintenance ? "CONTEST SCHEDULING DURING MAINTENANCE" : "CONTEST SCHEDULING CYCLE COMPLETED";
            const bannerTextColor = isInMaintenance ? fancyColors.BLACK : fancyColors.WHITE;
            
            // Log detailed results with fancy banner
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${bannerStyle}${bannerTextColor} 🏆 ${bannerText} 🏆 ${fancyColors.RESET}`);
            
            // Create a fancy summary box
            const summaryBoxTop = `╔═════════════════════ SCHEDULING SUMMARY ═════════════════════╗`;
            const summaryBoxBottom = `╚══════════════════════════════════════════════════════════════╝`;
            
            // Format time nicely
            const formattedTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const formattedDate = new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
            
            // Create summary lines
            const summaryLines = [
                `║ ${fancyColors.CYAN}Time${fancyColors.RESET}: ${formattedTime} ${formattedDate}${' '.repeat(30)}${fancyColors.RESET} ║`,
                `║ ${fancyColors.YELLOW}Schedules Checked${fancyColors.RESET}: ${enabledSchedules.length}${' '.repeat(40 - String(enabledSchedules.length).length)}${fancyColors.RESET} ║`,
                `║ ${fancyColors.GREEN}Contests Created${fancyColors.RESET}: ${createdCount}${' '.repeat(41 - String(createdCount).length)}${fancyColors.RESET} ║`,
                `║ ${fancyColors.BLUE}Schedules Skipped${fancyColors.RESET}: ${skippedCount}${' '.repeat(40 - String(skippedCount).length)}${fancyColors.RESET} ║`
            ];
            
            if (isInMaintenance) {
                // Add maintenance info if in maintenance mode
                summaryLines.push(`║ ${fancyColors.RED}Maintenance Mode${fancyColors.RESET}: ${fancyColors.YELLOW}ACTIVE${fancyColors.RESET}${' '.repeat(41)}${fancyColors.RESET} ║`);
            }
                
            // Log the full summary box
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${summaryBoxTop}`);
            summaryLines.forEach(line => {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${line}`);
            });
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${summaryBoxBottom}`);
            
            // Log detailed stats if contests were created
            if (createdCount > 0) {
                const recentlyCreated = this.schedulerStats.lastCreatedContests.slice(-createdCount);
                
                // Create a nice box for contest details
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ╔═════════════════════ CREATED CONTESTS ════════════════════════╗`);
                
                recentlyCreated.forEach(c => {
                    const startTime = new Date(c.start_time).toLocaleString([], {
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                    
                    const idStr = `${fancyColors.CYAN}ID: ${c.id}${fancyColors.RESET}`;
                    const codeStr = `${fancyColors.YELLOW}Code: ${c.contest_code}${fancyColors.RESET}`;
                    const timeStr = `${fancyColors.GREEN}Time: ${startTime}${fancyColors.RESET}`;
                    
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ║ ${fancyColors.BOLD}${c.name}${fancyColors.RESET}${' '.repeat(Math.max(0, 60 - c.name.length))} ║`);
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ║ ${idStr} | ${codeStr} | ${timeStr}${' '.repeat(Math.max(0, 15))} ║`);
                    
                    if (recentlyCreated.indexOf(c) < recentlyCreated.length - 1) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ║${'-'.repeat(62)}║`);
                    }
                });
                
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ╚══════════════════════════════════════════════════════════════╝`);
            }
            
            // Update ServiceManager state
            await serviceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    schedulerStats: this.schedulerStats
                }
            );
            
            return {
                created: createdCount,
                skipped: skippedCount,
                total: enabledSchedules.length,
                maintenanceMode: isInMaintenance
            };
        } catch (error) {
            // Update operation stats
            this.schedulerStats.operations.total++;
            this.schedulerStats.operations.failed++;
            
            // Log error
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error in contest scheduler service:`, error);
            await this.handleError(error);
            return false;
        }
    }

    /**
     * Stop the service
     */
    async stop() {
        try {
            await super.stop();
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest Scheduler Service stopped successfully`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error stopping Contest Scheduler Service:`, error);
            throw error;
        }
    }
    
    /**
     * Check if the system is currently in maintenance mode
     * 
     * @returns {Promise<boolean>} - True if system is in maintenance mode
     */
    async isInMaintenanceMode() {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key: "maintenance_mode" }
            });
            
            return setting?.value?.enabled === true;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error checking maintenance mode:`, error);
            return false; // Assume not in maintenance mode on error
        }
    }
    
    /**
     * Make authenticated internal API request that bypasses maintenance mode
     * Uses the service authentication system to make API requests to other services
     * even when the system is in maintenance mode
     * 
     * @param {string} url - The API URL to request (only path part, e.g., /api/contests)
     * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
     * @param {Object} [data=null] - Request body for POST/PUT requests
     * @returns {Promise<any>} - API response
     * @throws {Error} - If the request fails
     */
    async makeInternalRequest(url, method, data = null) {
        try {
            // Generate service authentication header that will bypass maintenance mode
            const authHeader = generateServiceAuthHeader();
            
            // Add API base URL if needed
            if (!url.startsWith('http')) {
                url = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3004}${url}`;
            }
            
            logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Making internal request to ${url} with service auth`);
            
            // Prepare request options
            const options = {
                method: method.toUpperCase(),
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeader
                }
            };
            
            if (data && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT')) {
                options.body = JSON.stringify(data);
            }
            
            // Make the request
            const response = await fetch(url, options);
            
            // Handle non-2xx responses
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API request failed with status ${response.status}: ${errorText}`);
            }
            
            // Parse and return JSON response
            return await response.json();
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Internal API request failed:`, error);
            throw new ServiceError(`Internal API request failed: ${error.message}`, this.name);
        }
    }
}

// Create and export singleton instance
const contestSchedulerService = new ContestSchedulerService();
export default contestSchedulerService;