/**
 * @swagger
 * /api/admin/system-reports:
 *   get:
 *     tags:
 *       - Admin - System Reports
 *     summary: List all system reports
 *     description: Retrieves a list of all system reports, with optional filtering
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         description: Filter reports by type (service, db, prisma)
 *         schema:
 *           type: string
 *           enum: [service, db, prisma]
 *       - in: query
 *         name: date
 *         description: Filter reports by date (YYYY-MM-DD format)
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         description: Limit the number of reports returned
 *         schema:
 *           type: integer
 *       - in: query
 *         name: withAiOnly
 *         description: Only include reports with AI analysis
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of system reports
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 reports:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       type:
 *                         type: string
 *                         enum: [service, db, prisma]
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                       date:
 *                         type: string
 *                       time:
 *                         type: string
 *                       path:
 *                         type: string
 *                       files:
 *                         type: array
 *                         items:
 *                           type: string
 *                       hasAiAnalysis:
 *                         type: boolean
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 * 
 * /api/admin/system-reports/{reportId}/{reportType}:
 *   get:
 *     tags:
 *       - Admin - System Reports
 *     summary: Get report content
 *     description: Retrieves the content of a specific system report
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         description: ID of the report to retrieve
 *         schema:
 *           type: string
 *       - in: path
 *         name: reportType
 *         required: true
 *         description: Type of the report (service, db, prisma)
 *         schema:
 *           type: string
 *           enum: [service, db, prisma]
 *     responses:
 *       200:
 *         description: Report content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 report:
 *                   type: object
 *                   properties:
 *                     metadata:
 *                       type: object
 *                     content:
 *                       type: object
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Report not found
 *       500:
 *         description: Server error
 * 
 * /api/admin/system-reports/generate:
 *   post:
 *     tags:
 *       - Admin - System Reports
 *     summary: Generate a new system report
 *     description: Generates a new system report of the specified type, with optional AI analysis
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reportType:
 *                 type: string
 *                 enum: [service, db, prisma]
 *                 default: service
 *                 description: Type of report to generate
 *               withAi:
 *                 type: boolean
 *                 description: Include AI analysis in the report
 *               generateMigration:
 *                 type: boolean
 *                 description: Generate migration scripts to fix schema discrepancies (only for prisma reports with AI analysis)
 *     responses:
 *       200:
 *         description: Report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 report:
 *                   type: object
 *                 output:
 *                   type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */