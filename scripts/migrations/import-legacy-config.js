#!/usr/bin/env node

/**
 * Service Configuration Migration Script
 * 
 * This script migrates service configurations from the legacy system_settings table
 * to the new service_configuration table. It preserves existing intervals and settings
 * while adopting the new schema format.
 * 
 * Usage:
 * node scripts/migrations/import-legacy-config.js [--dry-run] [--all] [--service=NAME]
 * 
 * Options:
 *   --dry-run       Show what would be migrated without actually making changes
 *   --all           Import all services defined in SERVICE_NAMES
 *   --service=NAME  Import only the specified service
 *   --log-file=PATH Save migration log to the specified file
 *   --verbose       Show detailed logs
 */

import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { config } from '../../config/config.js';
import { SERVICE_NAMES, getServiceMetadata } from '../../utils/service-suite/service-constants.js';
import { promises as fs } from 'fs';
import path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const importAll = args.includes('--all');
const isVerbose = args.includes('--verbose');

// Extract any specified service
let specificService = null;
const serviceArg = args.find(arg => arg.startsWith('--service='));
if (serviceArg) {
  specificService = serviceArg.split('=')[1];
}

// Extract log file path
let logFilePath = null;
const logFileArg = args.find(arg => arg.startsWith('--log-file='));
if (logFileArg) {
  logFilePath = logFileArg.split('=')[1];
} else {
  const logTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = path.join(process.cwd(), 'logs', `service-config-migration-${logTimestamp}.json`);
}

// Default intervals for services that might not have values in system_settings
const DEFAULT_INTERVALS = {
  [SERVICE_NAMES.LIQUIDITY]: config.service_intervals.liquidity_check_interval * 1000,
  [SERVICE_NAMES.CONTEST_EVALUATION]: config.service_intervals.contest_evaluation_check_interval * 1000,
  [SERVICE_NAMES.MARKET_DATA]: config.service_intervals.market_data_update_interval * 1000,
  [SERVICE_NAMES.TOKEN_SYNC]: config.service_intervals.token_sync_interval * 1000,
  [SERVICE_NAMES.WALLET_RAKE]: config.service_intervals.wallet_rake_check_interval * 1000,
  [SERVICE_NAMES.SOLANA]: 30000, // 30 seconds
  [SERVICE_NAMES.CONTEST_WALLET]: config.service_intervals.contest_wallet_check_interval * 1000,
  [SERVICE_NAMES.ADMIN_WALLET]: config.service_intervals.admin_wallet_check_interval * 1000,
  [SERVICE_NAMES.USER_BALANCE_TRACKING]: config.service_intervals.user_balance_check_interval * 1000
};

// List of services to import - expanded to include all available services
const SERVICES_TO_IMPORT = importAll 
  ? Object.values(SERVICE_NAMES)
  : specificService 
    ? [specificService] 
    : [
        SERVICE_NAMES.LIQUIDITY,
        SERVICE_NAMES.CONTEST_EVALUATION,
        SERVICE_NAMES.MARKET_DATA,
        SERVICE_NAMES.TOKEN_SYNC,
        SERVICE_NAMES.SOLANA
      ];

// Configure logging prefix
const LOG_PREFIX = isDryRun 
  ? '\x1b[35m[config-migration][DRY RUN]\x1b[0m'
  : '\x1b[35m[config-migration]\x1b[0m';

/**
 * Maps legacy configuration to the new schema format
 * @param {string} serviceName - Service identifier
 * @param {Object} legacyValue - Legacy value from system_settings
 * @returns {Object} - New configuration object formatted for service_configuration
 */
function mapLegacyConfig(serviceName, legacyValue) {
  // Extract the actual config - it might be nested differently in different services
  const legacyConfig = legacyValue?.config || legacyValue || {};
  
  // Get metadata for this service
  const serviceMetadata = getServiceMetadata(serviceName) || {};
  const serviceKey = Object.entries(SERVICE_NAMES)
    .find(([_, name]) => name === serviceName)?.[0] || serviceName;
  
  // Map the service name for display
  const displayName = legacyConfig.description || 
                      serviceMetadata.description || 
                      `${serviceKey} Service`;
  
  // Handle special JSON fields
  const circuitBreaker = legacyConfig.circuitBreaker || null;
  const backoff = legacyConfig.backoff || null;
  
  // Extract any service-specific thresholds
  const thresholds = {};
  
  // Add any service-specific extra fields
  if (serviceName === SERVICE_NAMES.LIQUIDITY) {
    if (legacyConfig.minimumLiquidityAmount) {
      thresholds.minimumLiquidityAmount = legacyConfig.minimumLiquidityAmount;
    }
    if (legacyConfig.rpcProviders) {
      thresholds.rpcProviders = legacyConfig.rpcProviders;
    }
  } else if (serviceName === SERVICE_NAMES.CONTEST_EVALUATION) {
    if (legacyConfig.evaluation?.maxParallelEvaluations) {
      thresholds.maxParallelEvaluations = legacyConfig.evaluation.maxParallelEvaluations;
    }
    if (legacyConfig.evaluation?.minPrizeAmount) {
      thresholds.minPrizeAmount = legacyConfig.evaluation.minPrizeAmount;
    }
  }
  
  // Just use the running value from legacy config without applying environment-specific filtering
  // This ensures we migrate exactly what's in system_settings
  const enabled = legacyValue?.running !== false;
  
  // Use the legacy interval if available, otherwise fall back to defaults
  const checkIntervalMs = legacyConfig.checkIntervalMs || 
                          DEFAULT_INTERVALS[serviceName] || 
                          60000;
  
  return {
    service_name: serviceName,
    display_name: displayName,
    enabled: enabled,
    check_interval_ms: checkIntervalMs,
    circuit_breaker: circuitBreaker,
    backoff: backoff,
    thresholds: Object.keys(thresholds).length > 0 ? thresholds : null,
    updated_by: 'migration_script',
    last_status: legacyValue?.status || null,
    status_message: legacyValue?.status_message || null,
    last_updated: new Date()
  };
}

/**
 * Import legacy configurations from system_settings
 */
async function importLegacyConfigurations() {
  console.log(`${LOG_PREFIX} Starting import of legacy service configurations...`);
  console.log(`${LOG_PREFIX} Mode: ${isDryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${LOG_PREFIX} Services to import: ${SERVICES_TO_IMPORT.join(', ')}`);
  
  // Track results for logging
  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: []
  };
  
  try {
    // Get all service configs from system_settings
    const legacyConfigs = await prisma.system_settings.findMany({
      where: {
        key: {
          in: SERVICES_TO_IMPORT
        }
      }
    });
    
    console.log(`${LOG_PREFIX} Found ${legacyConfigs.length} legacy configurations in system_settings`);
    
    // Check for services with no legacy config
    const missingServices = SERVICES_TO_IMPORT.filter(
      serviceName => !legacyConfigs.some(config => config.key === serviceName)
    );
    
    if (missingServices.length > 0) {
      console.log(`${LOG_PREFIX} These services have no legacy config and will use defaults: ${missingServices.join(', ')}`);
    }
    
    // Process each service in our list
    for (const serviceName of SERVICES_TO_IMPORT) {
      console.log(`${LOG_PREFIX} Processing ${serviceName}...`);
      
      try {
        // Find legacy config if it exists
        const legacyConfig = legacyConfigs.find(config => config.key === serviceName);
        let legacyValue = null;
        
        if (legacyConfig) {
          // Parse the value if it's a string
          if (typeof legacyConfig.value === 'string') {
            try {
              legacyValue = JSON.parse(legacyConfig.value);
            } catch (parseError) {
              console.warn(`${LOG_PREFIX} Error parsing config for ${serviceName}:`, parseError);
              legacyValue = {}; // Use empty object if parsing fails
            }
          } else {
            legacyValue = legacyConfig.value || {};
          }
          
          if (isVerbose) {
            console.log(`${LOG_PREFIX} Found legacy config for ${serviceName}:`, 
              JSON.stringify(legacyValue, null, 2));
          }
        } else {
          console.log(`${LOG_PREFIX} No legacy config found for ${serviceName}, will use defaults`);
          legacyValue = {};
        }
        
        // Map to new format
        const newConfigData = mapLegacyConfig(serviceName, legacyValue);
        
        if (isVerbose) {
          console.log(`${LOG_PREFIX} Mapped to new format:`, 
            JSON.stringify(newConfigData, null, 2));
        }
        
        // Check if config already exists in new table
        const existingConfig = await prisma.service_configuration.findUnique({
          where: { service_name: serviceName }
        });
        
        // If dry run, just log what we would do
        if (isDryRun) {
          if (existingConfig) {
            console.log(`${LOG_PREFIX} Would update existing config for ${serviceName}`);
            results.details.push({
              service: serviceName,
              action: 'would_update',
              success: true,
              config: newConfigData
            });
          } else {
            console.log(`${LOG_PREFIX} Would create new config for ${serviceName}`);
            results.details.push({
              service: serviceName,
              action: 'would_create',
              success: true,
              config: newConfigData
            });
          }
          continue;
        }
        
        // Update or create the config
        if (existingConfig) {
          // Don't update certain fields if they already exist
          const { last_run_at, last_run_duration_ms, ...updateData } = newConfigData;
          
          // Update existing config
          await prisma.service_configuration.update({
            where: { service_name: serviceName },
            data: updateData
          });
          
          console.log(`${LOG_PREFIX} Updated existing config for ${serviceName}`);
          results.updated++;
          results.details.push({
            service: serviceName,
            action: 'updated',
            success: true
          });
        } else {
          // Create new config
          await prisma.service_configuration.create({
            data: newConfigData
          });
          
          console.log(`${LOG_PREFIX} Created new config for ${serviceName}`);
          results.created++;
          results.details.push({
            service: serviceName,
            action: 'created',
            success: true
          });
        }
      } catch (serviceError) {
        console.error(`${LOG_PREFIX} Error processing ${serviceName}:`, serviceError);
        results.errors++;
        results.details.push({
          service: serviceName,
          action: 'error',
          success: false,
          error: serviceError.message
        });
      }
    }
    
    // Save results to log file
    try {
      // Ensure logs directory exists
      await fs.mkdir(path.dirname(logFilePath), { recursive: true });
      
      // Save the log file
      await fs.writeFile(
        logFilePath, 
        JSON.stringify({
          timestamp: new Date().toISOString(),
          mode: isDryRun ? 'dry-run' : 'live',
          services: SERVICES_TO_IMPORT,
          stats: {
            created: results.created,
            updated: results.updated,
            skipped: results.skipped,
            errors: results.errors
          },
          details: results.details
        }, null, 2)
      );
      
      console.log(`${LOG_PREFIX} Migration log saved to ${logFilePath}`);
    } catch (logError) {
      console.error(`${LOG_PREFIX} Error saving migration log:`, logError);
    }
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log(`${LOG_PREFIX} Migration Summary:`);
    console.log(`${LOG_PREFIX} Created: ${results.created}`);
    console.log(`${LOG_PREFIX} Updated: ${results.updated}`);
    console.log(`${LOG_PREFIX} Skipped: ${results.skipped}`);
    console.log(`${LOG_PREFIX} Errors:  ${results.errors}`);
    console.log('='.repeat(50) + '\n');
    
    console.log(`${LOG_PREFIX} Import ${isDryRun ? 'simulation' : 'execution'} completed successfully`);
    
  } catch (error) {
    console.error(`${LOG_PREFIX} Migration failed:`, error);
    throw error; // Re-throw to be caught by the promise chain
  }
}

// Run the import
importLegacyConfigurations()
  .then(() => {
    console.log(`${LOG_PREFIX} Import script completed successfully`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`${LOG_PREFIX} Import script failed:`, error);
    process.exit(1);
  });