// services/achievementService.js

/*
 * This service is responsible for managing the achievement system.
 * It allows the admin to create and manage achievements.
 * 
 */

// ** Service Auth **
import { generateServiceAuthHeader } from '../config/service-auth.js';
// ** Service Class **
import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError, ServiceErrorTypes } from '../utils/service-suite/service-error.js';
import { config } from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';
// ** Service Manager **
import { ServiceManager } from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';

const ACHIEVEMENT_SERVICE_CONFIG = {
    name: SERVICE_NAMES.ACHIEVEMENT,
    description: getServiceMetadata(SERVICE_NAMES.ACHIEVEMENT).description,
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    maxRetries: 3,
    retryDelayMs: 5000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    }
};
 
class AchievementService extends BaseService {
    constructor() {
        super(ACHIEVEMENT_SERVICE_CONFIG.name, ACHIEVEMENT_SERVICE_CONFIG);
        
        // Service-specific state
        this.achievementStats = {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            achievements: {
                processed: 0,
                awarded: 0,
                failed: 0,
                by_type: {}
            },
            performance: {
                average_operation_time_ms: 0,
                last_operation_time_ms: 0
            }
        };
    }

    async initialize() {
        try {
            // Call parent initialize first
            await super.initialize();
            
            // Load configuration from database
            const settings = await prisma.system_settings.findUnique({
                where: { key: this.name }
            });

            if (settings?.value) {
                const dbConfig = typeof settings.value === 'string' 
                    ? JSON.parse(settings.value)
                    : settings.value;

                // Merge configs carefully preserving circuit breaker settings
                this.config = {
                    ...this.config,
                    ...dbConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dbConfig.circuitBreaker || {})
                    }
                };
            }

            // Ensure stats are JSON-serializable for ServiceManager
            const serializableStats = JSON.parse(JSON.stringify(this.stats));
            await ServiceManager.markServiceStarted(
                this.name,
                JSON.parse(JSON.stringify(this.config)),
                serializableStats
            );

            logApi.info('Achievement Service initialized');
            return true;
        } catch (error) {
            logApi.error('Achievement Service initialization error:', error);
            await this.handleError('initialize', error);
            throw error;
        }
    }

    async performOperation() {
        const startTime = Date.now();
        
        try {
            // Process pending achievements
            const pendingAchievements = await this.processPendingAchievements();
            
            // Update service stats
            this.achievementStats.performance.last_operation_time_ms = Date.now() - startTime;
            this.achievementStats.performance.average_operation_time_ms = 
                (this.achievementStats.performance.average_operation_time_ms * this.achievementStats.operations.total + 
                (Date.now() - startTime)) / (this.achievementStats.operations.total + 1);

            // Update ServiceManager state
            await ServiceManager.updateServiceHeartbeat(
                this.name,
                this.config,
                {
                    ...this.stats,
                    achievementStats: this.achievementStats
                }
            );

            return pendingAchievements;
        } catch (error) {
            // Let the base class handle the error and circuit breaker
            throw error;
        }
    }

    async processPendingAchievements() {
        // Implementation for processing achievements
        // This is where the actual achievement logic would go
        return {
            processed: 0,
            awarded: 0,
            failed: 0
        };
    }

    async stop() {
        try {
            await super.stop();
            logApi.info('Achievement Service stopped successfully');
        } catch (error) {
            logApi.error('Error stopping Achievement Service:', error);
            throw error;
        }
    }
}

// Export service singleton
const achievementService = new AchievementService();
export default achievementService;