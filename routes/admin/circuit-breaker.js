import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import ServiceManager, { SERVICE_NAMES } from '../../utils/service-suite/service-manager.js';

const router = Router();

/**
 * @swagger
 * /api/admin/circuit-breaker/states:
 *   get:
 *     summary: Get current state of all service circuit breakers
 *     tags: [Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current circuit breaker states
 */
router.get('/states', requireAuth, requireAdmin, async (req, res) => {
    try {
        const states = await prisma.circuit_breaker_states.findMany({
            include: {
                config: true,
                incidents: {
                    where: { status: 'active' },
                    orderBy: { start_time: 'desc' }
                }
            }
        });

        // Format response according to spec
        const response = {
            services: states.map(state => ({
                status: state.state === 'closed' ? 'healthy' : 
                        state.state === 'half-open' ? 'degraded' : 'failed',
                metrics: {
                    requestCount: 0, // To be implemented with metrics collection
                    errorCount: state.failure_count,
                    lastError: state.last_failure,
                    meanResponseTime: 0, // To be implemented with metrics collection
                    failurePercentage: 0 // To be calculated from metrics
                },
                circuit: {
                    state: state.state,
                    failureCount: state.failure_count,
                    lastFailure: state.last_failure,
                    recoveryAttempts: state.recovery_attempts
                },
                config: state.config ? {
                    failureThreshold: state.config.failure_threshold,
                    recoveryTimeout: state.config.recovery_timeout,
                    requestLimit: state.config.request_limit
                } : null
            })),
            systemHealth: {
                status: states.every(s => s.state === 'closed') ? 'operational' :
                        states.some(s => s.state === 'open') ? 'critical' : 'degraded',
                activeIncidents: states.reduce((count, s) => count + s.incidents.length, 0),
                lastIncident: states
                    .flatMap(s => s.incidents)
                    .sort((a, b) => b.start_time - a.start_time)[0]?.start_time || null
            }
        };

        res.json(response);
    } catch (error) {
        logApi.error('Failed to get circuit breaker states:', error);
        res.status(500).json({
            error: {
                code: 'FETCH_FAILED',
                message: 'Failed to fetch circuit breaker states',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            }
        });
    }
});

/**
 * @swagger
 * /api/admin/circuit-breaker/incidents:
 *   get:
 *     summary: Get circuit breaker incident history
 *     tags: [Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: start_date
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: end_date
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *       - name: service
 *         in: query
 *         schema:
 *           type: string
 *       - name: severity
 *         in: query
 *         schema:
 *           type: string
 *           enum: [warning, critical]
 *       - name: status
 *         in: query
 *         schema:
 *           type: string
 *           enum: [active, resolved]
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 */
router.get('/incidents', requireAuth, requireAdmin, async (req, res) => {
    try {
        const {
            start_date,
            end_date,
            service,
            severity,
            status,
            limit = 50,
            offset = 0
        } = req.query;

        // Build where clause
        const where = {
            ...(start_date && {
                start_time: { gte: new Date(start_date) }
            }),
            ...(end_date && {
                start_time: { lte: new Date(end_date) }
            }),
            ...(service && { service_name: service }),
            ...(severity && { severity }),
            ...(status && { status })
        };

        // Get total count for pagination
        const total = await prisma.circuit_breaker_incidents.count({ where });

        // Get incidents
        const incidents = await prisma.circuit_breaker_incidents.findMany({
            where,
            orderBy: { start_time: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset)
        });

        res.json({
            total,
            incidents: incidents.map(incident => ({
                id: incident.id,
                service: incident.service_name,
                type: incident.type,
                severity: incident.severity,
                status: incident.status,
                message: incident.message,
                startTime: incident.start_time,
                endTime: incident.end_time,
                metrics: incident.metrics
            }))
        });
    } catch (error) {
        logApi.error('Failed to get circuit breaker incidents:', error);
        res.status(500).json({
            error: {
                code: 'FETCH_FAILED',
                message: 'Failed to fetch circuit breaker incidents',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            }
        });
    }
});

/**
 * Get circuit breaker status for all services
 * GET /api/admin/circuit-breaker/status
 */
router.get('/status', requireAuth, requireAdmin, async (req, res) => {
    try {
        const services = Array.from(ServiceManager.services.keys());
        const statuses = await Promise.all(
            services.map(async (serviceName) => {
                const state = await ServiceManager.getServiceState(serviceName);
                return {
                    service: serviceName,
                    circuitBreaker: state?.stats?.circuitBreaker || {},
                    config: state?.config?.circuitBreaker || {},
                    dependencies: ServiceManager.dependencies.get(serviceName) || [],
                    operations: state?.stats?.operations || {},
                    history: state?.stats?.history || {}
                };
            })
        );

        res.json({
            success: true,
            data: statuses
        });
    } catch (error) {
        logApi.error('Failed to fetch circuit breaker status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch circuit breaker status'
        });
    }
});

/**
 * Update circuit breaker configuration for a service
 * PUT /api/admin/circuit-breaker/:service/config
 */
router.put('/:service/config', requireAuth, requireAdmin, async (req, res) => {
    const { service } = req.params;
    const { failureThreshold, resetTimeoutMs, minHealthyPeriodMs } = req.body;

    try {
        const serviceInstance = ServiceManager.services.get(service);
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Update the configuration
        const oldConfig = { ...serviceInstance.config.circuitBreaker };
        serviceInstance.config.circuitBreaker = {
            ...oldConfig,
            ...(failureThreshold !== undefined && { failureThreshold }),
            ...(resetTimeoutMs !== undefined && { resetTimeoutMs }),
            ...(minHealthyPeriodMs !== undefined && { minHealthyPeriodMs })
        };

        // Save the updated configuration
        await ServiceManager.updateServiceState(service, {
            running: true,
            status: 'active'
        }, serviceInstance.config, serviceInstance.stats);

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            AdminLogger.Actions.SERVICE.CONFIGURE,
            {
                service,
                type: 'circuit_breaker',
                old_config: oldConfig,
                new_config: serviceInstance.config.circuitBreaker
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }
        );

        res.json({
            success: true,
            data: {
                service,
                config: serviceInstance.config.circuitBreaker
            }
        });
    } catch (error) {
        logApi.error('Failed to update circuit breaker config:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update circuit breaker configuration'
        });
    }
});

/**
 * Reset circuit breaker for a service
 * POST /api/admin/circuit-breaker/:service/reset
 */
router.post('/:service/reset', requireAuth, requireAdmin, async (req, res) => {
    const { service } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({
            success: false,
            error: 'Reason for reset is required'
        });
    }

    try {
        const serviceInstance = ServiceManager.services.get(service);
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Store old state for logging
        const oldState = { ...serviceInstance.stats.circuitBreaker };

        // Reset the circuit breaker
        serviceInstance.stats.circuitBreaker = {
            ...serviceInstance.stats.circuitBreaker,
            isOpen: false,
            failures: 0,
            lastReset: new Date().toISOString()
        };

        // Save the updated state
        await ServiceManager.updateServiceState(service, {
            running: true,
            status: 'active'
        }, serviceInstance.config, serviceInstance.stats);

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'CIRCUIT_BREAKER_RESET',
            {
                service,
                reason,
                old_state: oldState,
                new_state: serviceInstance.stats.circuitBreaker
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }
        );

        res.json({
            success: true,
            data: {
                service,
                circuitBreaker: serviceInstance.stats.circuitBreaker
            }
        });
    } catch (error) {
        logApi.error('Failed to reset circuit breaker:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to reset circuit breaker'
        });
    }
});

export default router; 