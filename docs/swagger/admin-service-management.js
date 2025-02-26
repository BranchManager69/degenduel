/**
 * @swagger
 * tags:
 *   name: Service Management
 *   description: Admin endpoints for managing system services
 */

/**
 * @swagger
 * /api/admin/service-management/status:
 *   get:
 *     summary: Get service status
 *     description: |
 *       Retrieves the status of all system services including health, dependencies, and operational metrics.
 *       Requires admin privileges.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Service status data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 services:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Service name
 *                       status:
 *                         type: string
 *                         enum: [operational, degraded, offline, initializing]
 *                         description: Current operational status
 *                       uptime:
 *                         type: number
 *                         description: Service uptime in seconds
 *                       lastError:
 *                         type: string
 *                         description: Last error message if any
 *                       metrics:
 *                         type: object
 *                         description: Performance metrics specific to the service
 *                       dependencies:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Other services this service depends on
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/service-management/start/{service}:
 *   post:
 *     summary: Start a service
 *     description: |
 *       Starts a specific service that is currently stopped.
 *       Requires superadmin privileges.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the service to start
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               options:
 *                 type: object
 *                 description: Optional configuration for service startup
 *     responses:
 *       200:
 *         description: Service start operation result
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
 *                   example: Service started successfully
 *                 service:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [operational, initializing]
 *       400:
 *         description: Service not found or invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: Service already running
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/service-management/stop/{service}:
 *   post:
 *     summary: Stop a service
 *     description: |
 *       Stops a specific service that is currently running.
 *       Requires superadmin privileges.
 *       
 *       Warning: Stopping critical services may impact system functionality.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the service to stop
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 description: Force stop even if dependencies exist
 *               gracePeriod:
 *                 type: number
 *                 description: Time in ms to wait for graceful shutdown
 *     responses:
 *       200:
 *         description: Service stop operation result
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
 *                   example: Service stopped successfully
 *                 service:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [offline]
 *       400:
 *         description: Service not found or invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       409:
 *         description: Service has dependencies that would be affected
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/service-management/restart/{service}:
 *   post:
 *     summary: Restart a service
 *     description: |
 *       Restarts a specific service by stopping and starting it again.
 *       Requires superadmin privileges.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: service
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the service to restart
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               options:
 *                 type: object
 *                 description: Optional configuration for service restart
 *               gracePeriod:
 *                 type: number
 *                 description: Time in ms to wait for graceful shutdown
 *     responses:
 *       200:
 *         description: Service restart operation result
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
 *                   example: Service restarted successfully
 *                 service:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [operational, initializing]
 *       400:
 *         description: Service not found or invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/service-management/dependency-graph:
 *   get:
 *     summary: Get service dependency graph
 *     description: |
 *       Retrieves the dependency relationships between all system services.
 *       Requires admin privileges.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Service dependency graph
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 nodes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Service name
 *                       status:
 *                         type: string
 *                         enum: [operational, degraded, offline, initializing]
 *                 edges:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       source:
 *                         type: string
 *                         description: Source service name
 *                       target:
 *                         type: string
 *                         description: Target service name (dependency)
 *                       type:
 *                         type: string
 *                         enum: [required, optional]
 *                         description: Dependency type
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/service-management/health-check:
 *   post:
 *     summary: Run service health check
 *     description: |
 *       Triggers a manual health check for all services or a specific service.
 *       Requires admin privileges.
 *     tags: [Admin, Service Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               service:
 *                 type: string
 *                 description: Optional specific service to check, or all if omitted
 *               deep:
 *                 type: boolean
 *                 description: Whether to perform a deep health check
 *     responses:
 *       200:
 *         description: Health check results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       service:
 *                         type: string
 *                         description: Service name
 *                       status:
 *                         type: string
 *                         enum: [healthy, unhealthy, warning]
 *                       details:
 *                         type: object
 *                         description: Service-specific health details
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 