/**
 * @swagger
 * tags:
 *   name: WebSocket Testing
 *   description: Endpoints for testing WebSocket services
 */

/**
 * @swagger
 * /api/admin/websocket/test:
 *   post:
 *     summary: Send test WebSocket message
 *     description: |
 *       Sends a test message to a specific WebSocket service.
 *       Requires superadmin privileges.
 *       
 *       The message will be broadcast to all connected clients for the specified socket type.
 *       All test messages are marked with `isTest: true` to identify them as test messages.
 *     tags: [Admin, WebSocket Testing]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - socketType
 *               - messageType
 *               - payload
 *             properties:
 *               socketType:
 *                 type: string
 *                 enum: [portfolio, market, contest, analytics, wallet]
 *                 description: WebSocket service to send the message to
 *               messageType:
 *                 type: string
 *                 description: Type of message to send
 *               payload:
 *                 type: object
 *                 description: Message payload specific to the socket and message type
 *     responses:
 *       200:
 *         description: Test message sent successfully
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
 *                   example: Test message sent successfully
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/websocket/status:
 *   get:
 *     summary: Get WebSocket server status
 *     description: |
 *       Retrieves status information for all WebSocket servers.
 *       Requires superadmin privileges.
 *     tags: [Admin, WebSocket Testing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: WebSocket server status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       connections:
 *                         type: number
 *                         description: Current number of client connections
 *                       uptime:
 *                         type: number
 *                         description: Server uptime in seconds
 *                       memory:
 *                         type: object
 *                         description: Memory usage statistics
 *                       errors:
 *                         type: number
 *                         description: Total error count
 *                       messagesSent:
 *                         type: number
 *                         description: Total messages sent
 *                       messagesReceived:
 *                         type: number
 *                         description: Total messages received
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/websocket/logs:
 *   get:
 *     summary: Get WebSocket test logs
 *     description: |
 *       Retrieves logs of recent WebSocket test messages.
 *       Requires superadmin privileges.
 *     tags: [Admin, WebSocket Testing]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: WebSocket test logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       socket_type:
 *                         type: string
 *                         description: WebSocket service type
 *                       message_type:
 *                         type: string
 *                         description: Message type
 *                       payload:
 *                         type: object
 *                         description: Message payload
 *                       admin:
 *                         type: string
 *                         description: Admin wallet address who sent the test
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                         description: Time when the test was sent
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 