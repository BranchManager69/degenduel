/**
 * @swagger
 * tags:
 *   name: Analytics Dashboard
 *   description: Admin endpoints for accessing real-time analytics and user journey data
 */

/**
 * @swagger
 * /api/admin/analytics-dashboard/realtime:
 *   get:
 *     summary: Get real-time analytics
 *     description: |
 *       Retrieves comprehensive real-time analytics data for the platform dashboard.
 *       Includes user activity, transactions, system performance, and key metrics.
 *       Requires superadmin privileges.
 *     tags: [Admin, Analytics Dashboard]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Real-time analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   description: Server timestamp when data was collected
 *                 userMetrics:
 *                   type: object
 *                   properties:
 *                     activeUsers:
 *                       type: integer
 *                       description: Currently active users
 *                     newUsers24h:
 *                       type: integer
 *                       description: New users in the past 24 hours
 *                     returnRate:
 *                       type: number
 *                       description: User return rate percentage
 *                     userGrowth:
 *                       type: object
 *                       properties:
 *                         daily:
 *                           type: number
 *                           description: Daily growth rate percentage
 *                         weekly:
 *                           type: number
 *                           description: Weekly growth rate percentage
 *                         monthly:
 *                           type: number
 *                           description: Monthly growth rate percentage
 *                 contestMetrics:
 *                   type: object
 *                   properties:
 *                     activeContests:
 *                       type: integer
 *                       description: Currently active contests
 *                     participantsCount:
 *                       type: integer
 *                       description: Total participants in active contests
 *                     avgParticipantsPerContest:
 *                       type: number
 *                       description: Average participants per contest
 *                     contestCompletionRate:
 *                       type: number
 *                       description: Percentage of contests completing successfully
 *                 tradeMetrics:
 *                   type: object
 *                   properties:
 *                     tradesLast24h:
 *                       type: integer
 *                       description: Number of trades in the last 24 hours
 *                     tradesPerMinute:
 *                       type: number
 *                       description: Average trades per minute
 *                     totalVolume24h:
 *                       type: number
 *                       description: Total trading volume in the last 24 hours
 *                     popularTokens:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           volume:
 *                             type: number
 *                           trades:
 *                             type: integer
 *                 systemHealth:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [healthy, warning, critical]
 *                     responseTime:
 *                       type: number
 *                       description: Average API response time in ms
 *                     errorRate:
 *                       type: number
 *                       description: Error rate percentage
 *                     serviceAvailability:
 *                       type: number
 *                       description: System availability percentage
 *                 recentAlerts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       severity:
 *                         type: string
 *                         enum: [info, warning, error, critical]
 *                       message:
 *                         type: string
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       service:
 *                         type: string
 *                         description: Affected service
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/analytics-dashboard/user/{wallet}/journey:
 *   get:
 *     summary: Get user journey data
 *     description: |
 *       Retrieves comprehensive journey and engagement data for a specific user.
 *       Includes user activity timeline, interactions, preferences, and behavior analytics.
 *       Requires superadmin privileges.
 *     tags: [Admin, Analytics Dashboard]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *         description: User's wallet address
 *     responses:
 *       200:
 *         description: User journey data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 user:
 *                   type: object
 *                   properties:
 *                     wallet:
 *                       type: string
 *                       description: User's wallet address
 *                     joinedAt:
 *                       type: string
 *                       format: date-time
 *                       description: When the user first joined
 *                     lastActive:
 *                       type: string
 *                       format: date-time
 *                       description: When the user was last active
 *                     status:
 *                       type: string
 *                       enum: [active, inactive, new, returning]
 *                       description: Current user status
 *                 activityTimeline:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       event:
 *                         type: string
 *                         description: Event type
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       details:
 *                         type: object
 *                         description: Event-specific details
 *                 engagementMetrics:
 *                   type: object
 *                   properties:
 *                     sessionCount:
 *                       type: integer
 *                       description: Total number of sessions
 *                     avgSessionDuration:
 *                       type: number
 *                       description: Average session duration in minutes
 *                     contestParticipation:
 *                       type: integer
 *                       description: Number of contests participated in
 *                     totalTrades:
 *                       type: integer
 *                       description: Total number of trades made
 *                     completionRate:
 *                       type: number
 *                       description: Percentage of contests completed
 *                     returnFrequency:
 *                       type: number
 *                       description: Average days between returns
 *                 behaviorAnalysis:
 *                   type: object
 *                   properties:
 *                     preferredTokens:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           symbol:
 *                             type: string
 *                           tradeCount:
 *                             type: integer
 *                     tradingPattern:
 *                       type: string
 *                       enum: [day_trader, swing_trader, hodler, mixed]
 *                       description: Identified trading pattern
 *                     riskAppetite:
 *                       type: string
 *                       enum: [conservative, moderate, aggressive]
 *                       description: Risk appetite based on trading behavior
 *                     timeOfDayPreference:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           hour:
 *                             type: integer
 *                           activityLevel:
 *                             type: number
 *                 acquisitionData:
 *                   type: object
 *                   properties:
 *                     source:
 *                       type: string
 *                       description: User acquisition source
 *                     referrer:
 *                       type: string
 *                       description: Referrer information if available
 *                     campaign:
 *                       type: string
 *                       description: Marketing campaign if applicable
 *                     initialInteraction:
 *                       type: object
 *                       description: Details about the user's first interaction
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */ 