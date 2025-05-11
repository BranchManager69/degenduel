// /routes/admin/service-management.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import AdminLogger from '../../utils/admin-logger.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import adminWalletService from '../../services/admin-wallet/admin-wallet-service.js';
import walletBalanceWs from '../../services/admin-wallet/modules/wallet-balance-ws.js';

const router = express.Router();
const serviceLogger = logApi.forService('SERVICE-MGMT');

/**
 * @swagger
 * /api/admin/service-management/status:
 *   get:
 *     tags: [Admin]
 *     summary: Get status of all services
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Status of all services
 */
// Open endpoint for monitoring services without authentication
router.get('/status', async (req, res) => {
    try {
        const services = Array.from(serviceManager.services.entries());
        const statuses = await Promise.all(
            services.map(async ([name, service]) => {
                const state = await serviceManager.getServiceState(name);
                const metadata = getServiceMetadata(name);
                return {
                    name,
                    displayName: metadata?.displayName || name,
                    description: metadata?.description || '',
                    status: serviceManager.determineServiceStatus(service.stats),
                    isOperational: service.isOperational,
                    isInitialized: service.isInitialized,
                    isStarted: service.isStarted || false,
                    dependencies: service.config.dependencies || [],
                    lastCheck: service.stats?.history?.lastCheck,
                    lastError: service.stats?.history?.lastError,
                    lastErrorTime: service.stats?.history?.lastErrorTime,
                    stats: {
                        operations: service.stats?.operations || { total: 0, successful: 0, failed: 0 },
                        performance: service.stats?.performance || {},
                    },
                    circuitBreaker: {
                        isOpen: service.stats?.circuitBreaker?.isOpen || false,
                        failures: service.stats?.circuitBreaker?.failures || 0,
                        lastFailure: service.stats?.circuitBreaker?.lastFailure,
                        lastSuccess: service.stats?.circuitBreaker?.lastSuccess,
                        recoveryAttempts: service.stats?.circuitBreaker?.recoveryAttempts || 0
                    },
                    ...state
                };
            })
        );

        // Sort by layer and name
        statuses.sort((a, b) => {
            const metaA = getServiceMetadata(a.name);
            const metaB = getServiceMetadata(b.name);
            if (metaA?.layer !== metaB?.layer) {
                return (metaA?.layer || 999) - (metaB?.layer || 999);
            }
            return a.name.localeCompare(b.name);
        });

        res.json({
            success: true,
            services: statuses,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        serviceLogger.error('Failed to get service statuses:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/start/{service}:
 *   post:
 *     tags: [Admin]
 *     summary: Start or restart a service
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service started successfully
 */
router.post('/start/:service', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = serviceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Check if service is already running
        if (serviceInstance.isStarted) {
            // Stop the service first
            await serviceInstance.stop();
            serviceLogger.info(`Service ${service} stopped before restart`);
        }

        // Initialize and start the service
        await serviceInstance.initialize();
        await serviceInstance.start();
        
        // Get the updated state
        const state = await serviceManager.getServiceState(service);

        // Log the action
        await AdminLogger.logAction(
            req.user.id,
            req.user.role === 'superadmin' ? 'SERVICE-START' : 'SERVICE-START-ATTEMPT',
            {
                service,
                result: 'success',
                user: req.user.id,
                state
            }
        );

        res.json({
            success: true,
            message: `Service ${service} started successfully`,
            service,
            state
        });
    } catch (error) {
        serviceLogger.error(`Failed to start service ${req.params.service}:`, error);
        
        // Log the failure
        await AdminLogger.logAction(
            req.user.id,
            'SERVICE-START-FAILED',
            {
                service: req.params.service,
                error: error.message,
                user: req.user.id
            }
        );
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/stop/{service}:
 *   post:
 *     tags: [Admin]
 *     summary: Stop a service
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service stopped successfully
 */
router.post('/stop/:service', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = serviceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        if (!serviceInstance.isStarted) {
            return res.status(400).json({
                success: false,
                error: 'Service is not running'
            });
        }

        // Stop the service
        await serviceInstance.stop();
        
        // Get the updated state
        const state = await serviceManager.getServiceState(service);

        // Log the action
        await AdminLogger.logAction(
            req.user.id,
            req.user.role === 'superadmin' ? 'SERVICE-STOP' : 'SERVICE-STOP-ATTEMPT',
            {
                service,
                result: 'success',
                user: req.user.id,
                state
            }
        );

        res.json({
            success: true,
            message: `Service ${service} stopped successfully`,
            service,
            state
        });
    } catch (error) {
        serviceLogger.error(`Failed to stop service ${req.params.service}:`, error);
        
        // Log the failure
        await AdminLogger.logAction(
            req.user.id,
            'SERVICE-STOP-FAILED',
            {
                service: req.params.service,
                error: error.message,
                user: req.user.id
            }
        );
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/restart/{service}:
 *   post:
 *     tags: [Admin]
 *     summary: Restart a service
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Service restarted successfully
 */
router.post('/restart/:service', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = serviceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Stop the service if it's running
        if (serviceInstance.isStarted) {
            await serviceInstance.stop();
        }

        // Initialize and start the service
        await serviceInstance.initialize();
        await serviceInstance.start();
        
        // Get the updated state
        const state = await serviceManager.getServiceState(service);

        // Log the action
        await AdminLogger.logAction(
            req.user.id,
            req.user.role === 'superadmin' ? 'SERVICE-RESTART' : 'SERVICE-RESTART-ATTEMPT',
            {
                service,
                result: 'success',
                user: req.user.id,
                state
            }
        );

        res.json({
            success: true,
            message: `Service ${service} restarted successfully`,
            service,
            state
        });
    } catch (error) {
        serviceLogger.error(`Failed to restart service ${req.params.service}:`, error);
        
        // Log the failure
        await AdminLogger.logAction(
            req.user.id,
            'SERVICE-RESTART-FAILED',
            {
                service: req.params.service,
                error: error.message,
                user: req.user.id
            }
        );
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/status/{serviceName}:
 *   get:
 *     tags: [Admin]
 *     summary: Get status of a specific service
 *     parameters:
 *       - in: path
 *         name: serviceName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Status of the specified service
 *       404:
 *         description: Service not found
 */
router.get('/status/service/:serviceName', async (req, res) => {
    try {
        const { serviceName } = req.params;

        // Special case handling for admin_wallet_service
        if (serviceName === SERVICE_NAMES.ADMIN_WALLET && adminWalletService) {
            const metadata = getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET) || {
                description: 'Administrative wallet operations'
            };

            // Direct WebSocket status
            let wsStatus = { active: false };
            let monitoringInfo = {};

            if (adminWalletService.walletStats && adminWalletService.walletStats.monitoring) {
                monitoringInfo = adminWalletService.walletStats.monitoring;

                if (monitoringInfo.mode === 'websocket' && monitoringInfo.initialized) {
                    try {
                        wsStatus = {
                            active: true,
                            ...walletBalanceWs.getWebSocketStatus()
                        };
                    } catch (error) {
                        wsStatus = {
                            active: monitoringInfo.initialized,
                            error: error.message,
                            message: 'Error getting WebSocket status'
                        };
                    }
                }
            }

            // Create custom service status for admin wallet
            const serviceStatus = {
                name: serviceName,
                displayName: metadata?.displayName || serviceName,
                description: metadata?.description || 'Administrative wallet operations',
                status: adminWalletService.isOperational ? 'operational' : 'non-operational',
                isOperational: adminWalletService.isOperational || false,
                isInitialized: adminWalletService.isInitialized || false,
                isStarted: adminWalletService.isStarted || false,
                dependencies: adminWalletService.config?.dependencies || [],
                lastCheck: adminWalletService.stats?.history?.lastCheck,
                lastError: adminWalletService.stats?.history?.lastError,
                lastErrorTime: adminWalletService.stats?.history?.lastErrorTime,
                stats: {
                    operations: adminWalletService.stats?.operations || { total: 0, successful: 0, failed: 0 },
                    performance: adminWalletService.stats?.performance || {},
                },
                circuitBreaker: {
                    isOpen: adminWalletService.stats?.circuitBreaker?.isOpen || false,
                    failures: adminWalletService.stats?.circuitBreaker?.failures || 0,
                    lastFailure: adminWalletService.stats?.circuitBreaker?.lastFailure,
                    lastSuccess: adminWalletService.stats?.circuitBreaker?.lastSuccess,
                    recoveryAttempts: adminWalletService.stats?.circuitBreaker?.recoveryAttempts || 0
                },
                monitoring: {
                    mode: monitoringInfo.mode || 'polling',
                    status: monitoringInfo.status || 'inactive',
                    initialized: monitoringInfo.initialized || false,
                    webSocket: wsStatus
                }
            };

            return res.json({
                success: true,
                data: serviceStatus,
                timestamp: new Date().toISOString()
            });
        }

        // Standard service manager lookup for other services
        const serviceInstance = serviceManager.services.get(serviceName);

        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        const state = await serviceManager.getServiceState(serviceName);
        const metadata = getServiceMetadata(serviceName);

        let serviceStatus = {
            name: serviceName,
            displayName: metadata?.displayName || serviceName,
            description: metadata?.description || '',
            status: serviceManager.determineServiceStatus(serviceInstance.stats),
            isOperational: serviceInstance.isOperational,
            isInitialized: serviceInstance.isInitialized,
            isStarted: serviceInstance.isStarted || false,
            dependencies: serviceInstance.config.dependencies || [],
            lastCheck: serviceInstance.stats?.history?.lastCheck,
            lastError: serviceInstance.stats?.history?.lastError,
            lastErrorTime: serviceInstance.stats?.history?.lastErrorTime,
            stats: {
                operations: serviceInstance.stats?.operations || { total: 0, successful: 0, failed: 0 },
                performance: serviceInstance.stats?.performance || {},
            },
            circuitBreaker: {
                isOpen: serviceInstance.stats?.circuitBreaker?.isOpen || false,
                failures: serviceInstance.stats?.circuitBreaker?.failures || 0,
                lastFailure: serviceInstance.stats?.circuitBreaker?.lastFailure,
                lastSuccess: serviceInstance.stats?.circuitBreaker?.lastSuccess,
                recoveryAttempts: serviceInstance.stats?.circuitBreaker?.recoveryAttempts || 0
            },
            ...state
        };

        res.json({
            success: true,
            data: serviceStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        serviceLogger.error(`Failed to get service status for ${req.params.serviceName}:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/wallet-monitoring:
 *   get:
 *     tags: [Admin]
 *     summary: Get status of the admin wallet WebSocket monitoring
 *     responses:
 *       200:
 *         description: WebSocket monitoring status for admin wallets
 *       404:
 *         description: Admin wallet service not found
 */
router.get('/wallet-monitoring', async (req, res) => {
    try {
        // Skip the service manager check since it might not be registered properly
        if (!adminWalletService) {
            return res.status(404).json({
                success: false,
                error: 'Admin wallet service not available'
            });
        }

        // Get WebSocket monitoring status if active
        let wsStatus = { active: false };
        let monitoringInfo = {};

        if (adminWalletService.walletStats && adminWalletService.walletStats.monitoring) {
            monitoringInfo = adminWalletService.walletStats.monitoring;

            if (monitoringInfo.mode === 'websocket' && monitoringInfo.initialized) {
                try {
                    // Get detailed WebSocket status directly from the module
                    wsStatus = {
                        active: true,
                        ...walletBalanceWs.getWebSocketStatus()
                    };
                } catch (error) {
                    wsStatus = {
                        active: monitoringInfo.initialized,
                        error: error.message,
                        message: 'Error getting WebSocket status'
                    };
                }
            }
        }

        // Get basic service information without serviceManager
        const metadata = getServiceMetadata(SERVICE_NAMES.ADMIN_WALLET) || {
            description: 'Administrative wallet operations'
        };

        const basicStatus = {
            name: SERVICE_NAMES.ADMIN_WALLET,
            displayName: SERVICE_NAMES.ADMIN_WALLET,
            description: metadata.description || 'Administrative wallet operations',
            status: adminWalletService.isOperational ? 'operational' : 'non-operational',
            isInitialized: adminWalletService.isInitialized || false,
            isStarted: adminWalletService.isStarted || false,
        };

        res.json({
            success: true,
            data: {
                ...basicStatus,
                monitoringMode: monitoringInfo.mode || 'polling',
                initialized: monitoringInfo.initialized || false,
                webSocket: wsStatus,
                walletCount: wsStatus.walletCount || 0,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        const errorMsg = `Failed to get admin wallet monitoring status: ${error.message}`;
        serviceLogger.error(errorMsg, error);
        res.status(500).json({
            success: false,
            error: errorMsg
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/dependency-graph:
 *   get:
 *     tags: [Admin]
 *     summary: Get the service dependency graph
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Service dependency graph
 */
router.get('/dependency-graph', requireAuth, requireAdmin, async (req, res) => {
    try {
        const graph = [];
        const services = Array.from(serviceManager.services.entries());
        
        for (const [name, service] of services) {
            const dependencies = service.config.dependencies || [];
            const dependents = services
                .filter(([_, s]) => (s.config.dependencies || []).includes(name))
                .map(([n, _]) => n);
                
            graph.push({
                service: name,
                displayName: getServiceMetadata(name)?.displayName || name,
                description: getServiceMetadata(name)?.description || '',
                layer: getServiceMetadata(name)?.layer,
                dependencies,
                dependents,
                operational: service.isOperational,
                initialized: service.isInitialized,
                started: service.isStarted
            });
        }
        
        res.json({
            success: true,
            graph,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        serviceLogger.error('Failed to get dependency graph:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/service-management/health-check:
 *   post:
 *     tags: [Admin]
 *     summary: Trigger a health check on all services
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Health check triggered
 */
router.post('/health-check', requireAuth, requireAdmin, async (req, res) => {
    try {
        const services = Array.from(serviceManager.services.entries());
        const results = {};
        
        // Perform health checks in parallel
        await Promise.all(services.map(async ([name, service]) => {
            try {
                const isHealthy = await serviceManager.checkServiceHealth(name);
                results[name] = {
                    healthy: isHealthy,
                    error: null,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                results[name] = {
                    healthy: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                };
            }
        }));
        
        // Log the action
        await AdminLogger.logAction(
            req.user.id,
            'SERVICE-HEALTH-CHECK',
            {
                results,
                user: req.user.id
            }
        );
        
        res.json({
            success: true,
            results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        serviceLogger.error('Failed to perform health checks:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;