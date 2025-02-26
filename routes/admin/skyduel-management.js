// routes/admin/skyduel-management.js

import express from 'express';
import { requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';

const router = express.Router();

/**
 * @route GET /api/admin/skyduel/status
 * @desc Get quick status of all services for initial dashboard load
 * @access Super Admin
 */
router.get('/status', requireSuperAdmin, async (req, res) => {
    try {
        const services = Array.from(serviceManager.services.entries());
        const statuses = services.map(([name, service]) => ({
            name,
            status: serviceManager.determineServiceStatus(service.stats),
            isOperational: service.isOperational,
            isStarted: service.isStarted || false
        }));

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_SERVICE_STATUS',
            {
                count: statuses.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            services: statuses,
            timestamp: new Date().toISOString(),
            wsEndpoint: '/api/v2/ws/skyduel'
        });
    } catch (error) {
        logApi.error('Failed to get unified service status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/websocket-auth
 * @desc Get a temporary auth token for WebSocket connection
 * @access Super Admin
 */
router.post('/websocket-auth', requireSuperAdmin, async (req, res) => {
    try {
        // Generate a temporary token based on session
        const tempToken = req.user.auth_token || req.headers.authorization?.split(' ')[1];
        
        if (!tempToken) {
            return res.status(401).json({
                success: false,
                error: 'No valid auth token found'
            });
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'WS_AUTH_TOKEN_REQUEST',
            {
                action: 'websocket_auth'
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            token: tempToken,
            expires: new Date(Date.now() + 300000).toISOString() // 5 minutes
        });
    } catch (error) {
        logApi.error('Failed to generate WebSocket auth token:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route GET /api/admin/skyduel/services
 * @desc Get detailed information about all services
 * @access Super Admin
 */
router.get('/services', requireSuperAdmin, async (req, res) => {
    try {
        const serviceDetails = [];
        const services = Array.from(serviceManager.services.entries());
        
        for (const [name, service] of services) {
            try {
                const state = await serviceManager.getServiceState(name);
                
                serviceDetails.push({
                    id: name,
                    displayName: service.config?.displayName || name,
                    status: serviceManager.determineServiceStatus(service.stats),
                    isOperational: service.isOperational,
                    isInitialized: service.isInitialized,
                    isStarted: service.isStarted || false,
                    lastRun: service.stats?.lastRun,
                    lastAttempt: service.stats?.lastAttempt,
                    uptime: service.stats?.uptime,
                    circuitBreaker: {
                        isOpen: service.stats?.circuitBreaker?.isOpen || false,
                        failures: service.stats?.circuitBreaker?.failures || 0
                    },
                    operations: service.stats?.operations,
                    state
                });
            } catch (error) {
                logApi.error(`Error getting state for service ${name}:`, error);
                serviceDetails.push({
                    id: name,
                    displayName: service.config?.displayName || name,
                    status: 'error',
                    error: error.message
                });
            }
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_DETAILED_SERVICE_STATUS',
            {
                count: serviceDetails.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            services: serviceDetails,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to get detailed service information:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route GET /api/admin/skyduel/dependency-graph
 * @desc Get service dependency graph
 * @access Super Admin
 */
router.get('/dependency-graph', requireSuperAdmin, async (req, res) => {
    try {
        const graph = [];
        const services = Array.from(serviceManager.services.entries());
        
        for (const [name, service] of services) {
            // Get direct dependencies
            const dependencies = serviceManager.dependencies.get(name) || [];
            
            // Get dependents (services that depend on this one)
            const dependents = services
                .filter(([_, s]) => (s.config.dependencies || []).includes(name))
                .map(([n, _]) => n);
                
            graph.push({
                service: name,
                displayName: service.config?.displayName || name,
                description: service.config?.description || '',
                layer: service.config?.layer,
                dependencies,
                dependents,
                operational: service.isOperational,
                initialized: service.isInitialized,
                started: service.isStarted
            });
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_DEPENDENCY_GRAPH',
            {
                serviceCount: graph.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            graph,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to generate dependency graph:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/start
 * @desc Start a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/start', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Start the service
        await serviceManager.startService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'start',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to start service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'start',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/stop
 * @desc Stop a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/stop', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Stop the service
        await serviceManager.stopService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'stop',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to stop service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'stop',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/restart
 * @desc Restart a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/restart', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Restart the service
        await serviceManager.restartService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'restart',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to restart service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'restart',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/reset-circuit-breaker
 * @desc Reset circuit breaker for a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/reset-circuit-breaker', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Get service instance
        const service = serviceManager.services.get(serviceName);
        if (!service) {
            return res.status(404).json({
                success: false,
                service: serviceName,
                action: 'reset-circuit-breaker',
                error: `Service ${serviceName} not found`
            });
        }
        
        // Reset circuit breaker
        if (service.resetCircuitBreaker) {
            await service.resetCircuitBreaker();
        } else {
            // Manually reset stats if method doesn't exist
            if (service.stats && service.stats.circuitBreaker) {
                service.stats.circuitBreaker.isOpen = false;
                service.stats.circuitBreaker.failures = 0;
                service.stats.circuitBreaker.lastReset = new Date().toISOString();
            }
            
            // Call service manager to mark as recovered
            await serviceManager.markServiceRecovered(serviceName);
        }
        
        // Log admin action
        await AdminLogger.logAction(
            req.user.id,
            'RESET_CIRCUIT_BREAKER',
            {
                service: serviceName,
                action: 'reset',
                timestamp: new Date().toISOString()
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent'] || 'Unknown'
            }
        );
        
        res.json({
            success: true,
            service: serviceName,
            action: 'reset-circuit-breaker',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to reset circuit breaker for service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'reset-circuit-breaker',
            error: error.message
        });
    }
});

export default router;