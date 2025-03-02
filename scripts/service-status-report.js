import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

/**
 * Service Status Report Generator
 * Analyzes system_settings table to provide a comprehensive service status report
 */
async function generateServiceReport() {
  try {
    console.log('Generating service status report...');
    
    // Get all system settings
    const settings = await prisma.system_settings.findMany({
      orderBy: { updated_at: 'desc' }
    });
    
    console.log(`Found ${settings.length} system settings entries`);
    
    // Format report data
    const report = {
      generated_at: new Date().toString(), // Use local time instead of UTC
      total_services: 0,
      services: {},
      service_health: {
        healthy: 0,
        degraded: 0,
        error: 0,
        unknown: 0
      },
      maintenance_mode: false,
      most_recent_updates: [],
      most_recent_errors: []
    };
    
    // Process each setting
    for (const setting of settings) {
      // Skip non-service settings
      if (!isServiceSetting(setting.key) && setting.key !== 'maintenance_mode') {
        continue;
      }
      
      // Handle maintenance mode specially
      if (setting.key === 'maintenance_mode') {
        report.maintenance_mode = setting.value === true || setting.value?.enabled === true;
        continue;
      }
      
      // Track as a service
      report.total_services++;
      
      // Get service status details
      const serviceData = extractServiceData(setting);
      report.services[setting.key] = serviceData;
      
      // Update health summary
      report.service_health[serviceData.health || 'unknown']++;
      
      // Track errors
      if (serviceData.last_error) {
        report.most_recent_errors.push({
          service: setting.key,
          error: serviceData.last_error,
          time: serviceData.last_error_time,
          health: serviceData.health
        });
      }
      
      // Track recent updates
      report.most_recent_updates.push({
        service: setting.key,
        time: setting.updated_at,
        by: setting.updated_by || 'system'
      });
    }
    
    // Sort errors and updates by time
    report.most_recent_errors.sort((a, b) => 
      new Date(b.time || 0) - new Date(a.time || 0));
    
    report.most_recent_updates.sort((a, b) => 
      new Date(b.time || 0) - new Date(a.time || 0));
    
    // Limit to top 10
    report.most_recent_errors = report.most_recent_errors.slice(0, 10);
    report.most_recent_updates = report.most_recent_updates.slice(0, 10);
    
    // Output report
    outputReport(report);
    
    return report;
  } catch (error) {
    console.error('Error generating service report:', error);
    return { error: error.message };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Check if a key represents a service setting
 */
function isServiceSetting(key) {
  return key.includes('_service') || 
         key.includes('_ws') || 
         key.includes('circuit_breaker');
}

/**
 * Extract useful service data from a system setting
 */
function extractServiceData(setting) {
  const data = {
    name: setting.key,
    description: setting.description || 'No description',
    updated_at: setting.updated_at,
    health: 'unknown',
    running: false,
    last_error: null,
    last_error_time: null,
    dependencies: [],
    last_check: null,
    config: {},
    stats: {}
  };
  
  // Safety check
  if (!setting.value) return data;
  
  try {
    const value = typeof setting.value === 'string' 
      ? JSON.parse(setting.value) 
      : setting.value;
    
    // Extract core status fields
    data.running = !!value.running;
    data.status = value.status || 'unknown';
    data.last_started = value.last_started;
    data.last_stopped = value.last_stopped;
    data.last_check = value.last_check;
    data.last_error = value.last_error;
    data.last_error_time = value.last_error_time;
    
    // Extract config and stats if available
    if (value.config) {
      data.config = summarizeObject(value.config);
    }
    
    if (value.stats) {
      data.stats = summarizeObject(value.stats);
    }
    
    // Extract operation stats if available
    if (value.stats?.operations) {
      data.operations = value.stats.operations;
    }
    
    // Extract circuit breaker status
    if (value.stats?.circuitBreaker) {
      data.circuit_breaker = value.stats.circuitBreaker;
    }
    
    // Determine health state
    data.health = determineHealthState(value);
    
  } catch (error) {
    console.warn(`Error extracting data for ${setting.key}:`, error.message);
  }
  
  return data;
}

/**
 * Determine service health state
 */
function determineHealthState(serviceData) {
  if (!serviceData) return 'unknown';
  
  if (serviceData.status === 'error' || 
      serviceData.status === 'circuit_open' ||
      (serviceData.stats?.circuitBreaker?.isOpen === true)) {
    return 'error';
  }
  
  if (serviceData.status === 'degraded' || 
      (serviceData.stats?.history?.consecutiveFailures > 0)) {
    return 'degraded';
  }
  
  if (serviceData.status === 'active' || 
      serviceData.status === 'healthy' || 
      serviceData.running === true) {
    return 'healthy';
  }
  
  return 'unknown';
}

/**
 * Summarize a complex object to avoid overwhelming output
 */
function summarizeObject(obj, maxDepth = 2, currentDepth = 0) {
  if (!obj || typeof obj !== 'object') return obj;
  
  // Limit recursion
  if (currentDepth >= maxDepth) {
    if (Array.isArray(obj)) {
      return `[Array with ${obj.length} items]`;
    }
    return '[Object]';
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    if (obj.length <= 3) {
      return obj.map(item => summarizeObject(item, maxDepth, currentDepth + 1));
    }
    return `[Array with ${obj.length} items]`;
  }
  
  // Handle objects
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null) {
      result[key] = summarizeObject(value, maxDepth, currentDepth + 1);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

/**
 * Output the report in different formats
 */
function outputReport(report) {
  // Create main reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir);
  }
  
  // Create service-reports subdirectory if it doesn't exist
  const serviceReportsDir = path.join(reportsDir, 'service-reports');
  if (!fs.existsSync(serviceReportsDir)) {
    fs.mkdirSync(serviceReportsDir);
  }
  
  // Create date-based directory (YYYY-MM-DD) using local time
  const today = new Date();
  const dateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; // YYYY-MM-DD
  const dateDir = path.join(serviceReportsDir, dateString);
  if (!fs.existsSync(dateDir)) {
    fs.mkdirSync(dateDir);
  }
  
  // Generate timestamp for run subfolder (HH-MM-SS) using local time
  const timeString = `${String(today.getHours()).padStart(2, '0')}-${String(today.getMinutes()).padStart(2, '0')}-${String(today.getSeconds()).padStart(2, '0')}`;
  
  // Create a subfolder for this specific run
  const runDir = path.join(dateDir, `run_${timeString}`);
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir);
  }
  
  // Save as JSON
  const jsonPath = path.join(runDir, `service-status.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  
  // Save as Markdown
  const mdPath = path.join(runDir, `service-status.md`);
  fs.writeFileSync(mdPath, generateMarkdownReport(report));
  
  console.log(`Report saved to: ${runDir}/`);
  
  // Console summary
  printConsoleSummary(report);
}

/**
 * Generate a markdown version of the report
 */
function generateMarkdownReport(report) {
  let md = `# DegenDuel Service Status Report\n\n`;
  md += `Generated at: ${report.generated_at}\n\n`;
  
  // Service health summary
  md += `## Service Health Summary\n\n`;
  md += `- Total Services: ${report.total_services}\n`;
  md += `- Healthy: ${report.service_health.healthy}\n`;
  md += `- Degraded: ${report.service_health.degraded}\n`;
  md += `- Error: ${report.service_health.error}\n`;
  md += `- Unknown: ${report.service_health.unknown}\n`;
  md += `- Maintenance Mode: ${report.maintenance_mode ? 'ENABLED' : 'Disabled'}\n\n`;
  
  // Recent errors
  md += `## Recent Errors\n\n`;
  if (report.most_recent_errors.length === 0) {
    md += `No recent errors found.\n\n`;
  } else {
    md += `| Service | Error | Time | Status |\n`;
    md += `|---------|-------|------|--------|\n`;
    
    for (const error of report.most_recent_errors) {
      md += `| ${error.service} | ${error.error || 'Unknown error'} | ${formatDate(error.time)} | ${error.health} |\n`;
    }
    md += `\n`;
  }
  
  // Service details
  md += `## Service Details\n\n`;
  
  for (const [name, service] of Object.entries(report.services)) {
    md += `### ${name}\n\n`;
    md += `- **Description**: ${service.description}\n`;
    md += `- **Status**: ${service.status}\n`;
    md += `- **Health**: ${service.health}\n`;
    md += `- **Running**: ${service.running ? 'Yes' : 'No'}\n`;
    md += `- **Last Updated**: ${formatDate(service.updated_at)}\n`;
    
    if (service.last_started) {
      md += `- **Last Started**: ${formatDate(service.last_started)}\n`;
    }
    
    if (service.last_stopped) {
      md += `- **Last Stopped**: ${formatDate(service.last_stopped)}\n`;
    }
    
    if (service.last_error) {
      md += `- **Last Error**: ${service.last_error}\n`;
      md += `- **Last Error Time**: ${formatDate(service.last_error_time)}\n`;
    }
    
    if (service.circuit_breaker) {
      md += `- **Circuit Breaker**: ${service.circuit_breaker.isOpen ? 'OPEN' : 'Closed'}\n`;
      md += `- **Failures**: ${service.circuit_breaker.failures || 0}\n`;
      md += `- **Recovery Attempts**: ${service.circuit_breaker.recoveryAttempts || 0}\n`;
    }
    
    if (service.operations) {
      md += `- **Operations**: Total: ${service.operations.total || 0}, `;
      md += `Success: ${service.operations.successful || 0}, `;
      md += `Failed: ${service.operations.failed || 0}\n`;
    }
    
    md += `\n`;
  }
  
  return md;
}

/**
 * Print a console summary of the report
 */
function printConsoleSummary(report) {
  console.log('\n╔════════════ DegenDuel Service Status Report ════════════╗');
  console.log(`║ Generated: ${report.generated_at.padEnd(44)} ║`);
  console.log(`║ Total Services: ${report.total_services.toString().padEnd(39)} ║`);
  console.log('╟──────────────────────────────────────────────────────────╢');
  console.log(`║ 🟢 ${report.service_health.healthy.toString().padEnd(2)} healthy   🟠 ${report.service_health.degraded.toString().padEnd(2)} degraded   🔴 ${report.service_health.error.toString().padEnd(2)} error   ⚪ ${report.service_health.unknown.toString().padEnd(2)} unknown  ║`);
  console.log(`║ Maintenance Mode: ${report.maintenance_mode ? '🔧 ENABLED' : '✅ Disabled'}${' '.repeat(31)} ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║ SERVICE STATUS SUMMARY                                   ║');
  console.log('╟──────────────────────────────────────────────────────────╢');

  // Group services by health status
  const errorServices = [];
  const degradedServices = [];
  const healthyServices = [];
  
  for (const [name, service] of Object.entries(report.services)) {
    const shortName = name.length > 30 ? name.substring(0, 27) + '...' : name.padEnd(30);
    const statusInfo = `${shortName} │ ${service.health.padEnd(8)} │ ${formatOperations(service)}`;
    
    if (service.health === 'error') {
      errorServices.push({ name, statusInfo, service });
    } else if (service.health === 'degraded') {
      degradedServices.push({ name, statusInfo, service });
    } else {
      healthyServices.push({ name, statusInfo });
    }
  }
  
  // Print error services first
  errorServices.forEach(({ statusInfo }) => {
    console.log(`║ 🔴 ${statusInfo.padEnd(56)} ║`);
  });
  
  // Print degraded services
  degradedServices.forEach(({ statusInfo }) => {
    console.log(`║ 🟠 ${statusInfo.padEnd(56)} ║`);
  });
  
  // Print up to 5 healthy services (prioritize showing problem services)
  const healthyToShow = Math.min(5, healthyServices.length);
  healthyServices.slice(0, healthyToShow).forEach(({ statusInfo }) => {
    console.log(`║ 🟢 ${statusInfo.padEnd(56)} ║`);
  });
  
  if (healthyServices.length > healthyToShow) {
    console.log(`║ ... and ${healthyServices.length - healthyToShow} more healthy services${' '.repeat(26)} ║`);
  }
  
  // Show error details if any
  if (errorServices.length > 0) {
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ ERROR DETAILS                                            ║');
    console.log('╟──────────────────────────────────────────────────────────╢');
    
    errorServices.forEach(({ name, service }) => {
      const shortName = name.length > 25 ? name.substring(0, 22) + '...' : name;
      
      // Circuit breaker info
      if (service.circuit_breaker?.isOpen) {
        const cbInfo = `Circuit breaker OPEN - ${service.circuit_breaker.failures} failures`;
        console.log(`║ ${shortName.padEnd(25)} │ ${cbInfo.padEnd(29)} ║`);
      }
      
      // Show error if available
      if (service.last_error) {
        const errorMsg = service.last_error.length > 40 
          ? service.last_error.substring(0, 37) + '...' 
          : service.last_error;
        console.log(`║ └─ Error: ${errorMsg.padEnd(48)} ║`);
      }
    });
  }

  // Add recent updates as well
  if (report.most_recent_updates.length > 0) {
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log('║ RECENT UPDATES                                           ║');
    console.log('╟──────────────────────────────────────────────────────────╢');
    
    report.most_recent_updates.slice(0, 3).forEach(update => {
      const shortName = update.service.length > 25 ? update.service.substring(0, 22) + '...' : update.service;
      const timeAgo = getTimeAgo(update.time);
      console.log(`║ ${shortName.padEnd(25)} │ ${timeAgo.padEnd(29)} ║`);
    });
  }
  
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nDetailed reports saved to: ${path.join(process.cwd(), 'reports/service-reports')}/${dateString}/run_${timeString}/`);
}

/**
 * Format operations stats in a compact way
 */
function formatOperations(service) {
  if (!service.operations) return 'No op stats';
  
  const total = service.operations.total || 0;
  const success = service.operations.successful || 0;
  const failed = service.operations.failed || 0;
  
  if (total === 0) return 'No operations';
  
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  return `${successRate}% success (${success}/${total})`;
}

/**
 * Get a human-readable time ago string
 */
function getTimeAgo(dateStr) {
  if (!dateStr) return 'N/A';
  
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return `${Math.floor(diffHours / 24)}d ago`;
}

/**
 * Format a date for display
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleString();
}

// Run the report generation
generateServiceReport()
  .catch(error => {
    console.error('Error running report:', error);
    process.exit(1);
  });