// /routes/admin/circuit-breaker.js

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import ServiceManager from '../../utils/service-suite/service-manager.js';
import { requireAdmin } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @swagger
 * /api/admin/circuit-breaker/status:
 *   get:
 *     tags: [Admin]
 *     summary: Get circuit breaker status for all services
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Circuit breaker status for all services
 */
router.get('/status', requireAdmin, async (req, res) => {
    try {
        const services = Array.from(ServiceManager.services.entries());
        const states = await Promise.all(
            services.map(async ([name, service]) => {
                const state = await ServiceManager.getServiceState(name);
                return {
                    service: name,
                    status: ServiceManager.determineServiceStatus(service.stats),
                    circuit_breaker: {
                        is_open: service.stats.circuitBreaker.isOpen,
                        failures: service.stats.circuitBreaker.failures,
                        last_failure: service.stats.circuitBreaker.lastFailure,
                        last_success: service.stats.circuitBreaker.lastSuccess,
                        recovery_attempts: service.stats.circuitBreaker.recoveryAttempts
                    },
                    operations: service.stats.operations,
                    performance: service.stats.performance,
                    config: service.config.circuitBreaker,
                    ...state
                };
            })
        );

        res.json({
            success: true,
            services: states
        });
    } catch (error) {
        logApi.error('Failed to get circuit breaker status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/circuit-breaker/reset/{service}:
 *   post:
 *     tags: [Admin]
 *     summary: Reset circuit breaker for a service
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Circuit breaker reset successfully
 */
router.post('/reset/:service', requireAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = ServiceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        await serviceInstance.attemptCircuitRecovery();
        const state = await ServiceManager.getServiceState(service);

        res.json({
            success: true,
            service,
            state
        });
    } catch (error) {
        logApi.error('Failed to reset circuit breaker:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/circuit-breaker/config/{service}:
 *   get:
 *     tags: [Admin]
 *     summary: Get circuit breaker configuration for a service
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Circuit breaker configuration
 */
router.get('/config/:service', requireAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = ServiceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        res.json({
            success: true,
            service,
            config: serviceInstance.config.circuitBreaker
        });
    } catch (error) {
        logApi.error('Failed to get circuit breaker config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @swagger
 * /api/admin/circuit-breaker/config/{service}:
 *   put:
 *     tags: [Admin]
 *     summary: Update circuit breaker configuration for a service
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               failureThreshold:
 *                 type: number
 *               resetTimeoutMs:
 *                 type: number
 *               minHealthyPeriodMs:
 *                 type: number
 *     responses:
 *       200:
 *         description: Circuit breaker configuration updated
 */
router.put('/config/:service', requireAdmin, async (req, res) => {
    try {
        const { service } = req.params;
        const serviceInstance = ServiceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        // Update config
        serviceInstance.config.circuitBreaker = {
            ...serviceInstance.config.circuitBreaker,
            ...req.body
        };

        // Update state in database
        await ServiceManager.updateServiceState(
            service,
            { running: true, status: 'config_updated' },
            serviceInstance.config,
            serviceInstance.stats
        );

        res.json({
            success: true,
            service,
            config: serviceInstance.config.circuitBreaker
        });
    } catch (error) {
        logApi.error('Failed to update circuit breaker config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router; 