import express from 'express';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';

const router = express.Router();

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
router.get('/states', requireAuth, requireSuperAdmin, async (req, res) => {
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
 * /api/admin/circuit-breaker/{service}/config:
 *   post:
 *     summary: Update circuit breaker configuration for a service
 *     tags: [Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: service
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 */
router.post('/:service/config', requireAuth, requireSuperAdmin, async (req, res) => {
    const { service } = req.params;
    const config = req.body;

    try {
        // Validate config
        const requiredFields = ['failureThreshold', 'recoveryTimeout', 'requestLimit', 'monitoringWindow', 'minimumRequests'];
        const missingFields = requiredFields.filter(field => config[field] === undefined);
        
        if (missingFields.length > 0) {
            return res.status(400).json({
                error: {
                    code: 'INVALID_CONFIG',
                    message: 'Missing required configuration fields',
                    details: { missingFields }
                }
            });
        }

        // Update or create configuration
        const updatedConfig = await prisma.circuit_breaker_config.upsert({
            where: { service_name: service },
            update: {
                failure_threshold: config.failureThreshold,
                recovery_timeout: config.recoveryTimeout,
                request_limit: config.requestLimit,
                monitoring_window: config.monitoringWindow,
                minimum_requests: config.minimumRequests,
                updated_at: new Date()
            },
            create: {
                service_name: service,
                failure_threshold: config.failureThreshold,
                recovery_timeout: config.recoveryTimeout,
                request_limit: config.requestLimit,
                monitoring_window: config.monitoringWindow,
                minimum_requests: config.minimumRequests
            }
        });

        // Broadcast update via WebSocket if available
        if (global.circuitBreakerWss) {
            global.circuitBreakerWss.broadcastConfigUpdate(service, config);
        }

        res.json({
            service,
            config: updatedConfig
        });
    } catch (error) {
        logApi.error(`Failed to update circuit breaker config for ${service}:`, error);
        res.status(500).json({
            error: {
                code: 'UPDATE_FAILED',
                message: 'Failed to update circuit breaker configuration',
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
router.get('/incidents', requireAuth, requireSuperAdmin, async (req, res) => {
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
 * @swagger
 * /api/admin/circuit-breaker/{service}/reset:
 *   post:
 *     summary: Manually reset circuit breaker for a service
 *     tags: [Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - name: service
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 */
router.post('/:service/reset', requireAuth, requireSuperAdmin, async (req, res) => {
    const { service } = req.params;
    const { reason, force = false } = req.body;

    try {
        // Get current state
        const state = await prisma.circuit_breaker_states.findUnique({
            where: { service_name: service }
        });

        if (!state) {
            return res.status(404).json({
                error: {
                    code: 'SERVICE_NOT_FOUND',
                    message: 'Service circuit breaker not found'
                }
            });
        }

        if (state.state === 'closed' && !force) {
            return res.status(400).json({
                error: {
                    code: 'ALREADY_CLOSED',
                    message: 'Circuit breaker is already closed'
                }
            });
        }

        // Reset the circuit breaker
        const updatedState = await prisma.circuit_breaker_states.update({
            where: { service_name: service },
            data: {
                state: 'closed',
                failure_count: 0,
                recovery_attempts: 0,
                updated_at: new Date()
            }
        });

        // Log the manual reset
        await prisma.circuit_breaker_incidents.create({
            data: {
                service_name: service,
                type: 'manual_reset',
                severity: 'info',
                status: 'resolved',
                message: `Circuit breaker manually reset by admin. Reason: ${reason || 'Not provided'}`,
                start_time: new Date(),
                end_time: new Date(),
                metrics: {
                    previousState: state.state,
                    previousFailures: state.failure_count,
                    forcedReset: force
                }
            }
        });

        // Broadcast reset via WebSocket if available
        if (global.circuitBreakerWss) {
            global.circuitBreakerWss.broadcastCircuitReset(service);
        }

        res.json({
            service,
            state: updatedState,
            reset: {
                timestamp: new Date().toISOString(),
                reason,
                forced: force
            }
        });
    } catch (error) {
        logApi.error(`Failed to reset circuit breaker for ${service}:`, error);
        res.status(500).json({
            error: {
                code: 'RESET_FAILED',
                message: 'Failed to reset circuit breaker',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            }
        });
    }
});

export default router; 