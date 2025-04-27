// controllers/contestSchedulerController.js

import { logApi } from '../utils/logger-suite/logger.js';
import contestSchedulerService from '../services/contestSchedulerService.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';

/**
 * Get the contest scheduler service status
 */
async function getSchedulerStatus(req, res) {
    try {
        const adminAddress = req.user.wallet_address;
        
        // Check if system is in maintenance mode
        const isInMaintenance = await contestSchedulerService.isInMaintenanceMode();

        // Get service status from the service
        const status = {
            isRunning: contestSchedulerService.isRunning(),
            stats: contestSchedulerService.schedulerStats,
            config: contestSchedulerService.config,
            health: {
                status: contestSchedulerService.stats.circuitBreaker.isOpen ? 'error' : 'healthy',
                circuitBreaker: contestSchedulerService.stats.circuitBreaker,
                lastError: contestSchedulerService.stats.history.lastError,
                lastErrorTime: contestSchedulerService.stats.history.lastErrorTime
            },
            maintenance: {
                systemInMaintenanceMode: isInMaintenance,
                serviceOperatingDuringMaintenance: contestSchedulerService.isRunning() && isInMaintenance,
                operationsDuringMaintenance: contestSchedulerService.schedulerStats.maintenance?.operationsDuringMaintenance || 0,
                contestsCreatedDuringMaintenance: contestSchedulerService.schedulerStats.contests?.createdDuringMaintenance || 0,
                lastMaintenanceOperation: contestSchedulerService.schedulerStats.maintenance?.lastMaintenanceCheckTime || null
            }
        };

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.STATUS,
            {
                service: 'contest_scheduler_service',
                status
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );

        res.json({
            success: true,
            data: status
        });
    } catch (error) {
        logApi.error('Failed to get contest scheduler status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get service status'
        });
    }
}

/**
 * Update contest scheduler configuration
 */
async function updateSchedulerConfig(req, res) {
    try {
        const { configuration } = req.body;
        const adminAddress = req.user.wallet_address;

        if (!configuration) {
            return res.status(400).json({
                success: false,
                error: 'No configuration provided'
            });
        }

        // Validate configuration
        if (configuration.contests && !Array.isArray(configuration.contests.schedules)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid configuration format'
            });
        }

        // Merge with existing configuration
        const updatedConfig = {
            ...contestSchedulerService.config,
            ...configuration
        };

        // Save configuration to database
        await prisma.system_settings.upsert({
            where: { key: contestSchedulerService.name },
            update: {
                value: updatedConfig,
                updated_at: new Date()
            },
            create: {
                key: contestSchedulerService.name,
                value: updatedConfig,
                created_at: new Date(),
                updated_at: new Date()
            }
        });

        // Update service configuration
        contestSchedulerService.config = updatedConfig;

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action: 'update_config',
                config: updatedConfig
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );

        res.json({
            success: true,
            message: 'Contest scheduler configuration updated',
            data: {
                config: updatedConfig
            }
        });
    } catch (error) {
        logApi.error('Failed to update contest scheduler configuration:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update configuration'
        });
    }
}

/**
 * Control the contest scheduler service
 */
async function controlSchedulerService(req, res) {
    try {
        const { action } = req.params;
        const adminAddress = req.user.wallet_address;
        
        if (!['start', 'stop', 'restart', 'status'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid action. Must be start, stop, restart, or status'
            });
        }

        // Check if system is in maintenance mode
        const isInMaintenance = await contestSchedulerService.isInMaintenanceMode();
        
        // Log maintenance status
        if (isInMaintenance) {
            logApi.info(`System is in maintenance mode while controlling contest scheduler service (action: ${action})`);
        }

        let result;
        switch (action) {
            case 'start':
                if (!contestSchedulerService.isRunning()) {
                    await contestSchedulerService.start();
                    
                    // If we're in maintenance mode, log special message
                    if (isInMaintenance) {
                        logApi.info(`Started contest scheduler service while system is in maintenance mode`);
                    }
                }
                break;
            case 'stop':
                if (contestSchedulerService.isRunning()) {
                    await contestSchedulerService.stop();
                }
                break;
            case 'restart':
                await contestSchedulerService.stop();
                await contestSchedulerService.start();
                
                // If we're in maintenance mode, log special message
                if (isInMaintenance) {
                    logApi.info(`Restarted contest scheduler service while system is in maintenance mode`);
                }
                break;
            case 'status':
                // Just return current status, no action needed
                break;
        }

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action,
                result: contestSchedulerService.isRunning() ? 'running' : 'stopped'
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );

        res.json({
            success: true,
            message: `Service ${action} completed successfully`,
            status: {
                isRunning: contestSchedulerService.isRunning(),
                health: {
                    status: contestSchedulerService.stats.circuitBreaker.isOpen ? 'error' : 'healthy',
                    circuitBreaker: contestSchedulerService.stats.circuitBreaker
                },
                maintenance: {
                    systemInMaintenanceMode: isInMaintenance,
                    serviceOperatingDuringMaintenance: contestSchedulerService.isRunning() && isInMaintenance,
                    operationsDuringMaintenance: contestSchedulerService.schedulerStats.maintenance?.operationsDuringMaintenance || 0,
                    lastMaintenanceOperation: contestSchedulerService.schedulerStats.maintenance?.lastMaintenanceCheckTime || null
                }
            }
        });
    } catch (error) {
        logApi.error(`Failed to ${action} contest scheduler service:`, error);
        res.status(500).json({
            success: false,
            error: `Failed to ${action} service`
        });
    }
}

/**
 * Create contest now based on template
 * This endpoint will work even during maintenance mode
 */
async function createContestNow(req, res) {
    try {
        const { scheduleName } = req.body;
        const adminAddress = req.user.wallet_address;

        if (!scheduleName) {
            return res.status(400).json({
                success: false,
                error: 'Schedule name is required'
            });
        }

        // Check if system is in maintenance mode
        const isInMaintenance = await contestSchedulerService.isInMaintenanceMode();
        
        // Log if in maintenance mode
        if (isInMaintenance) {
            logApi.info(`Creating contest during maintenance mode (admin-initiated) for schedule: ${scheduleName}`);
        }

        // Find the schedule by name
        const schedule = contestSchedulerService.config.contests.schedules.find(
            s => s.name === scheduleName || s.template === scheduleName
        );

        if (!schedule) {
            return res.status(400).json({
                success: false,
                error: `Schedule '${scheduleName}' not found`
            });
        }

        // Create contest now using service method that bypasses maintenance mode
        const result = await contestSchedulerService.createScheduledContest(schedule);
        
        // Update maintenance stats if applicable
        if (isInMaintenance) {
            contestSchedulerService.schedulerStats.contests.createdDuringMaintenance++;
            contestSchedulerService.schedulerStats.maintenance.operationsDuringMaintenance++;
            contestSchedulerService.schedulerStats.maintenance.lastMaintenanceCheckTime = new Date();
        }

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.CONTEST.CREATE,
            {
                service: 'contest_scheduler_service',
                schedule: scheduleName,
                contest_id: result.contest.id,
                contest_code: result.contest.contest_code
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );

        res.json({
            success: true,
            message: 'Contest created successfully',
            data: {
                contest: {
                    id: result.contest.id,
                    name: result.contest.name,
                    contest_code: result.contest.contest_code,
                    start_time: result.contest.start_time,
                    end_time: result.contest.end_time,
                    entry_fee: result.contest.entry_fee,
                    status: result.contest.status
                },
                wallet: {
                    address: result.wallet.wallet_address
                }
            }
        });
    } catch (error) {
        logApi.error('Failed to create contest:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create contest'
        });
    }
}

/**
 * Get the raw configuration from the config file
 * This allows admins to see the default configuration
 */
async function getConfigFile(req, res) {
    try {
        const adminAddress = req.user.wallet_address;
        
        // Import the configuration file directly
        const configModule = await import('../config/contest-scheduler-config.js');
        const configFile = configModule.default;
        
        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.STATUS,
            {
                service: 'contest_scheduler_service',
                action: 'get_config_file'
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );
        
        res.json({
            success: true,
            data: {
                configFile
            }
        });
    } catch (error) {
        logApi.error('Failed to get contest scheduler config file:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get config file'
        });
    }
}

/**
 * Get all database contest schedules
 */
async function getDbSchedules(req, res) {
    try {
        const schedules = await prisma.contest_schedule.findMany({
            include: {
                template: true
            }
        });
        
        res.json({
            success: true,
            data: schedules
        });
    } catch (error) {
        logApi.error('Failed to get contest schedules:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve contest schedules'
        });
    }
}

/**
 * Get a single schedule by ID
 */
async function getScheduleById(req, res) {
    try {
        const { id } = req.params;
        
        const schedule = await prisma.contest_schedule.findUnique({
            where: { id: parseInt(id) },
            include: {
                template: true,
                contests: {
                    where: {
                        start_time: {
                            gte: new Date()
                        }
                    },
                    orderBy: {
                        start_time: 'asc'
                    },
                    take: 5 // Get only the 5 upcoming contests
                }
            }
        });
        
        if (!schedule) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }
        
        res.json({
            success: true,
            data: schedule
        });
    } catch (error) {
        logApi.error('Failed to get schedule by ID:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve schedule'
        });
    }
}

/**
 * Create a new schedule
 */
async function createSchedule(req, res) {
    try {
        const adminAddress = req.user.wallet_address;
        const {
            name,
            template_id,
            hour,
            minute,
            days,
            entry_fee_override,
            name_override,
            description_override,
            duration_hours,
            enabled,
            advance_notice_hours,
            min_participants_override,
            max_participants_override,
            allow_multiple_hours,
            multiple_hours
        } = req.body;
        
        // Validate required fields
        if (!name || !template_id) {
            return res.status(400).json({
                success: false,
                error: 'Name and template_id are required'
            });
        }
        
        // Check if template exists
        const template = await prisma.contest_templates.findUnique({
            where: { id: parseInt(template_id) }
        });
        
        if (!template) {
            return res.status(400).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        // Create new schedule
        const newSchedule = await prisma.contest_schedule.create({
            data: {
                name,
                template_id: parseInt(template_id),
                hour: hour !== undefined ? parseInt(hour) : null,
                minute: minute !== undefined ? parseInt(minute) : 0,
                days: Array.isArray(days) ? days : [],
                entry_fee_override: entry_fee_override || null,
                name_override: name_override || null,
                description_override: description_override || null,
                duration_hours: duration_hours || 1.0,
                enabled: enabled !== undefined ? enabled : true,
                advance_notice_hours: advance_notice_hours || 1,
                min_participants_override: min_participants_override || null,
                max_participants_override: max_participants_override || null,
                allow_multiple_hours: allow_multiple_hours || false,
                multiple_hours: Array.isArray(multiple_hours) ? multiple_hours : []
            }
        });
        
        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action: 'create_schedule',
                schedule_id: newSchedule.id,
                schedule_name: newSchedule.name
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );
        
        res.status(201).json({
            success: true,
            message: 'Schedule created successfully',
            data: newSchedule
        });
    } catch (error) {
        logApi.error('Failed to create schedule:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create schedule'
        });
    }
}

/**
 * Update an existing schedule
 */
async function updateSchedule(req, res) {
    try {
        const { id } = req.params;
        const adminAddress = req.user.wallet_address;
        const {
            name,
            template_id,
            hour,
            minute,
            days,
            entry_fee_override,
            name_override,
            description_override,
            duration_hours,
            enabled,
            advance_notice_hours,
            min_participants_override,
            max_participants_override,
            allow_multiple_hours,
            multiple_hours
        } = req.body;
        
        // Check if schedule exists
        const existingSchedule = await prisma.contest_schedule.findUnique({
            where: { id: parseInt(id) }
        });
        
        if (!existingSchedule) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }
        
        // If template is being updated, check if it exists
        if (template_id) {
            const template = await prisma.contest_templates.findUnique({
                where: { id: parseInt(template_id) }
            });
            
            if (!template) {
                return res.status(400).json({
                    success: false,
                    error: 'Template not found'
                });
            }
        }
        
        // Update schedule
        const updatedSchedule = await prisma.contest_schedule.update({
            where: { id: parseInt(id) },
            data: {
                name: name !== undefined ? name : undefined,
                template_id: template_id !== undefined ? parseInt(template_id) : undefined,
                hour: hour !== undefined ? parseInt(hour) : undefined,
                minute: minute !== undefined ? parseInt(minute) : undefined,
                days: Array.isArray(days) ? days : undefined,
                entry_fee_override: entry_fee_override !== undefined ? entry_fee_override : undefined,
                name_override: name_override !== undefined ? name_override : undefined,
                description_override: description_override !== undefined ? description_override : undefined,
                duration_hours: duration_hours !== undefined ? duration_hours : undefined,
                enabled: enabled !== undefined ? enabled : undefined,
                advance_notice_hours: advance_notice_hours !== undefined ? advance_notice_hours : undefined,
                min_participants_override: min_participants_override !== undefined ? min_participants_override : undefined,
                max_participants_override: max_participants_override !== undefined ? max_participants_override : undefined,
                allow_multiple_hours: allow_multiple_hours !== undefined ? allow_multiple_hours : undefined,
                multiple_hours: Array.isArray(multiple_hours) ? multiple_hours : undefined,
                updated_at: new Date()
            }
        });
        
        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action: 'update_schedule',
                schedule_id: updatedSchedule.id,
                schedule_name: updatedSchedule.name
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );
        
        res.json({
            success: true,
            message: 'Schedule updated successfully',
            data: updatedSchedule
        });
    } catch (error) {
        logApi.error('Failed to update schedule:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update schedule'
        });
    }
}

/**
 * Delete a schedule
 */
async function deleteSchedule(req, res) {
    try {
        const { id } = req.params;
        const adminAddress = req.user.wallet_address;
        
        // Check if schedule exists
        const existingSchedule = await prisma.contest_schedule.findUnique({
            where: { id: parseInt(id) },
            include: {
                contests: {
                    where: {
                        start_time: {
                            gte: new Date()
                        }
                    }
                }
            }
        });
        
        if (!existingSchedule) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }
        
        // Check if schedule has upcoming contests
        if (existingSchedule.contests && existingSchedule.contests.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete schedule with upcoming contests. Disable the schedule instead.',
                data: {
                    upcomingContests: existingSchedule.contests.length
                }
            });
        }
        
        // Delete schedule
        await prisma.contest_schedule.delete({
            where: { id: parseInt(id) }
        });
        
        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action: 'delete_schedule',
                schedule_id: parseInt(id),
                schedule_name: existingSchedule.name
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );
        
        res.json({
            success: true,
            message: 'Schedule deleted successfully'
        });
    } catch (error) {
        logApi.error('Failed to delete schedule:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete schedule'
        });
    }
}

/**
 * Get all available templates
 */
async function getTemplates(req, res) {
    try {
        const templates = await prisma.contest_templates.findMany({
            where: {
                is_active: true
            }
        });
        
        res.json({
            success: true,
            data: templates
        });
    } catch (error) {
        logApi.error('Failed to get contest templates:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve contest templates'
        });
    }
}

/**
 * Create a contest immediately from a database schedule
 */
async function createDbContestNow(req, res) {
    try {
        const { scheduleId } = req.body;
        const adminAddress = req.user.wallet_address;

        if (!scheduleId) {
            return res.status(400).json({
                success: false,
                error: 'Schedule ID is required'
            });
        }

        // Check if system is in maintenance mode
        const isInMaintenance = await contestSchedulerService.isInMaintenanceMode();
        
        // Log if in maintenance mode
        if (isInMaintenance) {
            logApi.info(`Creating contest during maintenance mode (admin-initiated) for schedule ID: ${scheduleId}`);
        }

        // Find the schedule by ID
        const schedule = await prisma.contest_schedule.findUnique({
            where: { id: parseInt(scheduleId) },
            include: {
                template: true
            }
        });

        if (!schedule) {
            return res.status(404).json({
                success: false,
                error: `Schedule with ID ${scheduleId} not found`
            });
        }

        // Create contest now using service method
        const result = await contestSchedulerService.createScheduledContest(schedule);
        
        // Update maintenance stats if applicable
        if (isInMaintenance) {
            contestSchedulerService.schedulerStats.contests.createdDuringMaintenance++;
            contestSchedulerService.schedulerStats.maintenance.operationsDuringMaintenance++;
            contestSchedulerService.schedulerStats.maintenance.lastMaintenanceCheckTime = new Date();
        }
        
        // Update database stats
        contestSchedulerService.schedulerStats.contests.createdFromDatabaseSchedules++;

        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.CONTEST.CREATE,
            {
                service: 'contest_scheduler_service',
                schedule_id: scheduleId,
                schedule_name: schedule.name,
                contest_id: result.contest.id,
                contest_code: result.contest.contest_code
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );

        res.json({
            success: true,
            message: 'Contest created successfully',
            data: {
                contest: {
                    id: result.contest.id,
                    name: result.contest.name,
                    contest_code: result.contest.contest_code,
                    start_time: result.contest.start_time,
                    end_time: result.contest.end_time,
                    entry_fee: result.contest.entry_fee,
                    status: result.contest.status
                },
                schedule: {
                    id: schedule.id,
                    name: schedule.name
                },
                wallet: {
                    address: result.wallet.wallet_address
                }
            }
        });
    } catch (error) {
        logApi.error('Failed to create contest from database schedule:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create contest'
        });
    }
}

/**
 * Migrate existing config schedules to database
 */
async function migrateConfigToDatabase(req, res) {
    try {
        const adminAddress = req.user.wallet_address;
        
        // Call service method to migrate configs
        await contestSchedulerService.migrateConfigToDatabaseIfNeeded();
        
        // Get the new schedules from database
        const schedules = await prisma.contest_schedule.findMany({
            include: {
                template: true
            }
        });
        
        // Log admin action
        await AdminLogger.logAction(
            adminAddress,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service: 'contest_scheduler_service',
                action: 'migrate_config_to_database',
                schedules_count: schedules.length
            },
            {
                ip_address: req.ip,
                user_agent: req.get('user-agent')
            }
        );
        
        res.json({
            success: true,
            message: 'Successfully migrated config schedules to database',
            data: {
                schedules
            }
        });
    } catch (error) {
        logApi.error('Failed to migrate config to database:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to migrate config to database'
        });
    }
}

/**
 * Get public contest schedule information
 */
async function getPublicSchedules(req, res) {
    try {
        // Get upcoming contests grouped by schedule
        const now = new Date();
        
        // First get all active schedules
        const schedules = await prisma.contest_schedule.findMany({
            where: {
                enabled: true
            },
            include: {
                contests: {
                    where: {
                        start_time: {
                            gte: now
                        },
                        status: 'pending'
                    },
                    orderBy: {
                        start_time: 'asc'
                    },
                    take: 5
                }
            }
        });
        
        // Format public schedule data
        const formattedSchedules = schedules.map(schedule => ({
            id: schedule.id,
            name: schedule.name,
            days: schedule.days,
            hour: schedule.hour,
            minute: schedule.minute,
            duration_hours: schedule.duration_hours,
            entry_fee: schedule.entry_fee_override,
            upcoming_contests: schedule.contests.map(contest => ({
                id: contest.id,
                name: contest.name,
                start_time: contest.start_time,
                end_time: contest.end_time,
                entry_fee: contest.entry_fee.toString(),
                prize_pool: contest.prize_pool.toString(),
                status: contest.status
            })),
            allow_multiple_hours: schedule.allow_multiple_hours,
            multiple_hours: schedule.multiple_hours || []
        }));
        
        res.json({
            success: true,
            data: formattedSchedules
        });
    } catch (error) {
        logApi.error('Failed to get public contest schedules:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve public contest schedules'
        });
    }
}

export default {
    getSchedulerStatus,
    updateSchedulerConfig,
    controlSchedulerService,
    createContestNow,
    getConfigFile,
    getDbSchedules,
    getScheduleById,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    getTemplates,
    createDbContestNow,
    migrateConfigToDatabase,
    getPublicSchedules
};