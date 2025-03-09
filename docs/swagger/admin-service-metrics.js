/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin-only endpoints for system management
 */

/**
 * @swagger
 * /api/admin/metrics/service-analytics:
 *   get:
 *     summary: Get service analytics
 *     description: |
 *       Retrieves analytics data for all services including status, failure rates, and last check timestamps.
 *       Admin access required.
 *     tags: [Admin, Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Service analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
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
 *                         description: Current status of the service
 *                       lastCheck:
 *                         type: number
 *                         description: Timestamp of the last health check
 *                       failureRate:
 *                         type: number
 *                         description: Current failure rate percentage
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/metrics/performance:
 *   get:
 *     summary: Get performance metrics
 *     description: |
 *       Retrieves performance metrics including request counts, response times, and per-route statistics.
 *       Admin access required.
 *     tags: [Admin, Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Performance metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total_requests:
 *                   type: number
 *                   description: Total number of requests processed
 *                 avg_response_time:
 *                   type: number
 *                   description: Average response time in milliseconds
 *                 max_response_time:
 *                   type: number
 *                   description: Maximum response time in milliseconds
 *                 routes:
 *                   type: object
 *                   description: Per-route metrics
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       count:
 *                         type: number
 *                       avg_time:
 *                         type: number
 *                       max_time:
 *                         type: number
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/metrics/memory:
 *   get:
 *     summary: Get memory statistics
 *     description: |
 *       Retrieves memory usage statistics for the server.
 *       Admin access required.
 *     tags: [Admin, Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Memory usage statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 heap_used_mb:
 *                   type: number
 *                   description: Heap memory used in MB
 *                 heap_total_mb:
 *                   type: number
 *                   description: Total heap size in MB
 *                 rss_mb:
 *                   type: number
 *                   description: Resident set size in MB
 *                 external_mb:
 *                   type: number
 *                   description: External memory in MB
 *                 array_buffers_mb:
 *                   type: number
 *                   description: Array buffers memory in MB
 *                 uptime_hours:
 *                   type: number
 *                   description: Server uptime in hours
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/metrics/service-capacities:
 *   get:
 *     summary: Get service capacities
 *     description: |
 *       Retrieves configured capacity limits for various services.
 *       Admin access required.
 *     tags: [Admin, Metrics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Service capacity configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: number
 *                 description: Maximum capacity for a service
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 *   put:
 *     summary: Update service capacity
 *     description: |
 *       Updates the capacity configuration for a specific service.
 *       Admin access required.
 *     tags: [Admin, Metrics]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - service
 *               - capacity
 *             properties:
 *               service:
 *                 type: string
 *                 description: Service name to update
 *               capacity:
 *                 type: number
 *                 description: New capacity value
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Service capacity updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 capacities:
 *                   type: object
 *                   additionalProperties:
 *                     type: number
 *       400:
 *         description: Invalid request body
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 