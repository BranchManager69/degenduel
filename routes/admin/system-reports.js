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

const router = express.Router();

/**
 * @api {get} /api/admin/system-reports List all system reports
 * @apiName GetReports
 * @apiGroup SystemReports
 * @apiPermission admin
 * 
 * @apiParam {String} [type] Filter by report type (service, db)
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
 * @apiParam {String} reportType Report type (service, db)
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
    if (reportType !== 'service' && reportType !== 'db') {
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
 * @apiParam {Boolean} [withAi] Include AI analysis for database report
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} result Generation result
 */
router.post('/generate', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { withAi } = req.body;
    
    await AdminLogger.logAction(
      req.user.wallet_address,
      'SYSTEM_REPORT_GENERATE',
      { withAi },
      {
        ip_address: req.ip,
        user_agent: req.get('user-agent')
      }
    );
    
    // Execute the system-status.sh script
    const { exec } = require('child_process');
    const command = withAi 
      ? 'npm run sys:report' 
      : 'npm run sys';
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logApi.error('[System Reports] Error generating report:', error);
        return res.status(500).json({
          success: false,
          error: 'Failed to generate report',
          details: stderr
        });
      }
      
      // Get the most recent report
      const reports = getReports({ limit: 1 });
      
      return res.json({
        success: true,
        message: 'System report generated successfully',
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