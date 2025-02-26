/**
 * @swagger
 * tags:
 *   name: Maintenance
 *   description: Endpoints for controlling system maintenance mode
 */

/**
 * @swagger
 * /api/admin/maintenance:
 *   get:
 *     summary: Get maintenance mode status
 *     description: |
 *       Retrieves detailed information about the current maintenance mode status.
 *       Requires admin privileges.
 *     tags: [Admin, Maintenance]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Maintenance mode status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 isInMaintenanceMode:
 *                   type: boolean
 *                   description: Whether the system is currently in maintenance mode
 *                 startedAt:
 *                   type: string
 *                   format: date-time
 *                   description: When maintenance mode was activated
 *                 scheduledEndTime:
 *                   type: string
 *                   format: date-time
 *                   description: When maintenance is scheduled to end (if set)
 *                 reason:
 *                   type: string
 *                   description: Reason for maintenance
 *                 initiatedBy:
 *                   type: string
 *                   description: Admin who initiated maintenance
 *                 affectedServices:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Services affected by maintenance
 *                 settings:
 *                   type: object
 *                   properties:
 *                     allowAdminAccess:
 *                       type: boolean
 *                     customMessage:
 *                       type: string
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 *         
 *   post:
 *     summary: Toggle maintenance mode
 *     description: |
 *       Activates or deactivates system maintenance mode.
 *       Requires admin privileges.
 *     tags: [Admin, Maintenance]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Whether to enable or disable maintenance mode
 *               reason:
 *                 type: string
 *                 description: Reason for maintenance (required when enabling)
 *               scheduledEndTime:
 *                 type: string
 *                 format: date-time
 *                 description: When maintenance is scheduled to end
 *               affectedServices:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Services affected by maintenance
 *     responses:
 *       200:
 *         description: Maintenance mode toggled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 isInMaintenanceMode:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: Maintenance mode activated successfully
 *       400:
 *         description: Invalid request (missing required fields)
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/maintenance/settings:
 *   get:
 *     summary: Get maintenance mode settings
 *     description: |
 *       Retrieves the current maintenance mode configuration settings.
 *       Requires admin privileges.
 *     tags: [Admin, Maintenance]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Maintenance mode settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settings:
 *                   type: object
 *                   properties:
 *                     allowAdminAccess:
 *                       type: boolean
 *                       description: Whether admins can access the system during maintenance
 *                     customMessage:
 *                       type: string
 *                       description: Custom message shown to users during maintenance
 *                     whitelistedIps:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: IP addresses that can access during maintenance
 *                     whitelistedWallets:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Wallet addresses that can access during maintenance
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 *         
 *   post:
 *     summary: Update maintenance mode settings
 *     description: |
 *       Updates the configuration settings for maintenance mode.
 *       Requires admin privileges.
 *     tags: [Admin, Maintenance]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allowAdminAccess:
 *                 type: boolean
 *                 description: Whether admins can access the system during maintenance
 *               customMessage:
 *                 type: string
 *                 description: Custom message shown to users during maintenance
 *               whitelistedIps:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: IP addresses that can access during maintenance
 *               whitelistedWallets:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Wallet addresses that can access during maintenance
 *     responses:
 *       200:
 *         description: Settings updated successfully
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
 *                   example: Maintenance settings updated successfully
 *                 settings:
 *                   type: object
 *       400:
 *         description: Invalid request
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */

/**
 * @swagger
 * /api/admin/maintenance/status:
 *   get:
 *     summary: Get simplified maintenance status
 *     description: |
 *       Retrieves a simplified status of the maintenance mode.
 *       Requires admin privileges.
 *     tags: [Admin, Maintenance]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Simplified maintenance status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inMaintenance:
 *                   type: boolean
 *                   description: Whether the system is in maintenance mode
 *                 reason:
 *                   type: string
 *                   description: Reason for maintenance
 *                 since:
 *                   type: string
 *                   format: date-time
 *                   description: When maintenance mode was activated
 *       401:
 *         $ref: '#/components/responses/UnauthorizedError'
 *       403:
 *         description: Insufficient permissions
 *       500:
 *         description: Server error
 */ 