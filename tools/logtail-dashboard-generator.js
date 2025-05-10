#!/usr/bin/env node
/**
 * Logtail Dashboard Generator
 * 
 * This script automates the creation of Logtail dashboards for batch processing
 * analytics. Instead of manually creating dashboards in the Logtail UI, this script
 * uses the Logtail API to create dashboards programmatically.
 * 
 * Features:
 * - Creates a Token Batching Dashboard
 * - Creates a Rate Limit Analysis Dashboard
 * - Creates a Performance Overview Dashboard
 * - Creates custom alerts for error rates, rate limits, and performance issues
 * 
 * Usage:
 *   node tools/logtail-dashboard-generator.js create-dashboards
 *   node tools/logtail-dashboard-generator.js create-alerts
 *   node tools/logtail-dashboard-generator.js create-all
 * 
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { config } from '../config/config.js';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

// Logtail API configuration
const LOGTAIL_API_TOKEN = process.env.LOGTAIL_API_TOKEN || config.logtail?.api_token;
const LOGTAIL_TEAM_ID = process.env.LOGTAIL_TEAM_ID || config.logtail?.team_id;

// Check if we have the required credentials
if (!LOGTAIL_API_TOKEN || !LOGTAIL_TEAM_ID) {
  console.error(`
${chalk.red('ERROR: Missing Logtail API credentials')}

Please add the following to your .env file or config:
  LOGTAIL_API_TOKEN=your_api_token
  LOGTAIL_TEAM_ID=your_team_id

You can find these in the Logtail dashboard under:
  Settings > API Tokens
`);
  process.exit(1);
}

// Base URL for Logtail API
const LOGTAIL_API_BASE = 'https://api.betterstack.com/v1';

// Configure Axios for Logtail API
const logtailApi = axios.create({
  baseURL: LOGTAIL_API_BASE,
  headers: {
    'Authorization': `Bearer ${LOGTAIL_API_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

/**
 * Create API client for Logtail
 */
class LogtailClient {
  /**
   * Get all dashboards
   */
  async getDashboards() {
    const response = await logtailApi.get('/dashboards');
    return response.data;
  }

  /**
   * Create a new dashboard
   * @param {Object} dashboardData - Dashboard configuration
   */
  async createDashboard(dashboardData) {
    const response = await logtailApi.post('/dashboards', dashboardData);
    return response.data;
  }

  /**
   * Get all alerts
   */
  async getAlerts() {
    const response = await logtailApi.get('/alerts');
    return response.data;
  }

  /**
   * Create a new alert
   * @param {Object} alertData - Alert configuration
   */
  async createAlert(alertData) {
    const response = await logtailApi.post('/alerts', alertData);
    return response.data;
  }

  /**
   * Get sources
   */
  async getSources() {
    const response = await logtailApi.get('/sources');
    return response.data;
  }
}

/**
 * Dashboard definitions
 */
const dashboards = {
  /**
   * Token Batching Dashboard
   */
  tokenBatching: {
    name: 'Token Batching Analytics',
    description: 'Analytics for token batch processing operations',
    widgets: [
      {
        name: 'Batch Processing Volume',
        query: '_source:batch_analytics',
        type: 'count',
        group_by: 'operation',
        interval: 'hour'
      },
      {
        name: 'Tokens Processed Per Hour',
        query: '_batch_summary.total_items:>0',
        type: 'sum',
        field: '_batch_summary.total_items',
        interval: 'hour'
      },
      {
        name: 'Average Processing Time',
        query: '_batch_summary.duration_ms:>0',
        type: 'avg',
        field: '_batch_summary.duration_ms',
        interval: 'hour'
      },
      {
        name: 'Success Rate',
        query: '_batch_summary.success_rate:>0',
        type: 'avg',
        field: '_batch_summary.success_rate',
        interval: 'hour'
      },
      {
        name: 'Errors by Type',
        query: '_source:batch_error',
        type: 'count',
        group_by: '_error.type',
        interval: 'hour'
      }
    ]
  },

  /**
   * Rate Limit Analysis Dashboard
   */
  rateLimitAnalysis: {
    name: 'API Rate Limit Analysis',
    description: 'Detailed analysis of API rate limiting patterns',
    widgets: [
      {
        name: 'Rate Limit Occurrences',
        query: '_error.rate_limit:true',
        type: 'count',
        interval: 'hour'
      },
      {
        name: 'Rate Limits by Operation',
        query: '_error.rate_limit:true',
        type: 'count',
        group_by: '_error.operation',
        interval: 'hour'
      },
      {
        name: 'Average Retry-After Time',
        query: '_error.retry_after_ms:>0',
        type: 'avg',
        field: '_error.retry_after_ms',
        interval: 'hour'
      },
      {
        name: 'Rate Limit Distribution by Hour',
        query: '_error.rate_limit:true',
        type: 'count',
        group_by: 'hour_of_day',
        interval: 'day'
      }
    ]
  },

  /**
   * Performance Overview Dashboard
   */
  performanceOverview: {
    name: 'Batch Performance Overview',
    description: 'Performance metrics for batch processing',
    widgets: [
      {
        name: 'Items Processed Per Second',
        query: '_batch_summary.items_per_second:>0',
        type: 'avg',
        field: '_batch_summary.items_per_second',
        interval: 'hour',
        group_by: '_batch_summary.operation'
      },
      {
        name: 'Batch Timing Distribution',
        query: '_batch_metrics.duration_ms:>0',
        type: 'percentile',
        field: '_batch_metrics.duration_ms',
        percentiles: [50, 90, 95, 99],
        interval: 'hour'
      },
      {
        name: 'Slowest Batches',
        query: '_batch_metrics.duration_ms:>5000',
        type: 'table',
        fields: [
          '_batch_metrics.batch_num',
          '_batch_metrics.items_processed',
          '_batch_metrics.duration_ms',
          '_batch_metrics.items_per_second',
          'timestamp'
        ],
        sort_field: '_batch_metrics.duration_ms',
        sort_order: 'desc',
        limit: 20
      },
      {
        name: 'Performance by Time of Day',
        query: '_batch_summary.items_per_second:>0',
        type: 'avg',
        field: '_batch_summary.items_per_second',
        group_by: 'hour_of_day',
        interval: 'day'
      }
    ]
  }
};

/**
 * Alert definitions
 */
const alerts = {
  /**
   * Rate limit alert
   */
  rateLimit: {
    name: 'High Rate Limit Frequency',
    description: 'Alerts when there are too many rate limit errors in a short period',
    query: '_error.rate_limit:true',
    threshold_type: 'count',
    threshold_value: 5,
    time_window: 15,  // minutes
    frequency: 15,    // minutes
    enabled: true,
    notification_channels: [] // Add your notification channels here
  },

  /**
   * Error rate alert
   */
  errorRate: {
    name: 'High Batch Error Rate',
    description: 'Alerts when batch operations have a high error rate',
    query: '_alert_group:high_error_rate',
    threshold_type: 'count',
    threshold_value: 1,
    time_window: 15,  // minutes
    frequency: 15,    // minutes
    enabled: true,
    notification_channels: [] // Add your notification channels here
  },

  /**
   * Performance alert
   */
  performance: {
    name: 'Performance Degradation',
    description: 'Alerts when batch processing performance degrades significantly',
    query: '_performance_alert.slowdown_factor:>2',
    threshold_type: 'count',
    threshold_value: 1,
    time_window: 60,  // minutes
    frequency: 60,    // minutes
    enabled: true,
    notification_channels: [] // Add your notification channels here
  }
};

/**
 * Create dashboards
 */
async function createDashboards() {
  try {
    console.log(chalk.cyan('Creating Logtail dashboards...'));
    
    const client = new LogtailClient();
    const existingDashboards = await client.getDashboards();
    
    for (const [key, dashboard] of Object.entries(dashboards)) {
      // Check if dashboard already exists
      const existingDashboard = existingDashboards.find(d => d.name === dashboard.name);
      
      if (existingDashboard) {
        console.log(chalk.yellow(`Dashboard "${dashboard.name}" already exists. Skipping...`));
        continue;
      }
      
      // Create dashboard
      console.log(chalk.white(`Creating dashboard "${dashboard.name}"...`));
      const result = await client.createDashboard(dashboard);
      console.log(chalk.green(`✓ Dashboard "${dashboard.name}" created successfully!`));
    }
    
    console.log(chalk.green.bold('\nDashboards created successfully!'));
    console.log(chalk.white('You can view your dashboards at: https://betterstack.com/logs/dashboards'));
  } catch (error) {
    console.error(chalk.red('Error creating dashboards:'), error.response?.data || error.message);
    process.exit(1);
  }
}

/**
 * Create alerts
 */
async function createAlerts() {
  try {
    console.log(chalk.cyan('Creating Logtail alerts...'));
    
    const client = new LogtailClient();
    const existingAlerts = await client.getAlerts();
    
    for (const [key, alert] of Object.entries(alerts)) {
      // Check if alert already exists
      const existingAlert = existingAlerts.find(a => a.name === alert.name);
      
      if (existingAlert) {
        console.log(chalk.yellow(`Alert "${alert.name}" already exists. Skipping...`));
        continue;
      }
      
      // Create alert
      console.log(chalk.white(`Creating alert "${alert.name}"...`));
      const result = await client.createAlert(alert);
      console.log(chalk.green(`✓ Alert "${alert.name}" created successfully!`));
    }
    
    console.log(chalk.green.bold('\nAlerts created successfully!'));
    console.log(chalk.white('You can view your alerts at: https://betterstack.com/logs/alerts'));
  } catch (error) {
    console.error(chalk.red('Error creating alerts:'), error.response?.data || error.message);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  const command = process.argv[2] || 'help';
  
  switch (command) {
    case 'create-dashboards':
      await createDashboards();
      break;
    
    case 'create-alerts':
      await createAlerts();
      break;
    
    case 'create-all':
      await createDashboards();
      await createAlerts();
      break;
    
    case 'help':
    default:
      console.log(`
${chalk.cyan.bold('Logtail Dashboard Generator')}

This script creates Logtail dashboards and alerts for batch processing analytics.

${chalk.white.bold('Usage:')}
  ${chalk.green('node tools/logtail-dashboard-generator.js')} ${chalk.yellow('<command>')}

${chalk.white.bold('Commands:')}
  ${chalk.yellow('create-dashboards')} - Create dashboards
  ${chalk.yellow('create-alerts')}     - Create alerts
  ${chalk.yellow('create-all')}        - Create both dashboards and alerts
  ${chalk.yellow('help')}              - Show this help message

${chalk.white.bold('Example:')}
  ${chalk.green('node tools/logtail-dashboard-generator.js')} ${chalk.yellow('create-all')}
      `);
      break;
  }
}

// Run main function
main().catch(console.error);