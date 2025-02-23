/*

// /utils/service-suite/service-registry.js

// THIS IS USED TO REGISTER AND MANAGE ALL SERVICES

import { logApi } from './logger-suite/logger.js';
import { ServiceError } from './service-error.js';


export class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
    }

    // Register a service with its dependencies
    register(service, dependencies = []) {
        if (this.services.has(service.name)) {
            throw ServiceError.configuration(
                `Service ${service.name} is already registered`
            );
        }

        this.services.set(service.name, service);
        this.dependencies.set(service.name, dependencies);
        logApi.info(`Registered service: ${service.name}`);
    }

    // Get a registered service by name
    getService(name) {
        const service = this.services.get(name);
        if (!service) {
            throw ServiceError.configuration(
                `Service ${name} is not registered`
            );
        }
        return service;
    }

    // Initialize all registered services in dependency order
    async initializeAll() {
        const initialized = new Set();
        const failed = new Set();
        const results = {
            successful: [],
            failed: []
        };

        for (const [serviceName] of this.services) {
            await this.initializeService(
                serviceName,
                initialized,
                failed,
                results,
                new Set()
            );
        }

        return results;
    }

    // Initialize a single service and its dependencies
    async initializeService(
        serviceName,
        initialized,
        failed,
        results,
        processing
    ) {
        // Check for circular dependencies
        if (processing.has(serviceName)) {
            throw ServiceError.configuration(
                `Circular dependency detected for service: ${serviceName}`
            );
        }

        // Skip if already processed
        if (initialized.has(serviceName) || failed.has(serviceName)) {
            return;
        }

        processing.add(serviceName);

        // Initialize dependencies first
        const dependencies = this.dependencies.get(serviceName) || [];
        for (const dep of dependencies) {
            await this.initializeService(
                dep,
                initialized,
                failed,
                results,
                processing
            );
        }

        // Check if any dependencies failed
        const dependencyFailed = dependencies.some(dep => failed.has(dep));
        if (dependencyFailed) {
            failed.add(serviceName);
            results.failed.push({
                service: serviceName,
                error: 'Dependency initialization failed'
            });
            return;
        }

        // Initialize the service
        try {
            const service = this.getService(serviceName);
            await service.initialize();
            initialized.add(serviceName);
            results.successful.push(serviceName);
            logApi.info(`Initialized service: ${serviceName}`);
        } catch (error) {
            failed.add(serviceName);
            results.failed.push({
                service: serviceName,
                error: error.message
            });
            logApi.error(`Failed to initialize service: ${serviceName}`, error);
        }

        processing.delete(serviceName);
    }

    // Start all registered services
    async startAll() {
        const results = {
            successful: [],
            failed: []
        };

        for (const [serviceName, service] of this.services) {
            try {
                await service.start();
                results.successful.push(serviceName);
            } catch (error) {
                results.failed.push({
                    service: serviceName,
                    error: error.message
                });
            }
        }

        return results;
    }

    // Stop all registered services
    async stopAll() {
        const results = {
            successful: [],
            failed: []
        };

        for (const [serviceName, service] of this.services) {
            try {
                await service.stop();
                results.successful.push(serviceName);
            } catch (error) {
                results.failed.push({
                    service: serviceName,
                    error: error.message
                });
            }
        }

        return results;
    }

    // Get health status of all services
    async getHealthStatus() {
        const status = {
            healthy: [],
            unhealthy: [],
            disabled: []
        };

        for (const [serviceName, service] of this.services) {
            try {
                const isEnabled = await service.checkEnabled();
                if (!isEnabled) {
                    status.disabled.push(serviceName);
                    continue;
                }

                if (service.stats.circuitBreaker.isOpen) {
                    status.unhealthy.push({
                        service: serviceName,
                        reason: 'Circuit breaker open',
                        failures: service.stats.circuitBreaker.failures
                    });
                    continue;
                }

                if (service.stats.history.consecutiveFailures > 0) {
                    status.unhealthy.push({
                        service: serviceName,
                        reason: 'Consecutive failures',
                        count: service.stats.history.consecutiveFailures
                    });
                    continue;
                }

                status.healthy.push(serviceName);
            } catch (error) {
                status.unhealthy.push({
                    service: serviceName,
                    reason: 'Error checking health',
                    error: error.message
                });
            }
        }

        return status;
    }
}

// Create and export singleton instance
export const serviceRegistry = new ServiceRegistry();
export default serviceRegistry;

*/