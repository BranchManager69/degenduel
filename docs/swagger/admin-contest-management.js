/**
 * @swagger
 * tags:
 *   name: Contest Management
 *   description: Admin endpoints for managing contests
 */

/**
 * @swagger
 * /api/admin/contests/monitoring:
 *   get:
 *     summary: Monitor active contests
 *     description: |
 *       Retrieves real-time monitoring data for all active contests.
 *       Requires admin privileges.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Active contest monitoring data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 activeContests:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Contest ID
 *                       name:
 *                         type: string
 *                         description: Contest name
 *                       status:
 *                         type: string
 *                         enum: [active, enrolling, completed, evaluating, paying]
 *                       participantCount:
 *                         type: integer
 *                         description: Number of participants
 *                       totalTradeCount:
 *                         type: integer
 *                         description: Total number of trades
 *                       startTime:
 *                         type: string
 *                         format: date-time
 *                       endTime:
 *                         type: string
 *                         format: date-time
 *                       health:
 *                         type: string
 *                         enum: [healthy, warning, error]
 *                         description: Health status of the contest
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/contests/metrics:
 *   get:
 *     summary: Get contest performance metrics
 *     description: |
 *       Retrieves performance metrics for contests, including completion rates, 
 *       participation statistics, and system load during contest evaluation.
 *       Requires admin privileges.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Contest metrics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 metrics:
 *                   type: object
 *                   properties:
 *                     completionRate:
 *                       type: number
 *                       description: Percentage of contests that completed successfully
 *                     avgEvaluationTime:
 *                       type: number
 *                       description: Average time to evaluate contests in seconds
 *                     avgParticipantsPerContest:
 *                       type: number
 *                       description: Average number of participants per contest
 *                     avgTradesPerContest:
 *                       type: number
 *                       description: Average number of trades per contest
 *                     totalActiveContests:
 *                       type: integer
 *                       description: Total number of active contests
 *                     totalParticipants:
 *                       type: integer
 *                       description: Total participants across all contests
 *                     evaluationLoad:
 *                       type: object
 *                       properties:
 *                         cpu:
 *                           type: number
 *                         memory:
 *                           type: number
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/contests/history/{contestId}:
 *   get:
 *     summary: Get contest history
 *     description: |
 *       Retrieves detailed history for a specific contest, including state changes, 
 *       significant events, and system interactions.
 *       Requires admin privileges.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to retrieve history for
 *     responses:
 *       200:
 *         description: Contest history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 contestId:
 *                   type: string
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       event:
 *                         type: string
 *                         description: Event type
 *                       details:
 *                         type: object
 *                         description: Event-specific details
 *                       actor:
 *                         type: string
 *                         description: User or system component that triggered the event
 *                       stateChange:
 *                         type: object
 *                         properties:
 *                           from:
 *                             type: string
 *                           to:
 *                             type: string
 *       400:
 *         description: Invalid contest ID
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/contests/state/{contestId}:
 *   post:
 *     summary: Update contest state
 *     description: |
 *       Manually updates the state of a specific contest.
 *       Requires superadmin privileges.
 *       
 *       Warning: This is a powerful operation that can disrupt the normal contest flow.
 *       Use with caution.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newState
 *             properties:
 *               newState:
 *                 type: string
 *                 enum: [enrolling, active, evaluating, completed, cancelled, paying]
 *                 description: New state for the contest
 *               reason:
 *                 type: string
 *                 description: Reason for the manual state change
 *               force:
 *                 type: boolean
 *                 description: Force the state change even if validation fails
 *     responses:
 *       200:
 *         description: Contest state updated
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
 *                   example: Contest state updated successfully
 *                 contest:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     state:
 *                       type: string
 *                     previousState:
 *                       type: string
 *       400:
 *         description: Invalid request or contest ID
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/contests/transactions/failed/{contestId}:
 *   get:
 *     summary: Get failed contest transactions
 *     description: |
 *       Retrieves all failed transactions related to a specific contest.
 *       Requires admin privileges.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: contestId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the contest to retrieve failed transactions for
 *     responses:
 *       200:
 *         description: Failed contest transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 failedTransactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Transaction ID
 *                       type:
 *                         type: string
 *                         enum: [entry_fee, prize_payout, refund]
 *                         description: Transaction type
 *                       amount:
 *                         type: number
 *                         description: Transaction amount
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       recipient:
 *                         type: string
 *                         description: Recipient wallet address
 *                       error:
 *                         type: string
 *                         description: Error message
 *                       attempts:
 *                         type: integer
 *                         description: Number of retry attempts
 *       400:
 *         description: Invalid contest ID
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Contest not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/contests/transactions/retry/{transactionId}:
 *   post:
 *     summary: Retry failed transaction
 *     description: |
 *       Manually retries a failed contest transaction.
 *       Requires admin privileges.
 *     tags: [Admin, Contest Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: transactionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the transaction to retry
 *     responses:
 *       200:
 *         description: Transaction retry result
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
 *                   example: Transaction retry initiated
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                       enum: [pending, processing, completed, failed]
 *       400:
 *         description: Invalid transaction ID
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Server error
 */ 