// utils/logger-suite/init-logger.js

/**
 * Service Initialization Logging System
 * 
 * This file provides utilities for tracking initialization of services 
 * and components, with support for categorization, timing, and summary reporting.
 */

import { logApi } from './logger.js';

class InitLogger {
    // Store initialization events by service
    static services = new Map();
    
    // Track overall initialization time
    static startTime = null;

    /**
     * Start system initialization and timing
     */
    static startInitialization() {
        this.startTime = Date.now();
        logApi.info('DegenDuel Initialization Starting', {
            service: 'SYSTEM',
            event_type: 'initialization_start',
            _highlight: true,
            _color: '#6A0DAD', // Purple
            _html_message: '<span style="background-color:#6A0DAD;color:#FFFFFF;padding:2px 8px;border-radius:3px;font-weight:bold;">SYSTEM INIT</span> <span style="font-weight:bold;">DegenDuel Initialization Starting</span>'
        });
    }

    /**
     * Log a component initialization event
     * @param {string} category - Component category (e.g., 'Database', 'WebSocket')
     * @param {string} service - Specific service name
     * @param {string} status - 'success', 'warning', 'error', or 'initializing'
     * @param {Object} details - Optional details about the initialization
     */
    static logInit(category, service, status, details = null) {
        // Track this initialization event
        const serviceKey = `${category}:${service}`;
        this.services.set(serviceKey, { 
            status, 
            details,
            timestamp: Date.now()
        });

        // Status configuration
        const statusConfig = {
            'success': { icon: '✅', color: '#00AA00', label: 'SUCCESS' },
            'warning': { icon: '⚠️', color: '#FFA500', label: 'WARNING' },
            'error': { icon: '❌', color: '#FF0000', label: 'ERROR' },
            'initializing': { icon: '🔄', color: '#0078D7', label: 'INITIALIZING' }
        };
        
        // Get status styling (default to error if status not recognized)
        const statusStyle = statusConfig[status] || statusConfig.error;
        
        // Format details
        const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
        
        // Log with appropriate styling for both console and Logtail
        logApi.info(`${statusStyle.icon} [${category}] ${service}${detailsStr}`, {
            service: 'SYSTEM_INIT',
            category,
            component: service,
            status,
            details,
            _icon: statusStyle.icon,
            _color: statusStyle.color,
            _highlight: status === 'error',
            _html_message: `<span style="background-color:${statusStyle.color};color:white;padding:1px 6px;border-radius:3px;font-weight:bold;">${statusStyle.label}</span> <span style="font-weight:bold;">[${category}]</span> ${service}${detailsStr}`
        });
    }

    /**
     * Generate a summary of all initialization events
     * @param {boolean} includeDetails - Whether to include detailed initialization logs
     */
    static summarizeInitialization(includeDetails = true) {
        // Calculate duration
        const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
        
        // Group services by category
        const categories = new Map();
        for (const [key, value] of this.services) {
            const [category] = key.split(':');
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category).push({ 
                service: key.split(':')[1], 
                ...value 
            });
        }

        // Count statuses
        const successful = [...this.services.values()].filter(s => s.status === 'success').length;
        const warnings = [...this.services.values()].filter(s => s.status === 'warning' || s.status === 'initializing').length;
        const failures = [...this.services.values()].filter(s => s.status === 'error').length;
        
        // Create a summary object
        const summary = {
            duration: `${duration}s`,
            total_components: this.services.size,
            successful,
            warnings,
            failures,
            categories: Object.fromEntries(categories)
        };

        // Log summary header with HTML formatting for Logtail
        logApi.info(`Initialization Summary (${duration}s) - ${successful} succeeded, ${warnings} warnings, ${failures} failed`, {
            service: 'SYSTEM_INIT',
            event_type: 'initialization_summary',
            summary,
            _icon: failures > 0 ? '❌' : warnings > 0 ? '⚠️' : '✅',
            _color: failures > 0 ? '#FF0000' : warnings > 0 ? '#FFA500' : '#00AA00',
            _highlight: failures > 0 || warnings > 0,
            _html_message: `
                <div style="margin-bottom:8px;">
                    <span style="background-color:#6A0DAD;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;">
                        INITIALIZATION SUMMARY
                    </span>
                    <span style="font-weight:bold;margin-left:8px;">
                        Completed in ${duration}s
                    </span>
                </div>
                <div style="margin-left:10px;">
                    <span style="color:#00AA00;font-weight:bold;">${successful} successful</span> • 
                    <span style="color:#FFA500;font-weight:bold;">${warnings} warnings</span> • 
                    <span style="color:#FF0000;font-weight:bold;">${failures} failures</span>
                </div>
            `
        });
        
        // Log detailed category information if requested
        if (includeDetails) {
            for (const [category, services] of categories) {
                // Count statuses in this category
                const catSuccess = services.filter(s => s.status === 'success').length;
                const catWarnings = services.filter(s => s.status === 'warning' || s.status === 'initializing').length;
                const catFailures = services.filter(s => s.status === 'error').length;
                
                // Log category header
                logApi.info(`Category: ${category} (${catSuccess}/${services.length} successful)`, {
                    service: 'SYSTEM_INIT',
                    category,
                    status: catFailures > 0 ? 'error' : catWarnings > 0 ? 'warning' : 'success',
                    _color: catFailures > 0 ? '#FF0000' : catWarnings > 0 ? '#FFA500' : '#00AA00',
                    _html_message: `<span style="font-weight:bold;font-size:15px;">${category}</span> <span style="color:#888;font-size:14px;">(${catSuccess}/${services.length} successful)</span>`
                });
            }
        }
        
        return summary;
    }
    
    /**
     * Reset the initialization tracking
     */
    static reset() {
        this.services.clear();
        this.startTime = null;
    }
}

export default InitLogger;