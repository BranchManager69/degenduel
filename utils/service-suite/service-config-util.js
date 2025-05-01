// utils/service-suite/service-config-util.js

//
//
// NOTE:
//   This file is not being used anywhere currently.
//     Might it have great value in the future? 
//     It could be used to manage services on the fly across the entire platform.
//
//

/**
 * Service Configuration Utility
 * Manages service configuration in the database with hot-reloading support
 */

import prisma from '../../config/prisma.js';
import { logApi } from '../logger-suite/logger.js';
import { SERVICE_NAMES } from './service-constants.js';

/**
 * ServiceConfigUtil provides utilities for managing service configurations,
 * allowing hot-reloading of service parameters without server restarts.
 */
class ServiceConfigUtil {
  /**
   * Cache of service configurations
   * @type {Map<string, Object>}
   */
  static configCache = new Map();
  
  /**
   * Last refresh times for each service
   * @type {Map<string, number>}
   */
  static lastRefreshTimes = new Map();
  
  /**
   * Cache TTL in milliseconds (5 seconds)
   * @type {number}
   */
  static CACHE_TTL = 5000;
  
  /**
   * Default configurations for services
   * @type {Object}
   */
  static DEFAULT_CONFIGS = {
    [SERVICE_NAMES.CONTEST_EVALUATION]: {
      display_name: 'Contest Evaluation Service',
      check_interval_ms: 30000, // 30 seconds
      circuit_breaker: {
        failureThreshold: 10,
        resetTimeoutMs: 120000,
        minHealthyPeriodMs: 180000
      },
      backoff: {
        initialDelayMs: 1000, 
        maxDelayMs: 30000,
        factor: 2
      },
      thresholds: {
        minPrizeAmount: 0.001,
        maxParallelEvaluations: 5
      }
    },
    [SERVICE_NAMES.LIQUIDITY]: {
      display_name: 'Liquidity Service',
      check_interval_ms: 60000, // 1 minute
      circuit_breaker: {
        failureThreshold: 6,
        resetTimeoutMs: 75000,
        minHealthyPeriodMs: 120000
      },
      backoff: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        factor: 2
      },
      thresholds: {
        minBalance: 0.05
      }
    }
    // Add other services as needed
  };
  
  /**
   * Initialize the default configurations for services in the database
   * @returns {Promise<void>}
   */
  static async initializeDefaultConfigs() {
    try {
      const services = Object.keys(this.DEFAULT_CONFIGS);
      const existingConfigs = await prisma.service_configuration.findMany({
        where: { service_name: { in: services } }
      });
      
      const existingNames = existingConfigs.map(config => config.service_name);
      
      for (const serviceName of services) {
        if (!existingNames.includes(serviceName)) {
          const defaultConfig = this.DEFAULT_CONFIGS[serviceName];
          
          await prisma.service_configuration.create({
            data: {
              service_name: serviceName,
              display_name: defaultConfig.display_name,
              check_interval_ms: defaultConfig.check_interval_ms,
              circuit_breaker: defaultConfig.circuit_breaker,
              backoff: defaultConfig.backoff,
              thresholds: defaultConfig.thresholds,
              updated_by: 'system_init'
            }
          });
          
          logApi.info(`Created default configuration for ${serviceName}`);
        }
      }
      
      logApi.info(`Service configurations initialized: ${services.length} services`);
    } catch (error) {
      logApi.error('Error initializing service configurations:', error);
    }
  }
  
  /**
   * Get a service configuration from the database with caching
   * @param {string} serviceName - The service name
   * @param {boolean} forceFresh - Force a fresh database query
   * @returns {Promise<Object|null>} - The service configuration or null if not found
   */
  static async getServiceConfig(serviceName, forceFresh = false) {
    try {
      const now = Date.now();
      const lastRefresh = this.lastRefreshTimes.get(serviceName) || 0;
      const isCacheStale = now - lastRefresh > this.CACHE_TTL;
      
      // Return cached configuration if it's not stale and fresh is not forced
      if (!forceFresh && !isCacheStale && this.configCache.has(serviceName)) {
        return this.configCache.get(serviceName);
      }
      
      // Query the database for the latest configuration
      const config = await prisma.service_configuration.findUnique({
        where: { service_name: serviceName }
      });
      
      // If config found, update cache and refresh time
      if (config) {
        this.configCache.set(serviceName, config);
        this.lastRefreshTimes.set(serviceName, now);
        return config;
      }
      
      // If no configuration found, try to initialize with defaults
      if (this.DEFAULT_CONFIGS[serviceName]) {
        const defaultConfig = this.DEFAULT_CONFIGS[serviceName];
        const newConfig = await prisma.service_configuration.create({
          data: {
            service_name: serviceName,
            display_name: defaultConfig.display_name,
            check_interval_ms: defaultConfig.check_interval_ms,
            circuit_breaker: defaultConfig.circuit_breaker,
            backoff: defaultConfig.backoff,
            thresholds: defaultConfig.thresholds,
            updated_by: 'auto_created'
          }
        });
        
        this.configCache.set(serviceName, newConfig);
        this.lastRefreshTimes.set(serviceName, now);
        return newConfig;
      }
      
      // No configuration and no defaults
      return null;
    } catch (error) {
      logApi.error(`Error getting service configuration for ${serviceName}:`, error);
      
      // In case of error, return cached version if available
      if (this.configCache.has(serviceName)) {
        return this.configCache.get(serviceName);
      }
      
      // Return default config if available
      if (this.DEFAULT_CONFIGS[serviceName]) {
        return {
          service_name: serviceName,
          display_name: this.DEFAULT_CONFIGS[serviceName].display_name,
          check_interval_ms: this.DEFAULT_CONFIGS[serviceName].check_interval_ms,
          circuit_breaker: this.DEFAULT_CONFIGS[serviceName].circuit_breaker,
          backoff: this.DEFAULT_CONFIGS[serviceName].backoff,
          thresholds: this.DEFAULT_CONFIGS[serviceName].thresholds,
          enabled: true,
          _default_fallback: true // Flag to indicate this is a fallback
        };
      }
      
      return null;
    }
  }
  
  /**
   * Get the check interval for a service
   * @param {string} serviceName - The service name
   * @param {number} defaultValue - Default value to return if not found
   * @returns {Promise<number>} - The check interval in milliseconds
   */
  static async getCheckInterval(serviceName, defaultValue = 60000) {
    const config = await this.getServiceConfig(serviceName);
    return config?.check_interval_ms ?? defaultValue;
  }
  
  /**
   * Update a service configuration
   * @param {string} serviceName - The service name
   * @param {Object} updates - Fields to update
   * @param {string} updatedBy - User who made the update
   * @returns {Promise<Object|null>} - The updated configuration or null on error
   */
  static async updateServiceConfig(serviceName, updates, updatedBy = 'system') {
    try {
      const config = await prisma.service_configuration.update({
        where: { service_name: serviceName },
        data: {
          ...updates,
          updated_by: updatedBy,
          last_updated: new Date()
        }
      });
      
      // Update cache with new values
      this.configCache.set(serviceName, config);
      this.lastRefreshTimes.set(serviceName, Date.now());
      
      return config;
    } catch (error) {
      logApi.error(`Error updating service configuration for ${serviceName}:`, error);
      return null;
    }
  }
  
  /**
   * Update service status after a run
   * @param {string} serviceName - The service name
   * @param {string} status - The status ('success', 'failure', 'degraded')
   * @param {number} durationMs - Duration of the run in milliseconds
   * @param {string} message - Optional status message
   * @returns {Promise<Object|null>} - The updated configuration or null on error
   */
  static async updateServiceStatus(serviceName, status, durationMs, message = null) {
    try {
      const config = await prisma.service_configuration.update({
        where: { service_name: serviceName },
        data: {
          last_run_at: new Date(),
          last_run_duration_ms: durationMs,
          last_status: status,
          status_message: message
        }
      });
      
      // Update cache
      if (this.configCache.has(serviceName)) {
        const cached = this.configCache.get(serviceName);
        this.configCache.set(serviceName, {
          ...cached,
          last_run_at: new Date(),
          last_run_duration_ms: durationMs,
          last_status: status,
          status_message: message
        });
      }
      
      return config;
    } catch (error) {
      logApi.error(`Error updating service status for ${serviceName}:`, error);
      return null;
    }
  }
  
  /**
   * List all service configurations
   * @returns {Promise<Array>} - Array of service configurations
   */
  static async listServiceConfigs() {
    try {
      return await prisma.service_configuration.findMany({
        orderBy: { display_name: 'asc' }
      });
    } catch (error) {
      logApi.error('Error listing service configurations:', error);
      return [];
    }
  }
  
  /**
   * Clear the configuration cache for a service
   * @param {string} serviceName - The service name or null to clear all
   */
  static clearCache(serviceName = null) {
    if (serviceName) {
      this.configCache.delete(serviceName);
      this.lastRefreshTimes.delete(serviceName);
    } else {
      this.configCache.clear();
      this.lastRefreshTimes.clear();
    }
  }
}

export default ServiceConfigUtil;