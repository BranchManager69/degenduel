import prisma from '../config/prisma.js';
import { logApi } from './logger-suite/logger.js';

class ServiceManager {
    /**
     * Updates the system settings for a service
     * @param {string} serviceName - The name of the service (e.g., 'token_sync_service')
     * @param {object} state - The current state of the service
     * @param {object} config - Service configuration
     * @param {object} stats - Service statistics (optional)
     * @returns {Promise<void>}
     */
    static async updateServiceState(serviceName, state, config, stats = null) {
        try {
            const value = {
                running: state.running,
                status: state.status,
                last_started: state.last_started,
                last_stopped: state.last_stopped,
                last_check: state.last_check,
                last_error: state.last_error,
                last_error_time: state.last_error_time,
                config,
                ...(stats && { stats })
            };

            // Clean undefined values
            Object.keys(value).forEach(key => 
                value[key] === undefined && delete value[key]
            );

            await prisma.system_settings.upsert({
                where: { key: serviceName },
                update: {
                    value: JSON.stringify(value),
                    updated_at: new Date()
                },
                create: {
                    key: serviceName,
                    value: JSON.stringify(value),
                    description: `${serviceName} status and configuration`,
                    updated_at: new Date()
                }
            });
        } catch (error) {
            logApi.error(`Failed to update service state for ${serviceName}:`, error);
            throw error;
        }
    }

    /**
     * Marks a service as started
     */
    static async markServiceStarted(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_started: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Marks a service as stopped
     */
    static async markServiceStopped(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: false,
            status: 'stopped',
            last_stopped: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Updates service state with error
     */
    static async markServiceError(serviceName, error, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'error',
            last_error: error.message,
            last_error_time: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Updates service heartbeat
     */
    static async updateServiceHeartbeat(serviceName, config, stats = null) {
        return this.updateServiceState(serviceName, {
            running: true,
            status: 'active',
            last_check: new Date().toISOString()
        }, config, stats);
    }

    /**
     * Gets the current state of a service
     */
    static async getServiceState(serviceName) {
        try {
            const setting = await prisma.system_settings.findUnique({
                where: { key: serviceName }
            });
            return setting ? JSON.parse(setting.value) : null;
        } catch (error) {
            logApi.error(`Failed to get service state for ${serviceName}:`, error);
            throw error;
        }
    }
}

// Service name constants
export const SERVICE_NAMES = {
    TOKEN_SYNC: 'token_sync_service',
    CONTEST_EVALUATION: 'contest_evaluation_service',
    WALLET_RAKE: 'wallet_rake_service',
    VANITY_WALLET: 'vanity_wallet_service',
    REFERRAL: 'referral_service',
    ADMIN_WALLET: 'admin_wallet_service',
    CONTEST_WALLET: 'contest_wallet_service'
};

export default ServiceManager; 