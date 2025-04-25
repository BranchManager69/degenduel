// utils/error-alerter.js
import { logApi } from './logger-suite/logger.js';
import serviceEvents from './service-suite/service-events.js';
import { SERVICE_EVENTS } from './service-suite/service-events.js';

/**
 * Utility for sending critical error alerts via various channels (Discord, logs, etc.)
 */
class ErrorAlerter {
  /**
   * Send an alert for a critical error
   * @param {Error} error - The error object
   * @param {string} source - Where the error came from (e.g. service name)
   * @param {Object} context - Additional context about the error
   */
  sendCriticalErrorAlert(error, source, context = {}) {
    // Always log the error first
    logApi.error(`CRITICAL ERROR in ${source}: ${error.message}`, {
      error,
      source,
      context
    });
    
    try {
      // Format stack trace (limited to first few lines)
      const stackLines = error.stack?.split('\n').slice(0, 5).join('\n') || 'No stack trace';
      
      // Emit system alert event for Discord notification
      serviceEvents.emit(SERVICE_EVENTS.SYSTEM_ALERT, {
        title: `Critical Error in ${source}`,
        message: `${error.message}`,
        fields: [
          { name: 'Error Type', value: error.name || 'Unknown', inline: true },
          { name: 'Source', value: source, inline: true },
          { name: 'Time', value: new Date().toLocaleString(), inline: true },
          { name: 'Stack Trace', value: `\`\`\`\n${stackLines}\n\`\`\`` },
          ...this._formatContextAsFields(context)
        ]
      });
      
      logApi.info(`🚨 Error alert sent for ${source}: ${error.message}`);
    } catch (alertError) {
      // Don't let alerting errors cause more problems
      logApi.error(`Failed to send error alert: ${alertError.message}`);
    }
  }
  
  /**
   * Send an alert for a service status change
   * @param {string} serviceName - Name of the service
   * @param {string} newStatus - New status ('down', 'recovered', etc.)
   * @param {string} details - Additional details about the status change
   */
  sendServiceStatusAlert(serviceName, newStatus, details = '') {
    try {
      // Emit service status change event for Discord notification
      serviceEvents.emit(SERVICE_EVENTS.SERVICE_STATUS_CHANGE, {
        serviceName,
        newStatus,
        details
      });
      
      logApi.info(`🔄 Service status alert sent for ${serviceName}: ${newStatus}`);
    } catch (alertError) {
      logApi.error(`Failed to send service status alert: ${alertError.message}`);
    }
  }
  
  /**
   * Format context object as Discord embed fields
   * @param {Object} context - Context object
   * @returns {Array} Array of field objects
   * @private
   */
  _formatContextAsFields(context) {
    if (!context || typeof context !== 'object') {
      return [];
    }
    
    return Object.entries(context)
      .filter(([_, value]) => value !== undefined)
      .map(([key, value]) => {
        // Format the value based on its type
        let formattedValue = value;
        
        if (typeof value === 'object') {
          try {
            formattedValue = JSON.stringify(value, null, 2);
            // If it's too long, truncate it
            if (formattedValue.length > 1000) {
              formattedValue = formattedValue.substring(0, 997) + '...';
            }
            formattedValue = `\`\`\`json\n${formattedValue}\n\`\`\``;
          } catch (e) {
            formattedValue = String(value);
          }
        }
        
        return {
          name: key.charAt(0).toUpperCase() + key.slice(1),
          value: String(formattedValue).substring(0, 1024), // Discord field value limit
          inline: formattedValue.length < 100 // Use inline for short values
        };
      });
  }
}

// Export singleton instance
export default new ErrorAlerter();