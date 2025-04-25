/**
 * @swagger
 * tags:
 *   name: Liquidity Management
 *   description: Admin endpoints for managing system liquidity (formerly called faucet management)
 */

/**
 * @swagger
 * /api/admin/faucet/dashboard:
 *   get:
 *     summary: Get liquidity management dashboard
 *     description: |
 *       Retrieves dashboard overview data for the liquidity management system.
 *       Includes information about available funds, transaction history statistics, and system health.
 *       Requires admin privileges.
 *       
 *       Note: This endpoint is also available at `/api/admin/liquidity/dashboard` for consistency.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liquidity management dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 dashboard:
 *                   type: object
 *                   properties:
 *                     totalAvailableLiquidity:
 *                       type: number
 *                       description: Total available funds across all managed wallets (in SOL)
 *                     recentTransactions:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                           description: Number of recent transactions
 *                         volume:
 *                           type: number
 *                           description: Total volume of recent transactions (in SOL)
 *                         successRate:
 *                           type: number
 *                           description: Percentage of successful transactions
 *                     systemHealth:
 *                       type: string
 *                       enum: [healthy, warning, critical]
 *                       description: Overall health status of the liquidity system
 *                     alerts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           severity:
 *                             type: string
 *                             enum: [info, warning, error]
 *                           message:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/liquidity/dashboard:
 *   get:
 *     summary: Get liquidity management dashboard (alias)
 *     description: |
 *       Alias for `/api/admin/faucet/dashboard`.
 *       Retrieves dashboard overview data for the liquidity management system.
 *       Includes information about available funds, transaction history statistics, and system health.
 *       Requires admin privileges.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         $ref: '#/paths/~1api~1admin~1faucet~1dashboard/get/responses/200'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/faucet/wallet-status:
 *   get:
 *     summary: Get liquidity wallet status
 *     description: |
 *       Retrieves status information for all liquidity management wallets.
 *       Includes balances, transaction counts, and health metrics.
 *       Requires admin privileges.
 *       
 *       Note: This endpoint is also available at `/api/admin/liquidity/wallet-status` for consistency.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Liquidity wallet status data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 wallets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                         description: Wallet address
 *                       name:
 *                         type: string
 *                         description: Friendly name for the wallet
 *                       balance:
 *                         type: number
 *                         description: Current wallet balance (in SOL)
 *                       transactionCount:
 *                         type: integer
 *                         description: Number of transactions processed by this wallet
 *                       lastTransaction:
 *                         type: string
 *                         format: date-time
 *                         description: Timestamp of most recent transaction
 *                       status:
 *                         type: string
 *                         enum: [active, warning, low_funds, inactive]
 *                         description: Current status of the wallet
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/liquidity/wallet-status:
 *   get:
 *     summary: Get liquidity wallet status (alias)
 *     description: |
 *       Alias for `/api/admin/faucet/wallet-status`.
 *       Retrieves status information for all liquidity management wallets.
 *       Includes balances, transaction counts, and health metrics.
 *       Requires admin privileges.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         $ref: '#/paths/~1api~1admin~1faucet~1wallet-status/get/responses/200'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/faucet/transactions:
 *   get:
 *     summary: Get liquidity transactions
 *     description: |
 *       Retrieves a paginated list of recent liquidity management transactions.
 *       Includes details about transaction types, amounts, recipients, and statuses.
 *       Requires admin privileges.
 *       
 *       Note: This endpoint is also available at `/api/admin/liquidity/transactions` for consistency.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of transactions per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, successful, failed, pending]
 *         description: Filter transactions by status
 *     responses:
 *       200:
 *         description: Paginated transaction list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 total:
 *                   type: integer
 *                   description: Total number of transactions matching filters
 *                 page:
 *                   type: integer
 *                   description: Current page number
 *                 totalPages:
 *                   type: integer
 *                   description: Total number of pages
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Transaction ID
 *                       signature:
 *                         type: string
 *                         description: Solana transaction signature
 *                       type:
 *                         type: string
 *                         enum: [contest_funding, user_withdrawal, system_rebalance, recovery]
 *                         description: Transaction type
 *                       amount:
 *                         type: number
 *                         description: Transaction amount in SOL
 *                       sourceWallet:
 *                         type: string
 *                         description: Source wallet address
 *                       destinationWallet:
 *                         type: string
 *                         description: Destination wallet address
 *                       status:
 *                         type: string
 *                         enum: [successful, failed, pending]
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       errorMessage:
 *                         type: string
 *                         description: Error message if transaction failed
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/liquidity/transactions:
 *   get:
 *     summary: Get liquidity transactions (alias)
 *     description: |
 *       Alias for `/api/admin/faucet/transactions`.
 *       Retrieves a paginated list of recent liquidity management transactions.
 *       Includes details about transaction types, amounts, recipients, and statuses.
 *       Requires admin privileges.
 *     tags: [Admin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Number of transactions per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, successful, failed, pending]
 *         description: Filter transactions by status
 *     responses:
 *       200:
 *         $ref: '#/paths/~1api~1admin~1faucet~1transactions/get/responses/200'
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/superadmin/liquidity/balance:
 *   get:
 *     summary: Get detailed liquidity balance information
 *     description: |
 *       Retrieves detailed balance information across all liquidity wallets
 *       with allocation statistics and recommendations.
 *       Requires superadmin privileges.
 *     tags: [SuperAdmin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Detailed liquidity balance information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalBalance:
 *                   type: number
 *                   description: Total balance across all liquidity wallets (in SOL)
 *                 balanceBreakdown:
 *                   type: object
 *                   properties:
 *                     primary:
 *                       type: number
 *                       description: Balance in primary wallets
 *                     reserve:
 *                       type: number
 *                       description: Balance in reserve wallets
 *                     contest:
 *                       type: number
 *                       description: Balance allocated to contests
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         enum: [rebalance, add_funds, optimize]
 *                       importance:
 *                         type: string
 *                         enum: [low, medium, high, critical]
 *                       description:
 *                         type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/superadmin/liquidity/config:
 *   post:
 *     summary: Configure liquidity management system
 *     description: |
 *       Updates configuration settings for the liquidity management system.
 *       Requires superadmin privileges.
 *     tags: [SuperAdmin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               minimumWalletBalance:
 *                 type: number
 *                 description: Minimum balance to maintain in operational wallets (in SOL)
 *               lowBalanceThreshold:
 *                 type: number
 *                 description: Threshold to trigger low balance warnings (in SOL)
 *               rebalanceThreshold:
 *                 type: number
 *                 description: Balance threshold to trigger automatic rebalancing (in SOL)
 *               enableAutomaticRebalance:
 *                 type: boolean
 *                 description: Whether to enable automatic rebalancing between wallets
 *               liquidityReservePercentage:
 *                 type: number
 *                 description: Percentage of funds to keep in reserve wallets
 *     responses:
 *       200:
 *         description: Configuration updated successfully
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
 *                   example: Liquidity management configuration updated
 *                 config:
 *                   type: object
 *                   description: The updated configuration
 *       400:
 *         description: Invalid configuration values
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/superadmin/liquidity/recover:
 *   post:
 *     summary: Recover funds from contest wallets
 *     description: |
 *       Initiates a recovery operation to reclaim unused funds from contest wallets.
 *       This is typically used after contests end to ensure proper liquidity management.
 *       Requires superadmin privileges.
 *     tags: [SuperAdmin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contestIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IDs of contests to recover funds from (optional, all eligible if omitted)
 *               destinationWallet:
 *                 type: string
 *                 description: Wallet address to send recovered funds to (optional, uses default if omitted)
 *     responses:
 *       200:
 *         description: Fund recovery operation initiated
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
 *                   example: Recovery operation initiated
 *                 recoveryId:
 *                   type: string
 *                   description: ID of the recovery operation for tracking
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/superadmin/liquidity/recover-nuclear:
 *   post:
 *     summary: Emergency liquidity recovery
 *     description: |
 *       Initiates an emergency recovery operation to reclaim all available funds from system wallets.
 *       This is an extreme measure only to be used in system-critical situations.
 *       Requires superadmin privileges and additional confirmation.
 *     tags: [SuperAdmin, Liquidity Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - confirmationCode
 *               - destinationWallet
 *             properties:
 *               confirmationCode:
 *                 type: string
 *                 description: Special confirmation code required for this operation
 *               destinationWallet:
 *                 type: string
 *                 description: External wallet address to send all recovered funds to
 *               reason:
 *                 type: string
 *                 description: Detailed reason for performing this emergency action
 *     responses:
 *       200:
 *         description: Emergency recovery operation initiated
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
 *                   example: Emergency recovery initiated
 *                 emergencyId:
 *                   type: string
 *                   description: ID of the emergency operation for tracking
 *       400:
 *         description: Invalid request or confirmation code
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 