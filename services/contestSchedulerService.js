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
import { Decimal } from '@prisma/client/runtime/library';
import { fancyColors } from '../utils/colors.js';
// ** Service Manager **
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
// Service authentication for maintenance bypass
import { generateServiceAuthHeader } from '../config/service-auth.js';
// Contest wallet service for creating contest wallets
import ContestWalletService from './contest-wallet/index.js';

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
                createdDuringMaintenance: 0,
                createdFromDatabaseSchedules: 0,
                createdFromConfigSchedules: 0
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
            usingDatabaseSchedules: false,
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
            
            // Check for migration of config to database
            await this.migrateConfigToDatabaseIfNeeded();
            
            // Load schedules from database
            const dbSchedules = await this.loadSchedulesFromDatabase();
            
            // Format and output the schedule information
            if (dbSchedules && dbSchedules.length > 0) {
                // Create a pretty formatted schedule summary for database schedules
                const scheduleSummary = dbSchedules.map(s => {
                    // Format days nicely
                    const days = s.days ? s.days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(',') : 'All days';
                    
                    // Format hours - handling array of hours for tri-hourly
                    let hourText;
                    if (s.allow_multiple_hours && s.multiple_hours && s.multiple_hours.length > 0) {
                        hourText = s.multiple_hours.map(h => `${h}:${String(s.minute || 0).padStart(2, '0')}`).join(', ');
                    } else {
                        hourText = `${s.hour || 12}:${String(s.minute || 0).padStart(2, '0')}`;
                    }
                    
                    // Get duration and fee info
                    const duration = s.duration_hours || 1;
                    const fee = s.entry_fee_override?.toString() || "0.1";
                    
                    return `${fancyColors.GREEN}${s.name}${fancyColors.RESET}: ${fancyColors.YELLOW}${days}${fancyColors.RESET} at ${fancyColors.CYAN}${hourText}${fancyColors.RESET} | Duration: ${fancyColors.MAGENTA}${duration}h${fancyColors.RESET} | Fee: ${fancyColors.BLUE}${fee} SOL${fancyColors.RESET}`;
                }).join('\n\t');
                
                // Log startup banner for database schedules
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} 🏆 CONTEST SCHEDULER INITIALIZED 🏆 ${fancyColors.RESET}`);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_GREEN} Loaded ${dbSchedules.length} active contest schedules from database:${fancyColors.RESET}\n\t${scheduleSummary}`);
            } else {
                // Fall back to legacy config file schedules
                const legacySchedules = this.config.contests.schedules.filter(s => s.enabled !== false);
                
                // Create a pretty formatted schedule summary for legacy config
                const legacyScheduleSummary = legacySchedules.map(s => {
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
                
                // Log startup banner for config file schedules
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_MAGENTA}${fancyColors.WHITE} 🏆 CONTEST SCHEDULER INITIALIZED 🏆 ${fancyColors.RESET}`);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.DARK_GREEN} Loaded ${legacySchedules.length} active contest schedules from config:${fancyColors.RESET}\n\t${legacyScheduleSummary}`);
                
                // Warning about database migration
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}⚠️ Using legacy config file schedules. Consider migrating to database schedules.${fancyColors.RESET}`);
            }
            
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
     * Add helper methods for DB integration
     */
    async loadSchedulesFromDatabase() {
        try {
            // Query active schedules from the database
            const dbSchedules = await prisma.contest_schedule.findMany({
                where: { enabled: true },
                include: {
                    template: true // Include the related contest template
                }
            });

            if (dbSchedules.length > 0) {
                this.schedulerStats.usingDatabaseSchedules = true;
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Loaded ${dbSchedules.length} schedules from database.`);
            }
            return dbSchedules;
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error loading schedules from database:`, error);
            return [];
        }
    }

    /**
     * Migrate config schedules to database if needed
     */
    async migrateConfigToDatabaseIfNeeded() {
        try {
            // Check if we've already migrated
            const migrationFlag = await prisma.system_settings.findUnique({
                where: { key: 'contest_scheduler_migrated' }
            });
            
            if (migrationFlag?.value?.migrated === true) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Config already migrated to database.`);
                return;
            }
            
            // First check if we have any existing contest schedules in DB
            const existingSchedules = await prisma.contest_schedule.count();
            if (existingSchedules > 0) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Found ${existingSchedules} existing database schedules, skipping migration.`);
                
                // Mark as migrated so we don't check again
                await prisma.system_settings.upsert({
                    where: { key: 'contest_scheduler_migrated' },
                    update: { value: { migrated: true } },
                    create: { 
                        key: 'contest_scheduler_migrated', 
                        value: { migrated: true } 
                    }
                });
                
                return;
            }
            
            // No existing schedules found, migrate from config
            const configSchedules = this.config.contests.schedules.filter(s => s.enabled !== false);
            if (!configSchedules || configSchedules.length === 0) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} No config schedules to migrate.`);
                return;
            }
            
            // First, create or find the default template
            let defaultTemplate = await prisma.contest_templates.findFirst({
                where: { name: 'Default Template' }
            });
            
            if (!defaultTemplate) {
                defaultTemplate = await prisma.contest_templates.create({
                    data: {
                        name: 'Default Template',
                        description: 'Default contest template with standard rules',
                        duration_minutes: 60,
                        entry_fee: new Decimal(this.config.contests.defaultTemplate.entry_fee || "0.1"),
                        max_participants: this.config.contests.defaultTemplate.max_participants || 100,
                        is_active: true
                    }
                });
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Created default contest template.`);
            }
            
            // Migrate each schedule
            for (const schedule of configSchedules) {
                const template = this.config.contests[schedule.template] || this.config.contests.defaultTemplate;
                
                // Create the database schedule
                await prisma.contest_schedule.create({
                    data: {
                        name: schedule.name,
                        template_id: defaultTemplate.id,
                        hour: Array.isArray(schedule.hour) ? schedule.hour[0] : schedule.hour,
                        minute: schedule.minute || 0,
                        days: schedule.days || [0, 1, 2, 3, 4, 5, 6], // Default to all days
                        entry_fee_override: new Decimal(schedule.entryFeeOverride || template.entry_fee || "0.1"),
                        name_override: schedule.nameOverride || template.name,
                        description_override: schedule.descriptionOverride || template.description,
                        duration_hours: schedule.durationHours || template.duration_hours || 1,
                        enabled: schedule.enabled !== false,
                        advance_notice_hours: schedule.advanceNoticeHours || template.advance_notice_hours || 1,
                        min_participants_override: schedule.minParticipantsOverride || template.min_participants,
                        max_participants_override: schedule.maxParticipantsOverride || template.max_participants,
                        allow_multiple_hours: Array.isArray(schedule.hour),
                        multiple_hours: Array.isArray(schedule.hour) ? schedule.hour : []
                    }
                });
            }
            
            // Mark as migrated
            await prisma.system_settings.upsert({
                where: { key: 'contest_scheduler_migrated' },
                update: { value: { migrated: true } },
                create: {
                    key: 'contest_scheduler_migrated',
                    value: { migrated: true }
                }
            });
            
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Successfully migrated ${configSchedules.length} schedules to database.${fancyColors.RESET}`);
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error migrating config to database:`, error);
        }
    }

    /**
     * Create a new contest based on template
     * @param {Object} schedule - The schedule configuration, can be from database or config
     * @returns {Promise<Object>} - The created contest and wallet
     */
    async createScheduledContest(schedule) {
        const functionStartTime = Date.now();
        try {
            let templateData;
            let isDbSchedule = false;
            
            // Determine if this is a database schedule or a config schedule
            if (schedule.template_id && schedule.template) {
                // This is a database schedule
                isDbSchedule = true;
                templateData = {
                    name: schedule.template.name,
                    description: schedule.template.description,
                    duration_hours: schedule.template.duration_minutes ? schedule.template.duration_minutes / 60 : 1,
                    entry_fee: schedule.template.entry_fee || "0.1",
                    min_participants: 2,
                    max_participants: schedule.template.max_participants || 100,
                    allowed_buckets: [],
                    advance_notice_hours: schedule.advance_notice_hours || 1,
                    contest_code: "DUEL"
                };
                
                logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using database schedule: ${schedule.name} (Template ID: ${schedule.template_id})`);
            } else {
                // This is a config schedule
                templateData = this.config.contests[schedule.template] || this.config.contests.defaultTemplate;
                
                if (!templateData) {
                    throw new Error(`Template "${schedule.template}" not found in configuration`);
                }
                
                logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using config schedule: ${schedule.name} (Template: ${schedule.template})`);
            }

            // Calculate contest times
            const now = new Date();
            const contestStartTime = new Date();
            
            // Set start time to the next scheduled time
            if (
                (isDbSchedule && schedule.allow_multiple_hours && schedule.multiple_hours && schedule.multiple_hours.length > 0) ||
                (!isDbSchedule && Array.isArray(schedule.hour))
            ) {
                // For schedules with multiple hours (like tri-hourly)
                const currentHour = now.getHours();
                const hourArray = isDbSchedule ? schedule.multiple_hours : schedule.hour;
                
                // Find the next hour that is greater than current hour
                const nextHour = hourArray.find(h => h > currentHour);
                
                // If found, use it, otherwise use the first hour (for tomorrow)
                const hourToUse = nextHour !== undefined ? nextHour : hourArray[0];
                contestStartTime.setHours(hourToUse);
            } else {
                // For single-hour schedules
                const hour = isDbSchedule ? 
                    (schedule.hour || 12) : 
                    (schedule.hour || templateData.hour || 12);
                    
                contestStartTime.setHours(hour);
            }
            
            const minute = isDbSchedule ? 
                (schedule.minute || 0) : 
                (schedule.minute || templateData.minute || 0);
                
            contestStartTime.setMinutes(minute);
            contestStartTime.setSeconds(0);
            contestStartTime.setMilliseconds(0);
            
            // If the scheduled time has already passed today, find the next occurrence
            if (contestStartTime <= now) {
                // For multi-hour schedules find the next upcoming slot
                if (
                    (isDbSchedule && schedule.allow_multiple_hours && schedule.multiple_hours && schedule.multiple_hours.length > 0) ||
                    (!isDbSchedule && Array.isArray(schedule.hour))
                ) {
                    const currentHour = now.getHours();
                    const hourArray = isDbSchedule ? schedule.multiple_hours : schedule.hour;
                    
                    // Find the next hour that is greater than current hour
                    const nextHour = hourArray.find(h => h > currentHour);
                    
                    if (nextHour !== undefined) {
                        // We found a next slot today
                        contestStartTime.setHours(nextHour);
                        contestStartTime.setMinutes(minute);
                        contestStartTime.setSeconds(0);
                        contestStartTime.setMilliseconds(0);
                    } else {
                        // No more slots today, move to first slot tomorrow
                        contestStartTime.setDate(contestStartTime.getDate() + 1);
                        contestStartTime.setHours(hourArray[0]);
                        contestStartTime.setMinutes(minute);
                        contestStartTime.setSeconds(0);
                        contestStartTime.setMilliseconds(0);
                    }
                } else {
                    // Simple schedule (single hour value), move to tomorrow
                    contestStartTime.setDate(contestStartTime.getDate() + 1);
                }
            }
            
            // Check if this day of the week is included in the schedule
            const dayOfWeek = contestStartTime.getDay(); // 0 = Sunday, 6 = Saturday
            const scheduleDays = schedule.days || [0, 1, 2, 3, 4, 5, 6]; // Default to all days
            
            if (scheduleDays && !scheduleDays.includes(dayOfWeek)) {
                // This day is not in the schedule, find the next valid day
                let daysToAdd = 1;
                let nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
                
                while (!scheduleDays.includes(nextDayOfWeek) && daysToAdd < 7) {
                    daysToAdd++;
                    nextDayOfWeek = (dayOfWeek + daysToAdd) % 7;
                }
                
                contestStartTime.setDate(contestStartTime.getDate() + daysToAdd);
            }
            
            // Check if we're too close to the start time (within advance notice window)
            const advanceNoticeHours = 
                (isDbSchedule ? schedule.advance_notice_hours : schedule.advanceNoticeHours) || 
                templateData.advance_notice_hours || 
                1;
                
            const minimumAdvanceMs = advanceNoticeHours * 60 * 60 * 1000; 
            
            if (contestStartTime.getTime() - now.getTime() < minimumAdvanceMs) {
                // Too close to start time, so move to the next scheduled occurrence
                contestStartTime.setDate(contestStartTime.getDate() + 1);
                
                // If specific days are configured, find the next valid day
                if (scheduleDays && scheduleDays.length < 7) {
                    const newDayOfWeek = contestStartTime.getDay();
                    if (!scheduleDays.includes(newDayOfWeek)) {
                        let daysToAdd = 1;
                        let nextDayOfWeek = (newDayOfWeek + daysToAdd) % 7;
                        
                        while (!scheduleDays.includes(nextDayOfWeek) && daysToAdd < 7) {
                            daysToAdd++;
                            nextDayOfWeek = (newDayOfWeek + daysToAdd) % 7;
                        }
                        
                        contestStartTime.setDate(contestStartTime.getDate() + daysToAdd);
                    }
                }
            }
            
            // Calculate end time
            const durationHours = 
                isDbSchedule ? 
                    (schedule.duration_hours || 1) : 
                    (schedule.durationHours || templateData.duration_hours || 1);
                    
            const endTime = new Date(contestStartTime);
            endTime.setHours(endTime.getHours() + durationHours);
            
            // Generate a unique contest code with date and time
            let hourStr = String(contestStartTime.getHours()).padStart(2, '0');
            let minuteStr = String(contestStartTime.getMinutes()).padStart(2, '0');
            const dateStr = contestStartTime.toISOString().slice(0, 10).replace(/-/g, '');
            
            // The contest code prefix can come from different places depending on the schedule type
            const contestCodePrefix = 
                isDbSchedule ? 
                    "DUEL" : // For DB schedules, use a default
                    (schedule.contestCodePrefix || templateData.contest_code || 'AUTO');
                    
            const contestCode = `${contestCodePrefix}-${dateStr}-${hourStr}${minuteStr}`;
            
            // Build contest data with appropriate values based on schedule type
            const contestData = {
                name: isDbSchedule ? 
                    (schedule.name_override || templateData.name) : 
                    (schedule.nameOverride || templateData.name),
                    
                contest_code: contestCode,
                
                description: isDbSchedule ? 
                    (schedule.description_override || templateData.description) : 
                    (schedule.descriptionOverride || templateData.description),
                    
                entry_fee: new Decimal(
                    isDbSchedule ? 
                        (schedule.entry_fee_override || templateData.entry_fee) : 
                        (schedule.entryFeeOverride || templateData.entry_fee)
                ),
                
                start_time: contestStartTime,
                end_time: endTime,
                
                min_participants: isDbSchedule ? 
                    (schedule.min_participants_override || templateData.min_participants || 2) : 
                    (schedule.minParticipantsOverride || templateData.min_participants || 2),
                    
                max_participants: isDbSchedule ? 
                    (schedule.max_participants_override || templateData.max_participants) : 
                    (schedule.maxParticipantsOverride || templateData.max_participants),
                    
                allowed_buckets: isDbSchedule ? 
                    [] : // For DB schedules, we don't have this yet
                    (schedule.allowedBucketsOverride || templateData.allowed_buckets || []),
                    
                status: 'pending',
                
                // If this is a database schedule, link it to the schedule
                schedule_id: isDbSchedule ? schedule.id : null
            };
            
            // Create contest first
            const contest = await prisma.contests.create({ data: contestData });

            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.BG_LIGHT_GREEN} Created scheduled contest ${fancyColors.RESET}`);
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Details: ${contest.name} (ID: ${contest.id}, Code: ${contest.contest_code})`);
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Timeframe: ${new Date(contest.start_time).toLocaleString()} to ${new Date(contest.end_time).toLocaleString()}`);
            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Entry fee: ${contest.entry_fee}, Participants: ${contest.min_participants}-${contest.max_participants || 'unlimited'}`);
            
            if (isDbSchedule) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Created from database schedule ID: ${schedule.id}`);
            } else {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Created from config schedule: ${schedule.name}`);
            }
            
            // Create wallet after contest is committed to database
            let contestWalletRecord;
            try {
                contestWalletRecord = await ContestWalletService.createContestWallet(contest.id);
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Created wallet for contest via ContestWalletService: ${contestWalletRecord.wallet_address}`);
                if (contestWalletRecord.is_vanity) {
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Using ${contestWalletRecord.vanity_type} vanity wallet!${fancyColors.RESET}`);
                }
            } catch (walletServiceError) {
                logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_RED}${fancyColors.WHITE} CRITICAL ERROR ${fancyColors.RESET} ContestWalletService failed to create wallet for scheduled contest #${contest.id}: ${walletServiceError.message}`, {
                    error: walletServiceError.message,
                    stack: walletServiceError.stack,
                    contestId: contest.id,
                    contestCode: contest.contest_code
                });
                
                // If wallet creation fails, delete the contest to maintain consistency
                try {
                    await prisma.contests.delete({ where: { id: contest.id } });
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Cleaned up contest ${contest.id} after wallet creation failure`);
                } catch (deleteError) {
                    logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to clean up contest ${contest.id}: ${deleteError.message}`);
                }
                
                this.schedulerStats.contests.failed++;
                throw new Error(`Wallet creation failed for contest ${contest.id} via ContestWalletService: ${walletServiceError.message}`);
            }
            
            // Generate contest image
                try {
                    // Import the contest image service
                    const contestImageService = (await import('../services/contestImageService.js')).default;
                    
                    // First set a placeholder image while we generate the real one
                    // Get a random placeholder from our collection
                    const fs = await import('fs/promises');
                    const path = await import('path');
                    
                    try {
                        // Instead of using random placeholders, use contest_code directly for the image URL
                        // This ensures frontend and all systems can reliably construct the URL without querying DB
                        if (contest.contest_code) {
                            // Generate a predictable image URL based on contest code
                            const standardImageUrl = `/images/contests/${contest.contest_code}.png`;
                            
                            // Set the standardized image URL in the database
                            await prisma.contests.update({
                                where: { id: contest.id },
                                data: { image_url: standardImageUrl }
                            });
                            
                            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Set standardized image URL for contest: ${standardImageUrl}`);
                            
                            // Copy a default placeholder to this location immediately so there's something to display
                            try {
                                const placeholdersDir = path.join(process.cwd(), 'public', 'images', 'contests', 'placeholders');
                                const defaultPlaceholder = path.join(placeholdersDir, 'contest_default.png');
                                const targetPath = path.join(process.cwd(), 'public', 'images', 'contests', `${contest.contest_code}.png`);
                                
                                // Create directory if it doesn't exist
                                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                                
                                // Check if default placeholder exists, otherwise use any placeholder
                                let sourceFile = defaultPlaceholder;
                                try {
                                    await fs.access(defaultPlaceholder);
                                } catch (err) {
                                    // Default not found, use any placeholder
                                    const files = await fs.readdir(placeholdersDir);
                                    const pngFiles = files.filter(file => file.endsWith('.png'));
                                    if (pngFiles.length > 0) {
                                        const randomFile = pngFiles[Math.floor(Math.random() * pngFiles.length)];
                                        sourceFile = path.join(placeholdersDir, randomFile);
                                    }
                                }
                                
                                // Only copy if we have a source file
                                if (sourceFile) {
                                    await fs.copyFile(sourceFile, targetPath);
                                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Copied placeholder to standardized location: ${targetPath}`);
                                }
                            } catch (copyError) {
                                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Failed to copy placeholder: ${copyError.message}`);
                            }
                        } else {
                            logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest has no contest_code, cannot set standardized image URL`);
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
            
            // Update stats
            this.schedulerStats.contests.created++;
            this.schedulerStats.contests.scheduled++;
            
            // Update performance metrics
            this.schedulerStats.performance.lastContestCreationMs = Date.now() - functionStartTime;
            
            // Add to recently created contests list
            this.schedulerStats.lastCreatedContests.push({
                id: contest.id,
                name: contest.name,
                contest_code: contest.contest_code,
                start_time: contest.start_time,
                end_time: contest.end_time,
                created_at: new Date(),
                creation_time_ms: Date.now() - functionStartTime,
                schedule_type: isDbSchedule ? 'database' : 'config',
                schedule_id: isDbSchedule ? schedule.id : null
            });

            // Send Discord notification for contest creation
            try {
                const serviceEvents = (await import('../utils/service-suite/service-events.js')).default;
                const { SERVICE_EVENTS } = await import('../utils/service-suite/service-events.js');
                
                // Emit contest created event for Discord notification
                serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, {
                    id: contest.id,
                    name: contest.name,
                    contest_code: contest.contest_code,
                    start_time: contest.start_time,
                    end_time: contest.end_time,
                    prize_pool: contest.prize_pool,
                    entry_fee: contest.entry_fee,
                    status: contest.status,
                    wallet_address: contestWalletRecord?.wallet_address || 'Unknown',
                    schedule_type: isDbSchedule ? 'database' : 'config'
                });
                
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} 📢 Discord notification sent for new contest`);
            } catch (discordError) {
                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.YELLOW}Failed to send Discord notification: ${discordError.message}${fancyColors.RESET}`);
            }
            
            // Keep only the last 10 created contests
            if (this.schedulerStats.lastCreatedContests.length > 10) {
                this.schedulerStats.lastCreatedContests.shift();
            }
            
            return { contest, wallet: contestWalletRecord };
        } catch (error) {
            logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Error creating scheduled contest:`, error);
            this.schedulerStats.contests.failed++;
            throw error;
        }
    }

    /**
     * Check if a contest with similar schedule already exists
     * @param {Object} schedule - The schedule to check (can be from database or config)
     * @returns {Promise<boolean>} - True if a contest already exists for this schedule
     */
    async contestAlreadyExists(schedule) {
        const startTime = Date.now();
        try {
            let templateData;
            let isDbSchedule = false;
            
            // Determine if this is a database schedule or a config schedule
            if (schedule.template_id && schedule.template) {
                // This is a database schedule
                isDbSchedule = true;
                templateData = {
                    hour: null,
                    minute: 0
                };
                
                logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Checking existing contests for database schedule: ${schedule.name} (ID: ${schedule.id})`);
            } else {
                // This is a config schedule
                templateData = this.config.contests[schedule.template] || this.config.contests.defaultTemplate;
                
                if (!templateData) {
                    throw new Error(`Template "${schedule.template}" not found in configuration`);
                }
                
                logApi.debug(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Checking existing contests for config schedule: ${schedule.name}`);
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
            let targetHour;
            const targetMinute = isDbSchedule ? 
                (schedule.minute || 0) : 
                (schedule.minute || templateData.minute || 0);
                
            // Get the hour(s) to check
            if (
                (isDbSchedule && schedule.allow_multiple_hours && schedule.multiple_hours && schedule.multiple_hours.length > 0) ||
                (!isDbSchedule && Array.isArray(schedule.hour))
            ) {
                // For multi-hour schedules, use the next hour from the array
                const hourArray = isDbSchedule ? schedule.multiple_hours : schedule.hour;
                const currentHour = now.getHours();
                
                // Find the next hour after current time
                targetHour = hourArray.find(h => h > currentHour);
                
                // If no next hour today, use the first hour for tomorrow
                if (targetHour === undefined) {
                    targetHour = hourArray[0];
                }
            } else {
                // For single-hour schedules
                targetHour = isDbSchedule ? 
                    (schedule.hour || 12) : 
                    (schedule.hour || templateData.hour || 12);
            }
            
            const scheduleDays = schedule.days || [0, 1, 2, 3, 4, 5, 6]; // Default to all days
            
            for (const contest of existingContests) {
                const contestHour = contest.start_time.getHours();
                const contestMinute = contest.start_time.getMinutes();
                
                // For database schedules, if there's a schedule_id, check if it matches directly
                if (isDbSchedule && contest.schedule_id === schedule.id) {
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest already exists for this database schedule: ${schedule.name} (Contest ID: ${contest.id}, Code: ${contest.contest_code})`);
                    
                    // Update performance metric
                    this.schedulerStats.performance.lastScheduleCheckMs = Date.now() - startTime;
                    
                    return true;
                }
                
                // Check if hours and minutes match closely (within 5 minutes)
                if (targetHour !== undefined && contestHour === targetHour && Math.abs(contestMinute - targetMinute) <= 5) {
                    // Check if the contest is on one of the scheduled days
                    const contestDay = contest.start_time.getDay();
                    if (!scheduleDays || scheduleDays.includes(contestDay)) {
                        logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest already exists for schedule: ${schedule.name} (Contest ID: ${contest.id}, Code: ${contest.contest_code})`);
                        
                        // Update performance metric
                        this.schedulerStats.performance.lastScheduleCheckMs = Date.now() - startTime;
                        
                        return true;
                    }
                }
                
                // For multi-hour schedules, check all hours in the array
                if (
                    (isDbSchedule && schedule.allow_multiple_hours && schedule.multiple_hours && schedule.multiple_hours.length > 0) ||
                    (!isDbSchedule && Array.isArray(schedule.hour))
                ) {
                    const hourArray = isDbSchedule ? schedule.multiple_hours : schedule.hour;
                    
                    // Check if this contest matches any of the hours in the multi-hour schedule
                    if (hourArray.includes(contestHour) && Math.abs(contestMinute - targetMinute) <= 5) {
                        // Check if the contest is on one of the scheduled days
                        const contestDay = contest.start_time.getDay();
                        if (!scheduleDays || scheduleDays.includes(contestDay)) {
                            logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Contest already exists for multi-hour schedule: ${schedule.name} (Contest ID: ${contest.id}, Code: ${contest.contest_code})`);
                            
                            // Update performance metric
                            this.schedulerStats.performance.lastScheduleCheckMs = Date.now() - startTime;
                            
                            return true;
                        }
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
            // Even if Maintenance Mode *is* active, chug right along with the contest scheduling (I like this because MM is mostly to prevent users from doing *unexpected* actions that could break the system during a tranisition)
            if (isInMaintenance) {
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET}${fancyColors.BOLD}${fancyColors.YELLOW} System is in maintenance mode, but contest scheduler will continue to operate ${fancyColors.RESET}`);
            }
            
            // Pull the contest schedule data from db (source of truth)
            const dbSchedules = await this.loadSchedulesFromDatabase();
            
            let schedules;
            // If db doesn't work for some reason I can't imagine, fallback to the config file
            // (seems kind of pointless, but I'm keeping it for now)
            let scheduleSource;
            
            if (dbSchedules && dbSchedules.length > 0) {
                schedules = dbSchedules;
                scheduleSource = 'database';
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using ${schedules.length} active schedules from database`);
            } else {
                schedules = this.config.contests.schedules.filter(s => s.enabled !== false);
                scheduleSource = 'config';
                logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} Using ${schedules.length} active schedules from config file`);
            }
            
            // Check each schedule
            let createdCount = 0;
            let skippedCount = 0;
            
            for (const schedule of schedules) {
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
                `║ ${fancyColors.MAGENTA}Schedule Source${fancyColors.RESET}: ${scheduleSource.toUpperCase()}${' '.repeat(41 - scheduleSource.length)}${fancyColors.RESET} ║`,
                `║ ${fancyColors.YELLOW}Schedules Checked${fancyColors.RESET}: ${schedules.length}${' '.repeat(40 - String(schedules.length).length)}${fancyColors.RESET} ║`,
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
                    
                    // Add note about schedule source
                    const sourceStr = c.schedule_type === 'database' ? 
                        `${fancyColors.MAGENTA}[DB: ${c.schedule_id}]${fancyColors.RESET}` : 
                        `${fancyColors.BLUE}[Config]${fancyColors.RESET}`;
                    
                    logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ║ ${fancyColors.BOLD}${c.name}${fancyColors.RESET} ${sourceStr}${' '.repeat(Math.max(0, 60 - c.name.length - (sourceStr.length - 15)))} ║`);
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
                total: schedules.length,
                maintenanceMode: isInMaintenance,
                scheduleSource
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