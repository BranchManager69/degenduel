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

export default {
    getSchedulerStatus,
    updateSchedulerConfig,
    controlSchedulerService,
    createContestNow,
    getConfigFile
};