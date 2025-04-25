/**
 * @swagger
 * tags:
 *   name: Service Configuration
 *   description: Service configuration and interval management
 */

/**
 * @swagger
 * /admin/service-config:
 *   get:
 *     summary: List all service configurations
 *     tags: [Service Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of service configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceConfiguration'
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /admin/service-config/{serviceName}:
 *   get:
 *     summary: Get a specific service configuration
 *     tags: [Service Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceName
 *         required: true
 *         schema:
 *           type: string
 *         description: The service name
 *     responses:
 *       200:
 *         description: Service configuration retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/ServiceConfiguration'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Service configuration not found
 *       500:
 *         description: Server error
 *
 *   patch:
 *     summary: Update a service configuration
 *     tags: [Service Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceName
 *         required: true
 *         schema:
 *           type: string
 *         description: The service name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name:
 *                 type: string
 *                 description: Human-readable name for the service
 *               enabled:
 *                 type: boolean
 *                 description: Whether the service is enabled
 *               check_interval_ms:
 *                 type: integer
 *                 minimum: 1000
 *                 description: Service check interval in milliseconds
 *               circuit_breaker:
 *                 type: object
 *                 description: Circuit breaker configuration
 *               backoff:
 *                 type: object
 *                 description: Backoff configuration
 *               thresholds:
 *                 type: object
 *                 description: Service-specific thresholds
 *     responses:
 *       200:
 *         description: Service configuration updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Updated configuration for service_name"
 *                 data:
 *                   $ref: '#/components/schemas/ServiceConfiguration'
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Service configuration not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /admin/service-config/{serviceName}/interval:
 *   patch:
 *     summary: Update just the interval for a service
 *     tags: [Service Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: serviceName
 *         required: true
 *         schema:
 *           type: string
 *         description: The service name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - check_interval_ms
 *             properties:
 *               check_interval_ms:
 *                 type: integer
 *                 minimum: 1000
 *                 description: Service check interval in milliseconds
 *                 example: 60000
 *     responses:
 *       200:
 *         description: Service interval updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Updated interval for service_name to 60000ms"
 *                 data:
 *                   $ref: '#/components/schemas/ServiceConfiguration'
 *       400:
 *         description: Invalid interval
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Service configuration not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ServiceConfiguration:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique identifier
 *         service_name:
 *           type: string
 *           description: Service identifier (unique)
 *         display_name:
 *           type: string
 *           description: Human-readable name
 *         enabled:
 *           type: boolean
 *           description: Whether the service is enabled
 *         check_interval_ms:
 *           type: integer
 *           description: Service check interval in milliseconds
 *         circuit_breaker:
 *           type: object
 *           description: Circuit breaker configuration
 *         backoff:
 *           type: object
 *           description: Backoff configuration
 *         thresholds:
 *           type: object
 *           description: Service-specific thresholds
 *         last_updated:
 *           type: string
 *           format: date-time
 *           description: When the configuration was last updated
 *         updated_by:
 *           type: string
 *           description: Admin who made the update
 *         last_run_at:
 *           type: string
 *           format: date-time
 *           description: When the service last ran
 *         last_run_duration_ms:
 *           type: integer
 *           description: Duration of the last run in milliseconds
 *         last_status:
 *           type: string
 *           description: Last known status
 *         status_message:
 *           type: string
 *           description: Last status message
 */