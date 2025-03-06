// utils/logger-suite/init-logger.js

/**
 * This file MIGHT be used to log the initialization of the WebSocket service.
 * WARNING: I HAVE NO IDEA IF THIS WORKS.
 */

import { logApi } from './logger.js';
import { fancyColors } from '../colors.js';

// ???
class InitLogger {
    static services = new Map();
    static startTime = null;

    static startInitialization() {
        this.startTime = Date.now();
        logApi.info(`${fancyColors.MAGENTA}[SERVICE INIT]${fancyColors.RESET} ${fancyColors.BG_BLACK}     ${fancyColors.YELLOW}${fancyColors.ITALIC}DegenDuel Initialization Starting     ${fancyColors.RESET}`);
    }

    static logInit(category, service, status, details = null) {
        const serviceKey = `${category}:${service}`;
        this.services.set(serviceKey, { status, details });

        // Format the log message
        const statusIcon = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : '❌';
        const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
        
        logApi.info(`${statusIcon} [${category}] ${service}${detailsStr}`);
    }

    static summarizeInitialization() {
        const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
        const categories = new Map();

        // Group by category
        for (const [key, value] of this.services) {
            const [category] = key.split(':');
            if (!categories.has(category)) {
                categories.set(category, []);
            }
            categories.get(category).push({ service: key.split(':')[1], ...value });
        }

        // Print summary
        logApi.info('\n=== Initialization Summary ===');
        logApi.info(`Duration: ${duration}s\n`);

        for (const [category, services] of categories) {
            logApi.info(`${category}:`);
            services.forEach(({ service, status, details }) => {
                const statusIcon = status === 'success' ? '✅' : status === 'warning' ? '⚠️' : '❌';
                const detailsStr = details ? ` | ${JSON.stringify(details)}` : '';
                logApi.info(`  ${statusIcon} ${service}${detailsStr}`);
            });
            logApi.info('');
        }

        // Count statuses
        const successful = [...this.services.values()].filter(s => s.status === 'success').length;
        const warnings = [...this.services.values()].filter(s => s.status === 'warning').length;
        const failures = [...this.services.values()].filter(s => s.status === 'error').length;

        logApi.info(`Results: ${successful} successful, ${warnings} warnings, ${failures} failures\n`);
    }
}

export default InitLogger; 