 // services/achievementService.js

 /*
  * This service is responsible for managing the achievement system.
  * It allows the admin to create and manage achievements.
  * 
  */

 // ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import VanityWalletService from './vanityWalletService.js'; // Service Subclass
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
//////import { CircuitBreaker } from '../utils/circuit-breaker.js';
// ** Service Manager (?) **
import { ServiceManager } from '../utils/service-suite/service-manager.js';

const ACHIEVEMENT_SERVICE_CONFIG = {
    name: 'Achievement Service',
    description: 'Manages achievements for the platform',
    circuitBreaker: {
        enabled: true,
        threshold: 1000,
        interval: 60000
    }
};
 
// Achievement Service
class AchievementService extends BaseService {
    constructor() {
        super(ACHIEVEMENT_SERVICE_CONFIG.name, ACHIEVEMENT_SERVICE_CONFIG);
    }

    // Initialize the service
    async initialize() {
        // Initialize the circuit breaker
        this.circuitBreaker = {
            enabled: true,
            threshold: 1000,
            interval: 60000
        };
    }

    // Check the circuit breaker
    async checkCircuitBreaker() {
        // Check if the circuit breaker is enabled
        if (this.circuitBreaker.enabled) {
            const currentTime = Date.now(); 
            const lastResetTime = this.circuitBreaker.lastResetTime;
            const timeSinceReset = currentTime - lastResetTime;

            // If the circuit breaker is enabled and the time since the last reset is greater than the interval, reset the circuit breaker
            if (timeSinceReset > this.circuitBreaker.interval) {
                this.circuitBreaker.lastResetTime = currentTime;
                this.circuitBreaker.reset();
            }
        }
    }

    // Perform the operation
    async performOperation() {
        try {
            // Check if the circuit breaker is enabled
            if (this.circuitBreaker.enabled) {
                const currentTime = Date.now();
                const lastResetTime = this.circuitBreaker.lastResetTime;
                const timeSinceReset = currentTime - lastResetTime;

                // If the circuit breaker is enabled and the time since the last reset is greater than the interval, reset the circuit breaker
                if (timeSinceReset > this.circuitBreaker.interval) {
                    this.circuitBreaker.lastResetTime = currentTime;
                    this.circuitBreaker.reset();
                } else {
                    // Log the warning
                    logApi.warn('Circuit breaker is enabled, but the time since the last reset is less than the interval', {
                        timeSinceReset: timeSinceReset,
                        interval: this.circuitBreaker.interval
                    });
                }
            }

            // Perform the operation
            await this.performOperation();
        } catch (error) {
            // Log the error
            logApi.error('Error in Achievement Service', {
                error: error.message,
                stack: error.stack
            });
        }
    }
}

// Export service singleton
const achievementService = new AchievementService();
export default achievementService;