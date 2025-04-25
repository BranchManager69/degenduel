/**
 * @swagger
 * tags:
 *   name: WebSockets
 *   description: WebSocket API for real-time communication
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     WebSocketMessage:
 *       type: object
 *       description: Base message format for all WebSocket communication
 *       required:
 *         - type
 *       properties:
 *         type:
 *           type: string
 *           description: Message type identifier
 *         sequence:
 *           type: number
 *           description: Monotonically increasing sequence number
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: ISO timestamp of when the message was sent
 *         data:
 *           type: object
 *           description: Message payload (varies by message type)
 *     
 *     WebSocketError:
 *       type: object
 *       description: Error message format
 *       properties:
 *         type:
 *           type: string
 *           example: "ERROR"
 *         code:
 *           type: number
 *           description: Error code
 *           example: 4001
 *         message:
 *           type: string
 *           description: Error description
 *           example: "Authentication failed"
 */

/**
 * @swagger
 * /api/superadmin/ws/monitor:
 *   get:
 *     summary: WebSocket Monitor endpoint
 *     description: |
 *       Establishes a WebSocket connection for monitoring all WebSocket services.
 *       Requires superadmin or admin privileges.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/superadmin/ws/monitor
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Admin]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 * 
 * components:
 *   schemas:
 *     MonitorServiceMessage:
 *       type: object
 *       description: Messages from the Monitor WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - system:health
 *                 - services_status
 *                 - service_update
 *                 - service:metrics
 *                 - alert
 *                 - ERROR
 *     
 *     SystemHealthPayload:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [operational, degraded, error]
 *           description: Current system health status
 *         activeIncidents:
 *           type: number
 *           description: Number of active incidents
 *         lastUpdate:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *     
 *     ServiceStatusPayload:
 *       type: array
 *       items:
 *         type: object
 *         properties:
 *           name:
 *             type: string
 *             description: Service name
 *           status:
 *             type: string
 *             description: Service status
 *           metrics:
 *             type: object
 *             properties:
 *               totalConnections:
 *                 type: number
 *               activeSubscriptions:
 *                 type: number
 *               messageCount:
 *                 type: number
 *               errorCount:
 *                 type: number
 *               cacheHitRate:
 *                 type: number
 *               averageLatency:
 *                 type: number
 *               lastUpdate:
 *                 type: string
 *                 format: date-time
 *           performance:
 *             type: object
 *             properties:
 *               messageRate:
 *                 type: number
 *               errorRate:
 *                 type: number
 *               latencyTrend:
 *                 type: array
 *                 items:
 *                   type: number
 *     
 *     ServiceControlRequest:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           example: "service_control"
 *         service:
 *           type: string
 *           description: Service name to control
 *         action:
 *           type: string
 *           enum: [restart, stop]
 *           description: Action to perform on the service
 */

/**
 * @swagger
 * /api/v1/ws/circuit-breaker:
 *   get:
 *     summary: Circuit Breaker WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for circuit breaker status and control.
 *       Requires admin privileges.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/circuit-breaker
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Admin]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 * 
 * components:
 *   schemas:
 *     CircuitBreakerMessage:
 *       type: object
 *       description: Messages from the Circuit Breaker WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - circuit_status
 *                 - circuit_update
 *                 - circuit_tripped
 *                 - ERROR
 *     
 *     CircuitStatusPayload:
 *       type: object
 *       properties:
 *         circuits:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Circuit name
 *               status:
 *                 type: string
 *                 enum: [closed, open, half-open]
 *                 description: Circuit status
 *               failureCount:
 *                 type: number
 *                 description: Current failure count
 *               lastFailure:
 *                 type: string
 *                 format: date-time
 *                 description: Last failure timestamp
 *               resetTimeout:
 *                 type: number
 *                 description: Time until circuit reset in ms
 */

/**
 * @swagger
 * /api/v1/ws/market:
 *   get:
 *     summary: Market Data WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time market data.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/market
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Market Data]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     MarketDataMessage:
 *       type: object
 *       description: Messages from the Market Data WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - MARKET_PRICE
 *                 - MARKET_VOLUME
 *                 - MARKET_SENTIMENT
 *                 - ERROR
 *     
 *     MarketPricePayload:
 *       type: object
 *       properties:
 *         symbol:
 *           type: string
 *           description: Token symbol
 *         price:
 *           type: number
 *           description: Current price
 *         change_24h:
 *           type: number
 *           description: 24-hour price change percentage
 *         volume_24h:
 *           type: number
 *           description: 24-hour trading volume
 */

/**
 * @swagger
 * /api/v1/ws/portfolio:
 *   get:
 *     summary: Portfolio WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time portfolio updates.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/portfolio
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Portfolio]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     PortfolioMessage:
 *       type: object
 *       description: Messages from the Portfolio WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - PORTFOLIO_UPDATED
 *                 - TRADE_EXECUTED
 *                 - ERROR
 *     
 *     PortfolioUpdatePayload:
 *       type: object
 *       properties:
 *         tokens:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               symbol:
 *                 type: string
 *                 description: Token symbol
 *               amount:
 *                 type: number
 *                 description: Token amount
 *               value:
 *                 type: number
 *                 description: Current value in USD
 *         total_value:
 *           type: number
 *           description: Total portfolio value
 *         performance_24h:
 *           type: number
 *           description: 24-hour performance percentage
 */

/**
 * @swagger
 * /api/v1/ws/wallet:
 *   get:
 *     summary: Wallet WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time wallet updates.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/wallet
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Wallet]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     WalletMessage:
 *       type: object
 *       description: Messages from the Wallet WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - WALLET_UPDATED
 *                 - TRANSFER_COMPLETE
 *                 - ERROR
 *     
 *     WalletUpdatePayload:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           description: Wallet type
 *         publicKey:
 *           type: string
 *           description: Wallet public key
 *         balance:
 *           type: number
 *           description: Wallet balance
 */

/**
 * @swagger
 * /api/v1/ws/contest:
 *   get:
 *     summary: Contest WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time contest updates.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/contest
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Contest]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     ContestMessage:
 *       type: object
 *       description: Messages from the Contest WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - CONTEST_UPDATED
 *                 - LEADERBOARD_UPDATED
 *                 - ERROR
 *     
 *     ContestUpdatePayload:
 *       type: object
 *       properties:
 *         contest_id:
 *           type: string
 *           description: Contest ID
 *         status:
 *           type: string
 *           description: Contest status
 *         current_round:
 *           type: number
 *           description: Current contest round
 *         time_remaining:
 *           type: number
 *           description: Time remaining in current round (seconds)
 */

/**
 * @swagger
 * /api/v1/ws/token-data:
 *   get:
 *     summary: Token Data WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time token data.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/token-data
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Token Data]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     TokenDataMessage:
 *       type: object
 *       description: Messages from the Token Data WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - token_update
 *                 - subscription
 *                 - connection
 *                 - error
 *     
 *     TokenUpdatePayload:
 *       type: object
 *       properties:
 *         address:
 *           type: string
 *           description: Token address
 *         price:
 *           type: string
 *           description: Current price (decimal string)
 *         marketCap:
 *           type: string
 *           description: Market capitalization (decimal string)
 *         volume:
 *           type: object
 *           properties:
 *             h24:
 *               type: string
 *               description: 24-hour volume
 *             h1:
 *               type: string
 *               description: 1-hour volume
 *             m5:
 *               type: string
 *               description: 5-minute volume
 */

/**
 * @swagger
 * /api/v1/ws/notifications:
 *   get:
 *     summary: User Notification WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time user notifications.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/notifications
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token.
 *     tags: [WebSockets, Notifications]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 * 
 * components:
 *   schemas:
 *     NotificationMessage:
 *       type: object
 *       description: Messages from the User Notification WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - notification
 *                 - notification_read
 *                 - notifications_clear
 *                 - ERROR
 *     
 *     NotificationPayload:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Notification ID
 *         title:
 *           type: string
 *           description: Notification title
 *         message:
 *           type: string
 *           description: Notification message
 *         type:
 *           type: string
 *           description: Notification type
 *         read:
 *           type: boolean
 *           description: Whether the notification has been read
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 */

/**
 * @swagger
 * /api/v1/ws/analytics:
 *   get:
 *     summary: Analytics WebSocket endpoint
 *     description: |
 *       Establishes a WebSocket connection for real-time analytics data.
 *       Requires admin privileges.
 *       
 *       ### Connection
 *       ```
 *       ws://[base-url]/api/v1/ws/analytics
 *       ```
 *       
 *       ### Authentication
 *       Authentication is required. Use a valid JWT token with admin privileges.
 *     tags: [WebSockets, Admin, Analytics]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       101:
 *         description: WebSocket connection established
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 * 
 * components:
 *   schemas:
 *     AnalyticsMessage:
 *       type: object
 *       description: Messages from the Analytics WebSocket service
 *       allOf:
 *         - $ref: '#/components/schemas/WebSocketMessage'
 *         - type: object
 *           properties:
 *             type:
 *               enum:
 *                 - user_activity_update
 *                 - system_metrics
 *                 - ERROR
 *     
 *     UserActivityPayload:
 *       type: object
 *       properties:
 *         users:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               wallet_address:
 *                 type: string
 *                 description: User wallet address
 *               status:
 *                 type: string
 *                 description: User activity status
 *               last_activity:
 *                 type: string
 *                 format: date-time
 *                 description: Last activity timestamp
 */ 