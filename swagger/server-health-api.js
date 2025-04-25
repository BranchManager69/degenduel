/**
 * @swagger
 * tags:
 *   name: System
 *   description: System health and diagnostics endpoints
 */

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Get the health status of the server
 *     description: |
 *       Returns detailed health information about the server, including database connections,
 *       service statuses, WebSocket connections, and memory usage.
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                   description: Server status
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Current server time
 *                 uptime:
 *                   type: integer
 *                   description: Server uptime in seconds
 *                 databases:
 *                   type: object
 *                   properties:
 *                     postgresql:
 *                       type: string
 *                       example: connected
 *                 services:
 *                   type: object
 *                   description: Status of various services
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       initialized:
 *                         type: boolean
 *                       operational:
 *                         type: boolean
 *                       lastError:
 *                         type: string
 *                 websockets:
 *                   type: object
 *                   description: Status of WebSocket servers
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       connected:
 *                         type: integer
 *                         description: Number of connected clients
 *                       status:
 *                         type: string
 *                         enum: [ready, initializing]
 *                 memory:
 *                   type: object
 *                   description: Memory usage statistics
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: error
 *                 error:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */

/**
 * @swagger
 * /api/marketData/latest:
 *   get:
 *     summary: Get latest market data
 *     description: |
 *       Forwards the request to the v2 token market data endpoint and returns the latest market data.
 *       This is a convenience endpoint that proxies to `/api/v2/tokens/marketData/latest`.
 *     tags: [Market Data]
 *     responses:
 *       200:
 *         description: Latest market data for all tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 tokens:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       symbol:
 *                         type: string
 *                       price:
 *                         type: number
 *                       change_24h:
 *                         type: number
 *                       volume_24h:
 *                         type: number
 *       500:
 *         description: Server error
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
 *                   example: Failed to fetch market data
 */ 