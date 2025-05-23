// /routes/admin/circuit-breaker.js

/**
 * @fileoverview Admin routes for managing circuit breakers
 * @module routes/admin/circuit-breaker
 * @requires express
 * @requires utils/logger-suite/logger
 * @requires utils/service-suite/service-manager
 * @requires middleware/auth
 * @requires services/marketDataService
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';
import { requireAdmin } from '../../middleware/auth.js';
import marketDataService from '../../services/market-data/marketDataService.js';
import adminLogger from '../../utils/admin-logger.js';
import { fancyColors } from '../../utils/colors.js';


const router = express.Router();

/**
 * @swagger
 * /api/admin/circuit-breaker/status:
 *   get:
 *     tags: [Admin]
 *     summary: Get circuit breaker status for all services
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Circuit breaker status for all services
 */
router.get('/status', requireAdmin, async (req, res) => {
    try {
        const services = Array.from(serviceManager.services.entries());
        const states = await Promise.all(
            services.map(async ([name, service]) => {
                const state = await serviceManager.getServiceState(name);
                return {
                    service: name,
                    status: serviceManager.determineServiceStatus(service.stats),
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
 *       - cookieAuth: []
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
        const serviceInstance = serviceManager.services.get(service);
        
        if (!serviceInstance) {
            return res.status(404).json({
                success: false,
                error: 'Service not found'
            });
        }

        await serviceInstance.attemptCircuitRecovery();
        const state = await serviceManager.getServiceState(service);

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
 *       - cookieAuth: []
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
        const serviceInstance = serviceManager.services.get(service);
        
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
 *       - cookieAuth: []
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
        const serviceInstance = serviceManager.services.get(service);
        
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
        await serviceManager.updateServiceState(
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

/**
 * @swagger
 * /api/admin/circuit-breaker/reset/marketdata:
 *   post:
 *     tags: [Admin]
 *     summary: Reset circuit breaker for the MarketDataService
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Circuit breaker reset successfully
 */
router.post('/reset/marketdata', requireAdmin, async (req, res) => {
    try {
        const result = marketDataService.resetCircuitBreaker();
        
        if (result) {
            // Log the admin action with the correct method
            await adminLogger.logAction(req.user.wallet_address, 'CIRCUIT_BREAKER_RESET', 'MarketDataService');
            
            return res.json({
                success: true,
                message: 'MarketDataService circuit breaker has been reset successfully'
            });
        } else {
            return res.status(500).json({
                success: false,
                message: 'Failed to reset circuit breaker'
            });
        }
    } catch (error) {
        logApi.error('Failed to reset MarketDataService circuit breaker:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router; 