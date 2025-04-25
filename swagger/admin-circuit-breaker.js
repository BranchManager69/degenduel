/**
 * @swagger
 * tags:
 *   name: Circuit Breaker
 *   description: Endpoints for managing circuit breakers
 */

/**
 * @swagger
 * /api/admin/circuit-breaker/status:
 *   get:
 *     summary: Get circuit breaker status
 *     description: |
 *       Retrieves the status of all circuit breakers in the system.
 *       Requires admin privileges.
 *     tags: [Admin, Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Circuit breaker status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 circuits:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Circuit breaker name
 *                       status:
 *                         type: string
 *                         enum: [closed, open, half-open]
 *                         description: Current circuit status
 *                       failureCount:
 *                         type: number
 *                         description: Current failure count
 *                       failureThreshold:
 *                         type: number
 *                         description: Failure threshold that triggers opening
 *                       resetTimeout:
 *                         type: number
 *                         description: Time in ms until the circuit attempts to reset
 *                       lastFailure:
 *                         type: string
 *                         format: date-time
 *                         description: Timestamp of the last failure
 *                       lastTripped:
 *                         type: string
 *                         format: date-time
 *                         description: Timestamp when the circuit was last tripped
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/circuit-breaker/reset/{name}:
 *   post:
 *     summary: Reset a circuit breaker
 *     description: |
 *       Manually resets a specific circuit breaker to the closed state.
 *       Requires admin privileges.
 *     tags: [Admin, Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the circuit breaker to reset
 *     responses:
 *       200:
 *         description: Circuit breaker reset
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
 *                   example: Circuit breaker reset successfully
 *                 circuit:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [closed, open, half-open]
 *       400:
 *         description: Circuit breaker not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/circuit-breaker/trip/{name}:
 *   post:
 *     summary: Manually trip a circuit breaker
 *     description: |
 *       Manually trips a specific circuit breaker to the open state.
 *       Requires admin privileges.
 *     tags: [Admin, Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the circuit breaker to trip
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for manually tripping the circuit
 *     responses:
 *       200:
 *         description: Circuit breaker tripped
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
 *                   example: Circuit breaker tripped successfully
 *                 circuit:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [closed, open, half-open]
 *       400:
 *         description: Circuit breaker not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/circuit-breaker/config:
 *   get:
 *     summary: Get circuit breaker configurations
 *     description: |
 *       Retrieves the configuration of all circuit breakers in the system.
 *       Requires admin privileges.
 *     tags: [Admin, Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Circuit breaker configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 configs:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       failureThreshold:
 *                         type: number
 *                       resetTimeout:
 *                         type: number
 *                       halfOpenRetries:
 *                         type: number
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 *   put:
 *     summary: Update circuit breaker configuration
 *     description: |
 *       Updates the configuration of a specific circuit breaker.
 *       Requires admin privileges.
 *     tags: [Admin, Circuit Breaker]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Circuit breaker name
 *               failureThreshold:
 *                 type: number
 *                 description: Number of failures before the circuit trips
 *               resetTimeout:
 *                 type: number
 *                 description: Time in ms until the circuit attempts to reset
 *               halfOpenRetries:
 *                 type: number
 *                 description: Number of successful retries needed to close the circuit
 *     responses:
 *       200:
 *         description: Circuit breaker configuration updated
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
 *                   example: Circuit breaker configuration updated
 *                 config:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     failureThreshold:
 *                       type: number
 *                     resetTimeout:
 *                       type: number
 *                     halfOpenRetries:
 *                       type: number
 *       400:
 *         description: Invalid configuration or circuit breaker not found
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 