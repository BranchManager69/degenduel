/**
 * @swagger
 * tags:
 *   name: Token Sync
 *   description: Admin endpoints for monitoring and managing token synchronization
 */

/**
 * @swagger
 * /api/admin/token-sync/status:
 *   get:
 *     summary: Get token sync status
 *     description: |
 *       Retrieves comprehensive status information about the token synchronization service.
 *       Includes metrics on sync progress, token counts, and recent activities.
 *       Requires admin privileges.
 *     tags: [Admin, Token Sync]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token sync status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 syncStatus:
 *                   type: object
 *                   properties:
 *                     lastFullSync:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp of the last completed full sync
 *                     currentlySyncing:
 *                       type: boolean
 *                       description: Whether a sync operation is currently in progress
 *                     syncProgress:
 *                       type: number
 *                       description: Percentage of completion for current sync operation
 *                     syncStartTime:
 *                       type: string
 *                       format: date-time
 *                       description: When the current sync operation started
 *                     syncType:
 *                       type: string
 *                       enum: [full, incremental, metadata-only]
 *                       description: Type of synchronization being performed
 *                 tokenStats:
 *                   type: object
 *                   properties:
 *                     totalTokens:
 *                       type: integer
 *                       description: Total number of tokens in the database
 *                     newTokens24h:
 *                       type: integer
 *                       description: New tokens added in the last 24 hours
 *                     updatedTokens24h:
 *                       type: integer
 *                       description: Tokens updated in the last 24 hours
 *                     failedTokens24h:
 *                       type: integer
 *                       description: Tokens that failed to sync in the last 24 hours
 *                 syncErrors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       error:
 *                         type: string
 *                         description: Error message
 *                       tokenCount:
 *                         type: integer
 *                         description: Number of tokens affected by this error
 *                       severity:
 *                         type: string
 *                         enum: [warning, error, critical]
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/token-sync/validation-stats:
 *   get:
 *     summary: Get token validation statistics
 *     description: |
 *       Retrieves statistics about token validation success and failure rates.
 *       Includes information about validation criteria, common failures, and data quality.
 *       Requires admin privileges.
 *     tags: [Admin, Token Sync]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token validation statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 validationStats:
 *                   type: object
 *                   properties:
 *                     totalValidated:
 *                       type: integer
 *                       description: Total number of tokens validated
 *                     passRate:
 *                       type: number
 *                       description: Percentage of tokens that passed validation
 *                     failCategories:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                       description: Count of failures by category
 *                     validationCriteria:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             description: Name of the validation rule
 *                           description:
 *                             type: string
 *                             description: Description of what is being validated
 *                           passRate:
 *                             type: number
 *                             description: Percentage of tokens passing this rule
 *                     dataSourceQuality:
 *                       type: object
 *                       additionalProperties:
 *                         type: number
 *                       description: Quality score by data source
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/token-sync/metadata-quality:
 *   get:
 *     summary: Get token metadata quality metrics
 *     description: |
 *       Retrieves detailed quality metrics for token metadata across the database.
 *       Includes completeness, consistency, and accuracy scores for various metadata attributes.
 *       Requires admin privileges.
 *     tags: [Admin, Token Sync]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token metadata quality metrics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 overallQuality:
 *                   type: number
 *                   description: Overall metadata quality score (0-100)
 *                 attributeScores:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: number
 *                       description: Quality score for token names
 *                     symbol:
 *                       type: number
 *                       description: Quality score for token symbols
 *                     logoURL:
 *                       type: number
 *                       description: Quality score for logo URLs
 *                     decimals:
 *                       type: number
 *                       description: Quality score for decimal precision
 *                     description:
 *                       type: number
 *                       description: Quality score for descriptions
 *                     marketData:
 *                       type: number
 *                       description: Quality score for market data
 *                     socialProfiles:
 *                       type: number
 *                       description: Quality score for social profile links
 *                 incompleteData:
 *                   type: object
 *                   properties:
 *                     missingAttributes:
 *                       type: object
 *                       additionalProperties:
 *                         type: integer
 *                       description: Count of tokens missing each attribute
 *                     recommendedActions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           action:
 *                             type: string
 *                             description: Recommended action to improve data quality
 *                           impact:
 *                             type: string
 *                             enum: [low, medium, high]
 *                             description: Potential impact of the action
 *                           affectedTokens:
 *                             type: integer
 *                             description: Number of tokens that would be affected
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/token-sync/health:
 *   get:
 *     summary: Get token sync service health
 *     description: |
 *       Retrieves health information about the token synchronization service.
 *       Includes system status, resource utilization, and service dependencies.
 *       Requires admin privileges.
 *     tags: [Admin, Token Sync]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token sync service health information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 serviceHealth:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [healthy, degraded, unhealthy]
 *                       description: Overall health status of the service
 *                     uptime:
 *                       type: number
 *                       description: Service uptime in seconds
 *                     lastRestart:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp of the last service restart
 *                     resourceUtilization:
 *                       type: object
 *                       properties:
 *                         cpu:
 *                           type: number
 *                           description: CPU utilization percentage
 *                         memory:
 *                           type: number
 *                           description: Memory utilization percentage
 *                         diskSpace:
 *                           type: number
 *                           description: Storage utilization percentage
 *                     rateLimits:
 *                       type: object
 *                       properties:
 *                         apiCallsRemaining:
 *                           type: integer
 *                           description: Remaining API calls available to external services
 *                         resetTime:
 *                           type: string
 *                           format: date-time
 *                           description: When the rate limit will reset
 *                     dependencies:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                             description: Dependency name
 *                           status:
 *                             type: string
 *                             enum: [operational, degraded, down]
 *                             description: Status of the dependency
 *                           responseTime:
 *                             type: number
 *                             description: Average response time in ms
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 