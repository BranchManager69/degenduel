import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import serviceEvents, { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';
import { config as appConfig } from '../config/config.js'; // Renamed to avoid conflict

// Default configuration for the LaunchEventService
const DEFAULT_CONFIG = {
    name: SERVICE_NAMES.LAUNCH_EVENT, // TODO: Add LAUNCH_EVENT to SERVICE_NAMES
    description: 'Monitors countdown and triggers token address reveal via WebSocket.',
    checkIntervalMs: 1000 * 10, // Check every 10 seconds
    enabled: true, // Default to enabled, can be overridden by service profile or DB
    circuitBreaker: {
        maxFailures: 5,
        resetTimeoutMs: 60000,
    },
};

class LaunchEventService extends BaseService {
    constructor() {
        super(DEFAULT_CONFIG);
        this.logger = logApi.forService(this.config.name);
        this.currentReleaseTime = null; // Stores the target release_time (ISO string)
        this.isRevealSentForCurrentRelease = false; // Flag to prevent duplicate sends
    }

    async initialize() {
        this.logger.info(`${fancyColors.CYAN}[${this.config.name}]${fancyColors.RESET} Initializing...`);
        if (!appConfig.services.launch_event) { // TODO: Add launch_event to service profiles in config
            this.logger.warn(`${fancyColors.YELLOW}Service disabled in active service profile. Will not start.${fancyColors.RESET}`);
            return false;
        }

        await super.initialize(); // This will start the performOperation interval

        // Load dynamic config from DB
        try {
            const dbSettings = await prisma.system_settings.findUnique({
                where: { key: this.config.name },
            });
            if (dbSettings?.value) {
                const dynamicConfig = typeof dbSettings.value === 'string'
                    ? JSON.parse(dbSettings.value)
                    : dbSettings.value;
                this.config = {
                    ...this.config,
                    ...dynamicConfig,
                    circuitBreaker: {
                        ...this.config.circuitBreaker,
                        ...(dynamicConfig.circuitBreaker || {}),
                    },
                };
                this.logger.info(`Loaded dynamic configuration from database. Check interval: ${this.config.checkIntervalMs / 1000}s.`);
            }
        } catch (error) {
            this.logger.error('Error loading dynamic configuration from database:', error);
            // Continue with default/file config if DB load fails
        }
        
        // Initial load of countdown settings to set the target
        await this.loadAndSetTargetReleaseTime();

        await serviceManager.markServiceStarted(
            this.config.name,
            this.config,
            this.stats // BaseService stats
        );
        this.logger.info(`${fancyColors.GREEN}Service initialized and started. Will check for reveal every ${this.config.checkIntervalMs / 1000} seconds.${fancyColors.RESET}`);
        return true;
    }

    async loadAndSetTargetReleaseTime() {
        try {
            const countdownSettings = await prisma.system_settings.findUnique({
                where: { key: 'countdown_mode' },
            });

            if (countdownSettings?.value?.enabled && countdownSettings.value.end_time) {
                const newReleaseTime = new Date(countdownSettings.value.end_time).toISOString();
                if (this.currentReleaseTime !== newReleaseTime) {
                    this.logger.info(`New target release time detected: ${newReleaseTime}. Previous: ${this.currentReleaseTime || 'None'}`);
                    this.currentReleaseTime = newReleaseTime;
                    this.isRevealSentForCurrentRelease = false; // Reset sent flag for new release time
                    this.logger.info(`Reveal event will be triggered for ${this.currentReleaseTime}.`);
                }
            } else {
                if (this.currentReleaseTime) {
                    this.logger.info('Countdown is now disabled or end_time not set. Clearing target release time.');
                }
                this.currentReleaseTime = null;
                this.isRevealSentForCurrentRelease = false;
            }
        } catch (error) {
            this.logger.error('Error fetching countdown settings:', error);
            // Keep existing target if fetch fails, to be resilient
        }
    }

    async performOperation() {
        this.logger.debug('Performing check for address reveal...');

        // Reload countdown settings on each operation to catch changes
        await this.loadAndSetTargetReleaseTime();

        if (!this.currentReleaseTime || this.isRevealSentForCurrentRelease) {
            this.logger.debug(
                !this.currentReleaseTime ? 'No current release time set.' : 'Reveal already sent for current release time.'
            );
            return;
        }

        const now = Date.now();
        const releaseTimestamp = new Date(this.currentReleaseTime).getTime();

        if (now >= releaseTimestamp) {
            this.logger.info(`Release time ${this.currentReleaseTime} has been reached. Attempting to send reveal event.`);
            try {
                const tokenConfig = await prisma.token_config.findFirst({
                    // Assuming there's only one, or you have a specific way to identify the main one
                    orderBy: { created_at: 'desc' }, // Example: get the latest one
                });

                if (tokenConfig && tokenConfig.address) {
                    const payload = {
                        type: "EVENT",
                        topic: "LAUNCH_EVENTS", // As per WEBSOCKET_API.md
                        action: "ADDRESS_REVEALED", // As per WEBSOCKET_API.md
                        data: {
                            contract_address: tokenConfig.address,
                            release_time: this.currentReleaseTime,
                        },
                        timestamp: new Date().toISOString(),
                    };

                    serviceEvents.emit(SERVICE_EVENTS.LAUNCH_EVENT_ADDRESS_REVEALED, payload);
                    
                    this.isRevealSentForCurrentRelease = true;
                    this.logger.info(`ADDRESS_REVEALED event emitted for ${tokenConfig.address} at ${this.currentReleaseTime}.`);

                } else {
                    this.logger.warn('Token config or address not found. Cannot send reveal event.');
                }
            } catch (error) {
                this.logger.error('Error fetching token_config or emitting event:', error);
                await this.handleError(new ServiceError(error.message, this.config.name, { originalError: error }));
            }
        } else {
            this.logger.debug(`Release time ${this.currentReleaseTime} not yet reached. Current time: ${new Date(now).toISOString()}`);
        }
    }

    async stop() {
        this.logger.info(`${fancyColors.CYAN}[${this.config.name}]${fancyColors.RESET} Stopping...`);
        await super.stop(); // This will clear the interval for performOperation
        this.logger.info(`${fancyColors.GREEN}Service stopped.${fancyColors.RESET}`);
    }
}

const launchEventService = new LaunchEventService();
export default launchEventService; 