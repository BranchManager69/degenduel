#!/usr/bin/env node

/**
 * DegenDuel Database Summary Report
 * 
 * Generates a comprehensive summary of the database structure and content.
 * Run with: node db-summary-report.js
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// Database connection string - reads from environment or uses default
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://branchmanager:servN!ck1003@localhost:5432/degenduel';

// Output configuration
const OUTPUT_DIR = path.join(__dirname, '../reports');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `db-summary-${new Date().toISOString().split('T')[0]}.md`);

// Ensure reports directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Helper function to run PostgreSQL queries
async function runQuery(query, description = '') {
  try {
    const { stdout } = await execPromise(`psql ${DATABASE_URL} -c "${query}"`);
    return stdout.trim();
  } catch (error) {
    return `Error running query "${description}": ${error.message}`;
  }
}

// Main report function
async function generateReport() {
  console.log('Generating database summary report...');
  
  let report = `# DegenDuel Database Summary Report\nGenerated: ${new Date().toISOString()}\n\n`;
  
  // Database overview
  report += `## Database Overview\n\n`;
  
  // Count tables
  const tableCount = await runQuery(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'`);
  report += `- **Total Tables**: ${tableCount}\n`;
  
  // Count rows in major tables
  const rowCounts = await runQuery(`
    SELECT 
      'users' as table_name, COUNT(*) as row_count FROM users
    UNION ALL 
      SELECT 'tokens', COUNT(*) FROM tokens
    UNION ALL 
      SELECT 'contests', COUNT(*) FROM contests
    UNION ALL 
      SELECT 'service_logs', COUNT(*) FROM service_logs
    UNION ALL 
      SELECT 'websocket_connections', COUNT(*) FROM websocket_connections
    UNION ALL 
      SELECT 'websocket_messages', COUNT(*) FROM websocket_messages
    ORDER BY table_name
  `);
  
  report += `- **Row counts for key tables**:\n\`\`\`\n${rowCounts}\n\`\`\`\n\n`;
  
  // User data
  report += `## User Information\n\n`;
  
  // User roles breakdown
  const userRoles = await runQuery(`SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY COUNT(*) DESC`);
  report += `### User Roles\n\`\`\`\n${userRoles}\n\`\`\`\n\n`;
  
  // Sample users (redacted for privacy)
  const userSample = await runQuery(`
    SELECT 
      id, 
      SUBSTRING(wallet_address, 1, 8) || '...' as wallet, 
      nickname, 
      role, 
      created_at 
    FROM users 
    ORDER BY created_at DESC LIMIT 5
  `);
  report += `### Recent Users (addresses redacted)\n\`\`\`\n${userSample}\n\`\`\`\n\n`;
  
  // Token data
  report += `## Token Information\n\n`;
  
  // Token stats
  const tokenStats = await runQuery(`
    SELECT 
      COUNT(*) as total_tokens,
      SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_tokens,
      SUM(CASE WHEN symbol IS NOT NULL THEN 1 ELSE 0 END) as tokens_with_symbol,
      SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) as tokens_with_image
    FROM tokens
  `);
  report += `### Token Statistics\n\`\`\`\n${tokenStats}\n\`\`\`\n\n`;
  
  // Token priority tiers
  const tokenTiers = await runQuery(`
    SELECT name, priority_score, refresh_interval_seconds, 
           token_count, description
    FROM token_refresh_priority_tiers
    ORDER BY priority_score DESC
  `);
  report += `### Token Priority Tiers\n\`\`\`\n${tokenTiers}\n\`\`\`\n\n`;
  
  // Token prices stats
  const tokenPrices = await runQuery(`
    SELECT 
      COUNT(*) as total_price_records,
      MIN(updated_at) as oldest_price,
      MAX(updated_at) as latest_price
    FROM token_prices
  `);
  report += `### Token Price Data\n\`\`\`\n${tokenPrices}\n\`\`\`\n\n`;
  
  // Contest data
  report += `## Contest Information\n\n`;
  
  // Contest status
  const contestStatus = await runQuery(`SELECT status, COUNT(*) FROM contests GROUP BY status ORDER BY COUNT(*) DESC`);
  report += `### Contest Status\n\`\`\`\n${contestStatus}\n\`\`\`\n\n`;
  
  // Recent contests
  const recentContests = await runQuery(`
    SELECT 
      id, contest_code, name, 
      start_time, end_time, status, 
      participant_count, current_prize_pool
    FROM contests 
    ORDER BY created_at DESC LIMIT 5
  `);
  report += `### Recent Contests\n\`\`\`\n${recentContests}\n\`\`\`\n\n`;
  
  // Services and monitoring
  report += `## System Services and Monitoring\n\n`;
  
  // Service logs summary
  const serviceLogSummary = await runQuery(`
    SELECT service, level, COUNT(*) 
    FROM service_logs 
    GROUP BY service, level 
    ORDER BY COUNT(*) DESC LIMIT 10
  `);
  report += `### Top Service Logs\n\`\`\`\n${serviceLogSummary}\n\`\`\`\n\n`;
  
  // Recent service logs
  const recentLogs = await runQuery(`
    SELECT 
      service, level, 
      SUBSTRING(message, 1, 50) as message_preview, 
      created_at 
    FROM service_logs 
    ORDER BY created_at DESC LIMIT 5
  `);
  report += `### Recent Service Logs\n\`\`\`\n${recentLogs}\n\`\`\`\n\n`;
  
  // System settings
  const systemSettings = await runQuery(`
    SELECT key, description 
    FROM system_settings 
    ORDER BY key
  `);
  report += `### System Settings\n\`\`\`\n${systemSettings}\n\`\`\`\n\n`;
  
  // Service configuration 
  const serviceConfig = await runQuery(`
    SELECT id, service_name, enabled, check_interval_ms
    FROM service_configuration
    ORDER BY service_name
  `);
  report += `### Service Configuration\n\`\`\`\n${serviceConfig}\n\`\`\`\n\n`;
  
  // WebSocket data
  report += `## WebSocket System\n\n`;
  
  // WebSocket connections
  const wsConnections = await runQuery(`
    SELECT 
      COUNT(*) as total_connections,
      SUM(CASE WHEN is_authenticated = true THEN 1 ELSE 0 END) as authenticated_connections,
      MAX(connected_at) as last_connection
    FROM websocket_connections
  `);
  report += `### WebSocket Connections\n\`\`\`\n${wsConnections}\n\`\`\`\n\n`;
  
  // WebSocket message types
  const wsMessageTypes = await runQuery(`
    SELECT type, COUNT(*) 
    FROM websocket_messages 
    GROUP BY type 
    ORDER BY COUNT(*) DESC
  `);
  report += `### WebSocket Message Types\n\`\`\`\n${wsMessageTypes}\n\`\`\`\n\n`;
  
  // AI features
  report += `## AI System\n\n`;
  
  // AI conversation stats
  const aiStats = await runQuery(`
    SELECT 
      COUNT(*) as total_conversations,
      SUM(message_count) as total_messages,
      SUM(total_tokens_used) as total_tokens
    FROM ai_conversations
  `);
  report += `### AI Conversation Statistics\n\`\`\`\n${aiStats}\n\`\`\`\n\n`;
  
  // AI analyzed logs
  const aiAnalyzedLogs = await runQuery(`
    SELECT COUNT(*) as analyzed_logs
    FROM ai_analyzed_service_logs
  `);
  report += `### AI Analyzed Logs\n\`\`\`\n${aiAnalyzedLogs}\n\`\`\`\n\n`;
  
  // Additional useful tables
  report += `## Other Key Tables\n\n`;
  
  // List tables with high row counts
  const largestTables = await runQuery(`
    SELECT 
      relname as table_name,
      n_live_tup as row_count
    FROM 
      pg_stat_user_tables
    ORDER BY 
      n_live_tup DESC
    LIMIT 10
  `);
  report += `### Largest Tables (by row count)\n\`\`\`\n${largestTables}\n\`\`\`\n\n`;
  
  // Recent migrations
  const recentMigrations = await runQuery(`
    SELECT migration_name, applied_at
    FROM _prisma_migrations
    ORDER BY applied_at DESC
    LIMIT 5
  `);
  report += `### Recent Database Migrations\n\`\`\`\n${recentMigrations}\n\`\`\`\n\n`;
  
  // Database size
  const dbSize = await runQuery(`
    SELECT 
      pg_size_pretty(pg_database_size(current_database())) as db_size
  `);
  report += `### Database Size\n\`\`\`\n${dbSize}\n\`\`\`\n\n`;
  
  // Write report to file
  fs.writeFileSync(OUTPUT_FILE, report);
  console.log(`Report generated and saved to ${OUTPUT_FILE}`);
  
  return report;
}

// Run the report generator if executed directly
if (require.main === module) {
  generateReport()
    .then(report => {
      console.log('Done!');
    })
    .catch(error => {
      console.error('Error generating report:', error);
      process.exit(1);
    });
}

module.exports = { generateReport };