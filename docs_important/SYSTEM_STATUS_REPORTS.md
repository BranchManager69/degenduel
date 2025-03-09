# DegenDuel System Status Reports

**Version:** 1.0.0  
**Last Updated:** March 1, 2025  
**Maintainer:** Branch Manager  

## Overview

This document describes the comprehensive system status reporting tool available in DegenDuel. The tool provides a unified interface for generating, organizing, and analyzing system health reports across all DegenDuel services and databases.

## Quick Start

```bash
# Basic system status report
npm run sys

# System status with AI database analysis
npm run sys:ai

# Complete report with AI analysis and clickable paths
npm run sys:report
```

## Features

- **Unified Reporting**: Runs all system health checks with a single command
- **Organized Storage**: Automatically organizes reports by type and date
- **AI-Powered Analysis**: Optional AI analysis of database differences
- **Time Tracking**: Measures and reports execution duration
- **Error Handling**: Robust error handling and reporting
- **Cross-Platform**: Works on Linux, macOS, and Windows

## Report Types

### 1. Service Status Reports

Service status reports analyze the health and operational state of all DegenDuel services by examining the `system_settings` table and service metrics. These reports include:

- Overall service health summary
- Service operational status (healthy, degraded, error)
- Recent errors and their impact
- Service configuration details
- Performance metrics

**Location:** `reports/service-reports/YYYY-MM-DD/run_HH-MM-SS/service-status.{json,md}`

### 2. Database Comparison Reports

Database comparison reports analyze the differences between production and test databases to ensure schema and data consistency. These reports include:

- Size comparison between databases
- Row count differences for critical tables
- Schema differences (tables, columns, constraints)
- Recommendations for reconciliation

**Location:** `reports/db_comparisons/YYYY-MM-DD/run_HH-MM-SS/db_comparison.{txt,plain.txt}`

#### AI Analysis

When using the `--ai` option, an additional AI analysis report is generated that provides:

- Critical evaluation of database differences
- Actionable recommendations to resolve inconsistencies
- Prisma migration suggestions
- Prioritized action plan

**Location:** `reports/db_comparisons/YYYY-MM-DD/run_HH-MM-SS/db_comparison_ai_analysis.txt`

## Command-line Options

The system status reporting tool (`tools/system-status.sh`) supports the following options:

- `--ai`: Run AI analysis on database comparison (requires OpenAI API key)
- `--help`: Display help information and usage instructions

Instead of trying to open directories automatically, the script now displays clickable file:// URLs that work with most IDEs and terminals.

## Implementation Details

### Directory Structure

```
reports/
├── service-reports/
│   └── YYYY-MM-DD/
│       └── run_HH-MM-SS/
│           ├── service-status.json
│           └── service-status.md
└── db_comparisons/
    └── YYYY-MM-DD/
        └── run_HH-MM-SS/
            ├── db_comparison.txt
            ├── db_comparison_plain.txt
            └── db_comparison_ai_analysis.txt (when using --ai)
```

### Scripts and Tools

- **Main Script**: `tools/system-status.sh`
- **Service Report Generator**: `scripts/service-status-report.js`
- **Database Comparison Tool**: `scripts/db-tools.sh`
- **NPM Scripts**:
  - `npm run sys`: Basic system status report
  - `npm run sys:ai`: Include AI database analysis
  - `npm run sys:report`: Complete report with AI analysis (recommended)

## Integration with Other Systems

### API Access

The reports can be accessed via the admin API. These endpoints require admin authentication:

#### List Reports
```
GET /api/admin/system-reports
```

Query parameters:
- `type` - Filter by report type (`service` or `db`)
- `date` - Filter by date (YYYY-MM-DD)
- `limit` - Limit number of results
- `withAiOnly` - Only include reports with AI analysis (true/false)

#### Get Report Content
```
GET /api/admin/system-reports/:reportId/:reportType
```

Path parameters:
- `reportId` - Report ID (format: YYYY-MM-DD_run_HH-MM-SS)
- `reportType` - Report type (`service` or `db`)

#### Generate New Report
```
POST /api/admin/system-reports/generate
```

Request body:
- `withAi` - Include AI analysis (true/false)

### Monitoring Pipeline

The system status reports can be integrated into automated monitoring pipelines:

```bash
# Cron job example (run daily at 3 AM)
0 3 * * * cd /home/websites/degenduel && npm run sys > /var/log/degenduel/daily-status-$(date +\%Y\%m\%d).log 2>&1
```

### Alerts and Notifications

For critical status monitoring, reports can trigger alerts:

```bash
# Example of running with alert on failure
./tools/system-status.sh || send-alert "System status check failed"
```

## Best Practices

1. **Regular Execution**: Run system status reports at least once daily
2. **Historical Analysis**: Keep reports for at least 30 days for trend analysis
3. **Review All Reports**: Pay attention to both service and database reports
4. **Act on Recommendations**: Address issues identified in AI analysis promptly
5. **Verify Fixes**: After addressing issues, run reports again to confirm resolution

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Script fails with permission errors | Run `chmod +x tools/system-status.sh` |
| AI analysis fails | Ensure `OPENAI_API_KEY` environment variable is set |
| Reports not generating | Check database connection and service status |
| Script hangs | Press Ctrl+C to interrupt; check individual service components |
| Report directories not opening | Manually navigate to the report directory |

## Future Enhancements

- Email/Slack notification integration
- Automated issue creation in ticketing system
- Historical trend analysis and visualization
- Integration with monitoring dashboards

---

For questions or contributions to this system, contact the DegenDuel Development Team.