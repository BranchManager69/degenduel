/**
 * System Reports API Route
 * 
 * This route provides API endpoints for accessing system reports.
 */

import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getReports, getReportContent } from '../../tools/report-index.js';
import AdminLogger from '../../utils/admin-logger.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { exec } from 'child_process';

const router = express.Router();

/**
 * @api {get} /api/admin/system-reports List all system reports
 * @apiName GetReports
 * @apiGroup SystemReports
 * @apiPermission admin
 * 
 * @apiParam {String} [type] Filter by report type (service, db, prisma)
 * @apiParam {String} [date] Filter by date (YYYY-MM-DD)
 * @apiParam {Number} [limit] Limit number of results
 * @apiParam {Boolean} [withAiOnly] Only include reports with AI analysis
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Array} reports List of reports
 */
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { type, date, limit, withAiOnly } = req.query;
    
    const options = {
      type,
      date,
      limit: limit ? parseInt(limit) : undefined,
      withAiOnly: withAiOnly === 'true'
    };
    
    const reports = getReports(options);
    
    await AdminLogger.logAction(
      req.user.wallet_address,
      'SYSTEM_REPORTS_LIST',
      { options },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    return res.json({
      success: true,
      reports
    });
  } catch (error) {
    logApi.error('[System Reports] Error listing reports:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list reports'
    });
  }
});

/**
 * @api {get} /api/admin/system-reports/:reportId/:reportType Get report content
 * @apiName GetReportContent
 * @apiGroup SystemReports
 * @apiPermission admin
 * 
 * @apiParam {String} reportId Report ID
 * @apiParam {String} reportType Report type (service, db, prisma)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} report Report data
 */
router.get('/:reportId/:reportType', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { reportId, reportType } = req.params;
    
    if (!reportId || !reportType) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }
    
    // Validate report type
    if (reportType !== 'service' && reportType !== 'db' && reportType !== 'prisma') {
      return res.status(400).json({
        success: false,
        error: 'Invalid report type'
      });
    }
    
    const report = getReportContent(reportId, reportType);
    
    if (report.error) {
      return res.status(404).json({
        success: false,
        error: report.error
      });
    }
    
    await AdminLogger.logAction(
      req.user.wallet_address,
      'SYSTEM_REPORT_VIEW',
      { reportId, reportType },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    return res.json({
      success: true,
      report
    });
  } catch (error) {
    logApi.error('[System Reports] Error getting report:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get report'
    });
  }
});

/**
 * @api {post} /api/admin/system-reports/generate Generate a new system report
 * @apiName GenerateReport
 * @apiGroup SystemReports
 * @apiPermission admin
 * 
 * @apiParam {String} [reportType=service] Type of report to generate (service, db, prisma)
 * @apiParam {Boolean} [withAi] Include AI analysis for report
 * @apiParam {Boolean} [generateMigration] Generate a migration script to fix schema discrepancies (only for prisma reports with AI analysis)
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} result Generation result
 */
router.post('/generate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { withAi, reportType = 'service' } = req.body;
    
    const generateMigration = req.body.generateMigration === true;
    
    await AdminLogger.logAction(
      req.user.wallet_address,
      'SYSTEM_REPORT_GENERATE',
      { withAi, reportType, generateMigration },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    // Determine the command to execute based on the report type
    let command;
    
    switch (reportType) {
      case 'service':
        command = withAi ? 'npm run sys:report' : 'npm run sys';
        break;
      case 'db':
        command = withAi ? './scripts/db-tools.sh compare --ai-analysis' : './scripts/db-tools.sh compare';
        break;
      case 'prisma':
        // For prisma, we can generate a migration as well if AI analysis is enabled
        if (withAi) {
          // Check if the user requested migration generation
          const generateMigration = req.body.generateMigration === true;
          if (generateMigration) {
            command = './scripts/db-tools.sh reconcile --ai-analysis --generate-migration';
          } else {
            command = './scripts/db-tools.sh reconcile --ai-analysis';
          }
        } else {
          command = './scripts/db-tools.sh reconcile';
        }
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid report type'
        });
    }
    
    let logMessage = `[System Reports] Generating ${reportType} report`;
    if (withAi) logMessage += ' with AI analysis';
    if (generateMigration) logMessage += ' and migration script';
    logApi.info(logMessage);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logApi.error('[System Reports] Error generating report:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to generate report',
          details: stderr
        });
      }
      
      // Get the most recent report of the specified type
      const reports = getReports({ type: reportType, limit: 1 });
      
      return res.json({
        success: true,
        message: `${reportType} report generated successfully`,
        report: reports[0] || null,
        output: stdout
      });
    });
  } catch (error) {
    logApi.error('[System Reports] Error generating report:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate report'
    });
  }
});

export default router;