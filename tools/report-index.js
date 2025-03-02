/**
 * Report Indexing Utility
 * 
 * This script provides utilities to list and retrieve system reports
 * in a format suitable for frontend consumption.
 */

import fs from 'fs';
import path from 'path';

/**
 * Get metadata from a report folder
 * @param {string} reportPath Path to the report folder
 * @param {string} reportType Type of report (service or db)
 * @returns {Object} Report metadata
 */
function getReportMetadata(reportPath, reportType) {
  try {
    // Extract date and time from path structure
    const pathParts = reportPath.split('/');
    const runFolder = pathParts[pathParts.length - 1];
    const dateFolder = pathParts[pathParts.length - 2];
    
    // Extract time from run_HH-MM-SS format
    const timestamp = runFolder.replace('run_', '').split('-');
    const hours = parseInt(timestamp[0]);
    const minutes = parseInt(timestamp[1]);
    const seconds = parseInt(timestamp[2]);
    
    // Extract date from YYYY-MM-DD format
    const dateParts = dateFolder.split('-');
    const year = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; // JS months are 0-indexed
    const day = parseInt(dateParts[2]);
    
    // Create Date object
    const reportDate = new Date(year, month, day, hours, minutes, seconds);
    
    // Determine files present in the report folder
    const files = fs.readdirSync(reportPath);
    
    // Check for specific files based on report type
    const hasAiAnalysis = files.some(file => file.includes('ai_analysis'));
    
    return {
      id: `${dateFolder}_${runFolder}`,
      type: reportType,
      timestamp: reportDate.toISOString(),
      date: dateFolder,
      time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
      path: reportPath,
      files: files,
      hasAiAnalysis,
      // Unix timestamp for easy sorting
      sortTimestamp: reportDate.getTime()
    };
  } catch (error) {
    console.error(`Error getting metadata for ${reportPath}:`, error);
    return null;
  }
}

/**
 * Get all reports
 * @param {Object} options Options for filtering reports
 * @returns {Array} Array of report metadata
 */
export function getReports(options = {}) {
  const { limit, type, date, withAiOnly } = options;
  const reportsBaseDir = path.join(process.cwd(), 'reports');
  let allReports = [];
  
  try {
    // Check if reports directory exists
    if (!fs.existsSync(reportsBaseDir)) {
      return [];
    }
    
    // Get service reports
    if (!type || type === 'service') {
      const serviceReportsDir = path.join(reportsBaseDir, 'service-reports');
      if (fs.existsSync(serviceReportsDir)) {
        // Get all date folders
        const dateFolders = fs.readdirSync(serviceReportsDir)
          .filter(folder => {
            // If date filter is applied, only include matching folders
            if (date) {
              return folder === date;
            }
            return true;
          });
          
        // Process each date folder
        dateFolders.forEach(dateFolder => {
          const datePath = path.join(serviceReportsDir, dateFolder);
          
          // Skip if not a directory
          if (!fs.statSync(datePath).isDirectory()) {
            return;
          }
          
          // Get all run folders in this date folder
          const runFolders = fs.readdirSync(datePath);
          
          // Process each run folder
          runFolders.forEach(runFolder => {
            const runPath = path.join(datePath, runFolder);
            
            // Skip if not a directory or not a run folder
            if (!fs.statSync(runPath).isDirectory() || !runFolder.startsWith('run_')) {
              return;
            }
            
            // Get metadata for this report
            const metadata = getReportMetadata(runPath, 'service');
            if (metadata) {
              allReports.push(metadata);
            }
          });
        });
      }
    }
    
    // Get DB comparison reports
    if (!type || type === 'db') {
      const dbReportsDir = path.join(reportsBaseDir, 'db_comparisons');
      if (fs.existsSync(dbReportsDir)) {
        // Get all date folders
        const dateFolders = fs.readdirSync(dbReportsDir)
          .filter(folder => {
            // If date filter is applied, only include matching folders
            if (date) {
              return folder === date;
            }
            return true;
          });
          
        // Process each date folder
        dateFolders.forEach(dateFolder => {
          const datePath = path.join(dbReportsDir, dateFolder);
          
          // Skip if not a directory
          if (!fs.statSync(datePath).isDirectory()) {
            return;
          }
          
          // Get all run folders in this date folder
          const runFolders = fs.readdirSync(datePath);
          
          // Process each run folder
          runFolders.forEach(runFolder => {
            const runPath = path.join(datePath, runFolder);
            
            // Skip if not a directory or not a run folder
            if (!fs.statSync(runPath).isDirectory() || !runFolder.startsWith('run_')) {
              return;
            }
            
            // Get metadata for this report
            const metadata = getReportMetadata(runPath, 'db');
            if (metadata) {
              // Apply AI filter if requested
              if (withAiOnly && !metadata.hasAiAnalysis) {
                return;
              }
              
              allReports.push(metadata);
            }
          });
        });
      }
    }
    
    // Sort reports by timestamp (newest first)
    allReports.sort((a, b) => b.sortTimestamp - a.sortTimestamp);
    
    // Apply limit if specified
    if (limit && limit > 0) {
      allReports = allReports.slice(0, limit);
    }
    
    return allReports;
  } catch (error) {
    console.error('Error listing reports:', error);
    return [];
  }
}

/**
 * Get report content
 * @param {string} reportId Report ID (date_run format)
 * @param {string} reportType Report type (service or db)
 * @returns {Object} Report content
 */
export function getReportContent(reportId, reportType) {
  try {
    // Extract date and run from ID
    const [date, run] = reportId.split('_run_');
    if (!date || !run) {
      throw new Error(`Invalid report ID: ${reportId}`);
    }
    
    // Construct report path
    const reportsBaseDir = path.join(process.cwd(), 'reports');
    const reportTypeDir = reportType === 'service' ? 'service-reports' : 'db_comparisons';
    const reportPath = path.join(reportsBaseDir, reportTypeDir, date, `run_${run}`);
    
    // Verify path exists
    if (!fs.existsSync(reportPath)) {
      throw new Error(`Report not found: ${reportPath}`);
    }
    
    // Get metadata
    const metadata = getReportMetadata(reportPath, reportType);
    if (!metadata) {
      throw new Error(`Could not get metadata for report: ${reportPath}`);
    }
    
    // Get file contents based on report type
    const content = {};
    
    if (reportType === 'service') {
      // For service reports, read the JSON file
      const jsonFile = path.join(reportPath, 'service-status.json');
      if (fs.existsSync(jsonFile)) {
        content.report = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      }
      
      // Also include the markdown file
      const mdFile = path.join(reportPath, 'service-status.md');
      if (fs.existsSync(mdFile)) {
        content.markdown = fs.readFileSync(mdFile, 'utf8');
      }
    } else if (reportType === 'db') {
      // For DB reports, read the plain text file
      const plainFile = path.join(reportPath, 'db_comparison_plain.txt');
      if (fs.existsSync(plainFile)) {
        content.report = fs.readFileSync(plainFile, 'utf8');
      }
      
      // Include AI analysis if available
      const aiFile = path.join(reportPath, 'db_comparison_ai_analysis.txt');
      if (fs.existsSync(aiFile)) {
        content.aiAnalysis = fs.readFileSync(aiFile, 'utf8');
      }
    }
    
    return {
      metadata,
      content
    };
  } catch (error) {
    console.error(`Error getting report content:`, error);
    return { error: error.message };
  }
}

// Command-line usage
if (process.argv[2] === 'list') {
  console.log(JSON.stringify(getReports(), null, 2));
} else if (process.argv[2] === 'get' && process.argv[3] && process.argv[4]) {
  console.log(JSON.stringify(getReportContent(process.argv[3], process.argv[4]), null, 2));
} else if (process.argv[2]) {
  console.log(`Unknown command: ${process.argv[2]}`);
  console.log('Usage:');
  console.log('  node report-index.js list - List all reports');
  console.log('  node report-index.js get <reportId> <reportType> - Get report content');
}