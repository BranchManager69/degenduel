/**
 * @swagger
 * tags:
 *   name: Wallet Management
 *   description: Admin endpoints for managing system wallets and transactions
 */

/**
 * @swagger
 * /api/admin/wallets/contest-wallets:
 *   get:
 *     summary: Get contest wallets
 *     description: |
 *       Retrieves a list of all contest-related wallets in the system.
 *       Includes wallet addresses, balances, associated contests, and current status.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of contest wallets
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
 *                         description: Solana wallet address
 *                       contestId:
 *                         type: string
 *                         description: Associated contest ID
 *                       contestName:
 *                         type: string
 *                         description: Name of the associated contest
 *                       balance:
 *                         type: number
 *                         description: Current wallet SOL balance
 *                       status:
 *                         type: string
 *                         enum: [active, completed, expired]
 *                         description: Current status of the wallet
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       lastActivity:
 *                         type: string
 *                         format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/wallet/{address}:
 *   get:
 *     summary: Get wallet details
 *     description: |
 *       Retrieves detailed information about a specific wallet.
 *       Includes balance, transaction history, associated entities, and metadata.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
 *     responses:
 *       200:
 *         description: Wallet details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     address:
 *                       type: string
 *                       description: Solana wallet address
 *                     type:
 *                       type: string
 *                       enum: [contest, system, user, other]
 *                       description: Type of wallet
 *                     balance:
 *                       type: object
 *                       properties:
 *                         sol:
 *                           type: number
 *                           description: SOL balance
 *                         tokens:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               mint:
 *                                 type: string
 *                               symbol:
 *                                 type: string
 *                               amount:
 *                                 type: number
 *                     metadata:
 *                       type: object
 *                       description: Additional metadata about the wallet
 *                     recentTransactions:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           signature:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                           type:
 *                             type: string
 *                           amount:
 *                             type: number
 *                           status:
 *                             type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/transfer/sol:
 *   post:
 *     summary: Transfer SOL between wallets
 *     description: |
 *       Initiates a transfer of SOL from one wallet to another.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromWallet
 *               - toWallet
 *               - amount
 *             properties:
 *               fromWallet:
 *                 type: string
 *                 description: Source wallet address
 *               toWallet:
 *                 type: string
 *                 description: Destination wallet address
 *               amount:
 *                 type: number
 *                 description: Amount of SOL to transfer
 *               reason:
 *                 type: string
 *                 description: Reason for the transfer (for auditing)
 *     responses:
 *       200:
 *         description: Transfer initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     signature:
 *                       type: string
 *                       description: Solana transaction signature
 *                     status:
 *                       type: string
 *                       enum: [confirmed, processing]
 *                     fromWallet:
 *                       type: string
 *                     toWallet:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or insufficient funds
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/transfer/token:
 *   post:
 *     summary: Transfer tokens between wallets
 *     description: |
 *       Initiates a transfer of SPL tokens from one wallet to another.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromWallet
 *               - toWallet
 *               - tokenMint
 *               - amount
 *             properties:
 *               fromWallet:
 *                 type: string
 *                 description: Source wallet address
 *               toWallet:
 *                 type: string
 *                 description: Destination wallet address
 *               tokenMint:
 *                 type: string
 *                 description: SPL token mint address
 *               amount:
 *                 type: number
 *                 description: Amount of tokens to transfer
 *               reason:
 *                 type: string
 *                 description: Reason for the transfer (for auditing)
 *     responses:
 *       200:
 *         description: Token transfer initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transaction:
 *                   type: object
 *                   properties:
 *                     signature:
 *                       type: string
 *                       description: Solana transaction signature
 *                     status:
 *                       type: string
 *                       enum: [confirmed, processing]
 *                     fromWallet:
 *                       type: string
 *                     toWallet:
 *                       type: string
 *                     tokenMint:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or insufficient token balance
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/mass-transfer/sol:
 *   post:
 *     summary: Perform mass SOL transfer
 *     description: |
 *       Initiates multiple SOL transfers from a single source wallet to multiple destinations.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromWallet
 *               - transfers
 *             properties:
 *               fromWallet:
 *                 type: string
 *                 description: Source wallet address
 *               transfers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - toWallet
 *                     - amount
 *                   properties:
 *                     toWallet:
 *                       type: string
 *                       description: Destination wallet address
 *                     amount:
 *                       type: number
 *                       description: Amount of SOL to transfer
 *                     reference:
 *                       type: string
 *                       description: Optional reference or memo for this transfer
 *               reason:
 *                 type: string
 *                 description: Overall reason for the mass transfer
 *     responses:
 *       200:
 *         description: Mass transfer initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transferId:
 *                   type: string
 *                   description: Unique ID for tracking this mass transfer
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       signature:
 *                         type: string
 *                         description: Solana transaction signature
 *                       status:
 *                         type: string
 *                         enum: [confirmed, processing, failed]
 *                       toWallet:
 *                         type: string
 *                       amount:
 *                         type: number
 *       400:
 *         description: Invalid request or insufficient total funds
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/mass-transfer/token:
 *   post:
 *     summary: Perform mass token transfer
 *     description: |
 *       Initiates multiple SPL token transfers from a single source wallet to multiple destinations.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fromWallet
 *               - tokenMint
 *               - transfers
 *             properties:
 *               fromWallet:
 *                 type: string
 *                 description: Source wallet address
 *               tokenMint:
 *                 type: string
 *                 description: SPL token mint address
 *               transfers:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - toWallet
 *                     - amount
 *                   properties:
 *                     toWallet:
 *                       type: string
 *                       description: Destination wallet address
 *                     amount:
 *                       type: number
 *                       description: Amount of tokens to transfer
 *                     reference:
 *                       type: string
 *                       description: Optional reference or memo for this transfer
 *               reason:
 *                 type: string
 *                 description: Overall reason for the mass transfer
 *     responses:
 *       200:
 *         description: Mass token transfer initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 transferId:
 *                   type: string
 *                   description: Unique ID for tracking this mass transfer
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       signature:
 *                         type: string
 *                         description: Solana transaction signature
 *                       status:
 *                         type: string
 *                         enum: [confirmed, processing, failed]
 *                       toWallet:
 *                         type: string
 *                       amount:
 *                         type: number
 *       400:
 *         description: Invalid request or insufficient token balance
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/transactions/{address}:
 *   get:
 *     summary: Get wallet transactions
 *     description: |
 *       Retrieves a paginated list of transactions for a specific wallet.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
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
 *         name: type
 *         schema:
 *           type: string
 *           enum: [all, sol, token]
 *           default: all
 *         description: Filter by transaction type
 *     responses:
 *       200:
 *         description: Wallet transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 address:
 *                   type: string
 *                   description: Wallet address
 *                 transactions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       signature:
 *                         type: string
 *                         description: Transaction signature
 *                       blockTime:
 *                         type: string
 *                         format: date-time
 *                       status:
 *                         type: string
 *                         enum: [confirmed, pending, failed]
 *                       type:
 *                         type: string
 *                         enum: [sol, token, system, other]
 *                       amount:
 *                         type: number
 *                       tokenInfo:
 *                         type: object
 *                         properties:
 *                           mint:
 *                             type: string
 *                           symbol:
 *                             type: string
 *                           decimals:
 *                             type: integer
 *                       counterparty:
 *                         type: string
 *                         description: Other wallet involved in the transaction
 *                       direction:
 *                         type: string
 *                         enum: [incoming, outgoing]
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of transactions
 *                     page:
 *                       type: integer
 *                       description: Current page
 *                     limit:
 *                       type: integer
 *                       description: Number of transactions per page
 *                     pages:
 *                       type: integer
 *                       description: Total number of pages
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/export-wallet/{address}:
 *   get:
 *     summary: Export wallet data
 *     description: |
 *       Exports detailed wallet data including all transactions for a specific wallet.
 *       Returns a downloadable JSON file with complete wallet information.
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Solana wallet address
 *     responses:
 *       200:
 *         description: Wallet data export
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                 type:
 *                   type: string
 *                 balances:
 *                   type: object
 *                 transactions:
 *                   type: array
 *                 metadata:
 *                   type: object
 *                 exportTimestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       404:
 *         description: Wallet not found
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/wallets/total-sol-balance:
 *   get:
 *     summary: Get total SOL balance
 *     description: |
 *       Retrieves the total SOL balance across all system-managed wallets.
 *       Provides a breakdown by wallet type (contest, system, reserve, etc.).
 *       Requires admin privileges.
 *     tags: [Admin, Wallet Management]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Total SOL balance
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
 *                   description: Total SOL balance across all wallets
 *                 breakdown:
 *                   type: object
 *                   properties:
 *                     systemWallets:
 *                       type: number
 *                       description: Balance in system wallets
 *                     contestWallets:
 *                       type: number
 *                       description: Balance in contest wallets
 *                     reserveWallets:
 *                       type: number
 *                       description: Balance in reserve wallets
 *                     otherWallets:
 *                       type: number
 *                       description: Balance in other managed wallets
 *                 walletCount:
 *                   type: integer
 *                   description: Total number of wallets tracked
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 