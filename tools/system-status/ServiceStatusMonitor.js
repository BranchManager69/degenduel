// ServiceStatusMonitor.js
// A reusable class to monitor service status

import { PrismaClient } from '@prisma/client';
import { formatDistance } from 'date-fns';
import { logApi } from '../../utils/logger-suite/logger.js';

class ServiceStatusMonitor {
  constructor(options = {}) {
    this.prisma = new PrismaClient();
    this.options = {
      includeInactive: true,
      includeConfig: true,
      sortBy: 'time', // 'time', 'name', or 'status'
      ...options
    };
  }

  /**
   * Get the status of all services
   * @param {Object} options - Override instance options
   * @returns {Promise<Array>} Array of service status objects
   */
  async getServiceStatus(options = {}) {
    const opts = { ...this.options, ...options };
    
    try {
      // Build the query for service entries
      const serviceQuery = this.prisma.$queryRaw`
        SELECT 
          key, 
          value->>'status' as status,
          value->>'running' as running,
          value->'config'->>'description' as description,
          value->'stats'->'operations'->'total' as operations,
          value->'stats'->'performance'->'averageOperationTimeMs' as avg_time,
          updated_at
        FROM system_settings 
        WHERE value ? 'status'
        ${!opts.includeInactive ? this.prisma.$raw`AND value->>'status' = 'active'` : this.prisma.$raw``}
      `;
      
      // Build the query for config entries
      const configQuery = opts.includeConfig 
        ? this.prisma.$queryRaw`
            SELECT 
              key, 
              '(config)' as status, 
              'false' as running,
              NULL as description,
              NULL as operations,
              NULL as avg_time,
              updated_at 
            FROM system_settings 
            WHERE NOT value ? 'status'
          `
        : Promise.resolve([]);

      // Execute both queries in parallel
      const [serviceEntries, configEntries] = await Promise.all([
        serviceQuery,
        configQuery
      ]);
      
      // Combine results
      let results = [...serviceEntries, ...configEntries];
      
      // Sort results
      if (opts.sortBy === 'name') {
        results.sort((a, b) => a.key.localeCompare(b.key));
      } else if (opts.sortBy === 'status') {
        results.sort((a, b) => {
          if (a.status === b.status) {
            return new Date(b.updated_at) - new Date(a.updated_at);
          }
          return a.status?.localeCompare(b.status || '');
        });
      } else {
        // Default sort by time (most recent first)
        results.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      }
      
      // Format results
      return results.map(entry => ({
        service: entry.key,
        status: entry.status,
        running: entry.running === 'true',
        description: entry.description,
        operations: parseInt(entry.operations || '0', 10),
        avg_time_ms: parseFloat(entry.avg_time || '0'),
        updated_at: entry.updated_at,
        updated_ago: this.formatTimeAgo(entry.updated_at)
      }));
    } catch (error) {
      logApi.error('Error fetching service status:', error);
      throw error;
    }
  }
  
  /**
   * Get detailed status for a specific service
   * @param {string} serviceName - Name of the service to get details for
   * @returns {Promise<Object>} Service details
   */
  async getServiceDetails(serviceName) {
    try {
      const entry = await this.prisma.system_settings.findUnique({
        where: { key: serviceName }
      });
      
      if (!entry) {
        return null;
      }
      
      let value;
      if (typeof entry.value === 'string') {
        try {
          value = JSON.parse(entry.value);
        } catch (e) {
          value = entry.value;
        }
      } else {
        value = entry.value;
      }
      
      return {
        service: entry.key,
        details: value,
        updated_at: entry.updated_at,
        updated_ago: this.formatTimeAgo(entry.updated_at)
      };
    } catch (error) {
      logApi.error(`Error fetching service details for ${serviceName}:`, error);
      throw error;
    }
  }
  
  /**
   * Find services that have not been updated within a certain timeframe
   * @param {number} minutes - Minutes threshold
   * @returns {Promise<Array>} Stale services
   */
  async findStaleServices(minutes = 10) {
    try {
      const threshold = new Date();
      threshold.setMinutes(threshold.getMinutes() - minutes);
      
      const staleServices = await this.prisma.$queryRaw`
        SELECT 
          key, 
          value->>'status' as status,
          updated_at
        FROM system_settings 
        WHERE value ? 'status'
        AND value->>'status' = 'active'
        AND updated_at < ${threshold}
        ORDER BY updated_at ASC
      `;
      
      return staleServices.map(entry => ({
        service: entry.key,
        status: entry.status,
        updated_at: entry.updated_at,
        minutes_stale: this.getMinutesStale(entry.updated_at)
      }));
    } catch (error) {
      logApi.error('Error finding stale services:', error);
      throw error;
    }
  }
  
  /**
   * Format time ago in a human-readable format
   * @param {string|Date} dateStr - Date to format
   * @returns {string} Formatted time
   */
  formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    return formatDistance(date, now, { addSuffix: true });
  }
  
  /**
   * Get the number of minutes since last update
   * @param {string|Date} dateStr - Date to calculate from
   * @returns {number} Minutes
   */
  getMinutesStale(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    return Math.floor((now - date) / (1000 * 60));
  }
  
  /**
   * Close the database connection
   */
  async close() {
    await this.prisma.$disconnect();
  }
}

export default ServiceStatusMonitor;