# Unified Service Management System

## Overview

This document outlines a comprehensive implementation for a unified administration system that combines WebSockets, circuit breakers, and service management into a single, coherent solution. The implementation is fully backward compatible with existing systems during the transition period.

## Core Architecture

The system consists of:

1. **SkyDuel** - A single authoritative WebSocket connection for superadmins
2. **Service Management API** - REST endpoints for initial setup and fallback
3. **Frontend Integration** - TypeScript client for React dashboard

## Implementation Components

### 1. SkyDuel WebSocket (`websocket/skyduel-ws.js`)

This is the heart of the system - a unified WebSocket server that provides:

- Real-time service monitoring
- Service control (start/stop/restart)
- Circuit breaker management
- Configuration updates
- Health checks
- Dependency visualization

```javascript
// websocket/skyduel-ws.js

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import AdminLogger from '../utils/admin-logger.js';
import prisma from '../config/prisma.js';

// SkyDuel WebSocket Server for managing all services
class SkyDuelWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        // Create the configuration object
        const config = {
            path: '/api/v2/ws/admin',
            maxPayload: 1024 * 64, // 64KB payload
            rateLimit: 120, // 2 messages per second
            requireAuth: true, // Require authentication
            requireSuperAdmin: true, // Only superadmins can access
            allowedOrigins: process.env.ALLOWED_ORIGINS 
                ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
                : [
                    'http://localhost:3000',
                    'https://degenduel.me',
                    'https://app.degenduel.me',
                    'https://dev.degenduel.me'
                ]
        };

        // Initialize base class
        super(server, config);

        // Track connected admin sessions
        this.adminSessions = new Map();
        
        // Track service subscriptions
        this.serviceSubscriptions = new Map();
        
        // Set up periodic updates
        this.startPeriodicUpdates();
    }

    // Authentication handler - ensures only superadmins can connect
    async authenticate(req, token) {
        try {
            // Verify user exists and is superadmin
            const user = await prisma.users.findFirst({
                where: {
                    auth_token: token,
                    role: 'superadmin'
                },
                select: {
                    id: true,
                    wallet_address: true,
                    role: true,
                    nickname: true
                }
            });

            if (!user) {
                return { authenticated: false, message: 'Unauthorized' };
            }

            // Log the authentication
            await AdminLogger.logAction(
                user.id,
                'ADMIN_WS_CONNECT',
                {
                    action: 'connect',
                    service: 'admin-master-ws'
                },
                {
                    ip_address: req.ip || req.socket.remoteAddress,
                    user_agent: req.headers['user-agent']
                }
            );

            return { 
                authenticated: true, 
                user: {
                    id: user.id,
                    wallet: user.wallet_address,
                    role: user.role,
                    nickname: user.nickname
                }
            };
        } catch (error) {
            logApi.error('Admin WS authentication error:', error);
            return { authenticated: false, message: 'Authentication error' };
        }
    }

    // Handle new client connection
    async onConnection(ws, request, user) {
        // Store the user context
        ws.user = user;
        
        // Add to admin sessions
        this.adminSessions.set(ws, {
            userId: user.id,
            wallet: user.wallet,
            connectedAt: new Date(),
            subscriptions: new Set(),
            lastActivity: new Date()
        });

        // Send welcome message with service catalog
        await this.sendServiceCatalog(ws);
        
        // Send initial service states
        await this.sendAllServiceStates(ws);
    }

    // Handle client disconnection
    onClose(ws) {
        // Clean up subscriptions
        const session = this.adminSessions.get(ws);
        if (session) {
            for (const service of session.subscriptions) {
                const subscribers = this.serviceSubscriptions.get(service) || new Set();
                subscribers.delete(ws);
                
                if (subscribers.size === 0) {
                    this.serviceSubscriptions.delete(service);
                } else {
                    this.serviceSubscriptions.set(service, subscribers);
                }
            }
        }
        
        // Remove from admin sessions
        this.adminSessions.delete(ws);
    }

    // Handle incoming messages
    async onMessage(ws, message) {
        try {
            const session = this.adminSessions.get(ws);
            if (!session) return; // No valid session

            // Update last activity
            session.lastActivity = new Date();
            
            // Parse the message
            const data = JSON.parse(message);
            
            // Process based on message type
            switch (data.type) {
                case 'ping':
                    this.sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
                    break;
                    
                case 'subscribe':
                    await this.handleSubscribe(ws, session, data);
                    break;
                    
                case 'unsubscribe':
                    await this.handleUnsubscribe(ws, session, data);
                    break;
                    
                case 'service:start':
                    await this.handleServiceStart(ws, session, data);
                    break;
                    
                case 'service:stop':
                    await this.handleServiceStop(ws, session, data);
                    break;
                    
                case 'service:restart':
                    await this.handleServiceRestart(ws, session, data);
                    break;
                    
                case 'circuit-breaker:reset':
                    await this.handleCircuitBreakerReset(ws, session, data);
                    break;
                    
                case 'service:config-update':
                    await this.handleServiceConfigUpdate(ws, session, data);
                    break;
                    
                case 'get:service-catalog':
                    await this.sendServiceCatalog(ws);
                    break;
                    
                case 'get:dependency-graph':
                    await this.sendDependencyGraph(ws);
                    break;
                    
                case 'health:check-all':
                    await this.handleHealthCheckAll(ws, session);
                    break;
                    
                default:
                    this.sendError(ws, 'INVALID_MESSAGE_TYPE', 'Unsupported message type');
            }
        } catch (error) {
            logApi.error('Error handling admin WS message:', error);
            this.sendError(ws, 'MESSAGE_PROCESSING_ERROR', error.message);
        }
    }

    // Send an error message to client
    sendError(ws, code, message) {
        this.sendToClient(ws, {
            type: 'error',
            code,
            message,
            timestamp: new Date().toISOString()
        });
    }

    // Send complete service catalog
    async sendServiceCatalog(ws) {
        try {
            // Get all registered services
            const services = Array.from(serviceManager.services.entries())
                .map(([name, service]) => {
                    const metadata = getServiceMetadata(name) || {};
                    return {
                        id: name,
                        name: metadata.displayName || name,
                        description: metadata.description || 'No description',
                        layer: metadata.layer || 0,
                        isOperational: service.isOperational,
                        isInitialized: service.isInitialized,
                        isStarted: service.isStarted || false,
                        type: metadata.type || 'service',
                        capabilities: metadata.capabilities || []
                    };
                });
                
            this.sendToClient(ws, {
                type: 'service:catalog',
                timestamp: new Date().toISOString(),
                services
            });
        } catch (error) {
            logApi.error('Error sending service catalog:', error);
            this.sendError(ws, 'CATALOG_ERROR', 'Failed to retrieve service catalog');
        }
    }

    // Send all service states
    async sendAllServiceStates(ws) {
        try {
            const states = await Promise.all(
                Array.from(serviceManager.services.keys()).map(async (name) => {
                    const service = serviceManager.services.get(name);
                    const state = await serviceManager.getServiceState(name);
                    
                    return {
                        id: name,
                        status: serviceManager.determineServiceStatus(service.stats),
                        operations: service.stats?.operations || { total: 0, successful: 0, failed: 0 },
                        circuitBreaker: {
                            isOpen: service.stats?.circuitBreaker?.isOpen || false,
                            failures: service.stats?.circuitBreaker?.failures || 0,
                            lastFailure: service.stats?.circuitBreaker?.lastFailure,
                            lastSuccess: service.stats?.circuitBreaker?.lastSuccess,
                            recoveryAttempts: service.stats?.circuitBreaker?.recoveryAttempts || 0
                        },
                        performance: service.stats?.performance || {},
                        lastError: service.stats?.history?.lastError,
                        lastErrorTime: service.stats?.history?.lastErrorTime,
                        ...state
                    };
                })
            );
            
            this.sendToClient(ws, {
                type: 'service:all-states',
                timestamp: new Date().toISOString(),
                states
            });
        } catch (error) {
            logApi.error('Error sending all service states:', error);
            this.sendError(ws, 'STATE_ERROR', 'Failed to retrieve service states');
        }
    }

    // Handle service subscription
    async handleSubscribe(ws, session, data) {
        try {
            const { services } = data;
            
            if (!Array.isArray(services) || services.length === 0) {
                return this.sendError(ws, 'INVALID_SUBSCRIPTION', 'Invalid service subscription list');
            }
            
            const validServices = [];
            const invalidServices = [];
            
            // Validate and process each service
            for (const service of services) {
                if (serviceManager.services.has(service)) {
                    // Add to session subscriptions
                    session.subscriptions.add(service);
                    
                    // Add to service subscribers
                    const subscribers = this.serviceSubscriptions.get(service) || new Set();
                    subscribers.add(ws);
                    this.serviceSubscriptions.set(service, subscribers);
                    
                    validServices.push(service);
                } else {
                    invalidServices.push(service);
                }
            }
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'subscription:confirmed',
                timestamp: new Date().toISOString(),
                services: validServices,
                invalid: invalidServices
            });
            
            // Log the subscription
            await AdminLogger.logAction(
                ws.user.id,
                'ADMIN_WS_SUBSCRIBE',
                {
                    action: 'subscribe',
                    services: validServices,
                    invalid: invalidServices
                }
            );
            
            // Send current state for these services
            for (const service of validServices) {
                await this.sendServiceState(service, ws);
            }
        } catch (error) {
            logApi.error('Error handling subscription:', error);
            this.sendError(ws, 'SUBSCRIPTION_ERROR', error.message);
        }
    }

    // Handle service unsubscription
    async handleUnsubscribe(ws, session, data) {
        try {
            const { services } = data;
            
            if (!Array.isArray(services) || services.length === 0) {
                return this.sendError(ws, 'INVALID_UNSUBSCRIPTION', 'Invalid service unsubscription list');
            }
            
            // Process each service
            for (const service of services) {
                // Remove from session subscriptions
                session.subscriptions.delete(service);
                
                // Remove from service subscribers
                const subscribers = this.serviceSubscriptions.get(service);
                if (subscribers) {
                    subscribers.delete(ws);
                    
                    if (subscribers.size === 0) {
                        this.serviceSubscriptions.delete(service);
                    } else {
                        this.serviceSubscriptions.set(service, subscribers);
                    }
                }
            }
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'unsubscription:confirmed',
                timestamp: new Date().toISOString(),
                services
            });
            
            // Log the unsubscription
            await AdminLogger.logAction(
                ws.user.id,
                'ADMIN_WS_UNSUBSCRIBE',
                {
                    action: 'unsubscribe',
                    services
                }
            );
        } catch (error) {
            logApi.error('Error handling unsubscription:', error);
            this.sendError(ws, 'UNSUBSCRIPTION_ERROR', error.message);
        }
    }

    // Handle service start request
    async handleServiceStart(ws, session, data) {
        try {
            const { service } = data;
            
            if (!service) {
                return this.sendError(ws, 'INVALID_SERVICE', 'Invalid service name');
            }
            
            // Validate service exists
            if (!serviceManager.services.has(service)) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${service} not found`);
            }
            
            // Create admin context for logging
            const adminContext = {
                adminAddress: ws.user.id,
                ip: ws._socket.remoteAddress,
                userAgent: ws.user.userAgent
            };
            
            // Start the service
            await serviceManager.startService(service, adminContext);
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'service:start-result',
                timestamp: new Date().toISOString(),
                service,
                success: true
            });
            
            // Update all subscribers with new state
            await this.broadcastServiceState(service);
        } catch (error) {
            logApi.error(`Error starting service ${data.service}:`, error);
            this.sendError(ws, 'SERVICE_START_ERROR', error.message);
        }
    }

    // Handle service stop request
    async handleServiceStop(ws, session, data) {
        try {
            const { service } = data;
            
            if (!service) {
                return this.sendError(ws, 'INVALID_SERVICE', 'Invalid service name');
            }
            
            // Validate service exists
            if (!serviceManager.services.has(service)) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${service} not found`);
            }
            
            // Create admin context for logging
            const adminContext = {
                adminAddress: ws.user.id,
                ip: ws._socket.remoteAddress,
                userAgent: ws.user.userAgent
            };
            
            // Stop the service
            await serviceManager.stopService(service, adminContext);
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'service:stop-result',
                timestamp: new Date().toISOString(),
                service,
                success: true
            });
            
            // Update all subscribers with new state
            await this.broadcastServiceState(service);
        } catch (error) {
            logApi.error(`Error stopping service ${data.service}:`, error);
            this.sendError(ws, 'SERVICE_STOP_ERROR', error.message);
        }
    }

    // Handle service restart request
    async handleServiceRestart(ws, session, data) {
        try {
            const { service } = data;
            
            if (!service) {
                return this.sendError(ws, 'INVALID_SERVICE', 'Invalid service name');
            }
            
            // Validate service exists
            if (!serviceManager.services.has(service)) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${service} not found`);
            }
            
            // Create admin context for logging
            const adminContext = {
                adminAddress: ws.user.id,
                ip: ws._socket.remoteAddress,
                userAgent: ws.user.userAgent
            };
            
            // Restart the service
            await serviceManager.restartService(service, adminContext);
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'service:restart-result',
                timestamp: new Date().toISOString(),
                service,
                success: true
            });
            
            // Update all subscribers with new state
            await this.broadcastServiceState(service);
        } catch (error) {
            logApi.error(`Error restarting service ${data.service}:`, error);
            this.sendError(ws, 'SERVICE_RESTART_ERROR', error.message);
        }
    }

    // Handle circuit breaker reset
    async handleCircuitBreakerReset(ws, session, data) {
        try {
            const { service } = data;
            
            if (!service) {
                return this.sendError(ws, 'INVALID_SERVICE', 'Invalid service name');
            }
            
            // Validate service exists
            const serviceInstance = serviceManager.services.get(service);
            if (!serviceInstance) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${service} not found`);
            }
            
            // Reset the circuit breaker
            await serviceInstance.attemptCircuitRecovery();
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'circuit-breaker:reset-result',
                timestamp: new Date().toISOString(),
                service,
                success: true
            });
            
            // Log the action
            await AdminLogger.logAction(
                ws.user.id,
                'CIRCUIT_BREAKER_RESET',
                {
                    service,
                    result: 'success'
                }
            );
            
            // Update all subscribers with new state
            await this.broadcastServiceState(service);
        } catch (error) {
            logApi.error(`Error resetting circuit breaker for ${data.service}:`, error);
            this.sendError(ws, 'CIRCUIT_BREAKER_RESET_ERROR', error.message);
        }
    }

    // Handle service configuration update
    async handleServiceConfigUpdate(ws, session, data) {
        try {
            const { service, config } = data;
            
            if (!service || !config) {
                return this.sendError(ws, 'INVALID_CONFIG_UPDATE', 'Invalid service or configuration');
            }
            
            // Validate service exists
            const serviceInstance = serviceManager.services.get(service);
            if (!serviceInstance) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${service} not found`);
            }
            
            // Update configuration
            const oldConfig = { ...serviceInstance.config };
            
            // Apply updates with validation
            const newConfig = this.validateAndUpdateConfig(serviceInstance.config, config);
            serviceInstance.config = newConfig;
            
            // Update state in database
            await serviceManager.updateServiceState(
                service,
                { running: serviceInstance.isStarted, status: 'config_updated' },
                newConfig,
                serviceInstance.stats
            );
            
            // Send confirmation
            this.sendToClient(ws, {
                type: 'service:config-update-result',
                timestamp: new Date().toISOString(),
                service,
                success: true,
                config: newConfig
            });
            
            // Log the configuration change
            await AdminLogger.logAction(
                ws.user.id,
                'SERVICE_CONFIG_UPDATE',
                {
                    service,
                    oldConfig,
                    newConfig,
                    changes: this.getConfigChanges(oldConfig, newConfig)
                }
            );
            
            // Update all subscribers with new state
            await this.broadcastServiceState(service);
        } catch (error) {
            logApi.error(`Error updating config for ${data.service}:`, error);
            this.sendError(ws, 'CONFIG_UPDATE_ERROR', error.message);
        }
    }

    // Validate and update configuration
    validateAndUpdateConfig(oldConfig, updates) {
        // Start with a copy of the old config
        const newConfig = { ...oldConfig };
        
        // Apply updates to allowed fields
        if (updates.checkIntervalMs !== undefined && typeof updates.checkIntervalMs === 'number') {
            newConfig.checkIntervalMs = Math.max(1000, updates.checkIntervalMs);
        }
        
        if (updates.maxRetries !== undefined && typeof updates.maxRetries === 'number') {
            newConfig.maxRetries = Math.max(0, updates.maxRetries);
        }
        
        if (updates.retryDelayMs !== undefined && typeof updates.retryDelayMs === 'number') {
            newConfig.retryDelayMs = Math.max(100, updates.retryDelayMs);
        }
        
        // Update circuit breaker config
        if (updates.circuitBreaker) {
            newConfig.circuitBreaker = {
                ...newConfig.circuitBreaker
            };
            
            if (updates.circuitBreaker.failureThreshold !== undefined) {
                newConfig.circuitBreaker.failureThreshold = 
                    Math.max(1, updates.circuitBreaker.failureThreshold);
            }
            
            if (updates.circuitBreaker.resetTimeoutMs !== undefined) {
                newConfig.circuitBreaker.resetTimeoutMs = 
                    Math.max(1000, updates.circuitBreaker.resetTimeoutMs);
            }
            
            if (updates.circuitBreaker.minHealthyPeriodMs !== undefined) {
                newConfig.circuitBreaker.minHealthyPeriodMs = 
                    Math.max(1000, updates.circuitBreaker.minHealthyPeriodMs);
            }
        }
        
        // Update backoff config
        if (updates.backoff) {
            newConfig.backoff = {
                ...newConfig.backoff
            };
            
            if (updates.backoff.initialDelayMs !== undefined) {
                newConfig.backoff.initialDelayMs = 
                    Math.max(100, updates.backoff.initialDelayMs);
            }
            
            if (updates.backoff.maxDelayMs !== undefined) {
                newConfig.backoff.maxDelayMs = 
                    Math.max(1000, updates.backoff.maxDelayMs);
            }
            
            if (updates.backoff.factor !== undefined) {
                newConfig.backoff.factor = 
                    Math.max(1.1, updates.backoff.factor);
            }
        }
        
        return newConfig;
    }

    // Handle health check for all services
    async handleHealthCheckAll(ws, session) {
        try {
            const services = Array.from(serviceManager.services.entries());
            const results = {};
            
            // Perform health checks in parallel
            await Promise.all(services.map(async ([name, service]) => {
                try {
                    const isHealthy = await serviceManager.checkServiceHealth(name);
                    results[name] = {
                        healthy: isHealthy,
                        error: null,
                        timestamp: new Date().toISOString()
                    };
                } catch (error) {
                    results[name] = {
                        healthy: false,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    };
                }
            }));
            
            // Send health check results
            this.sendToClient(ws, {
                type: 'health:check-results',
                timestamp: new Date().toISOString(),
                results
            });
            
            // Log the health check
            await AdminLogger.logAction(
                ws.user.id,
                'SERVICE_HEALTH_CHECK',
                {
                    results
                }
            );
            
            // Update all services after health check
            for (const name of Object.keys(results)) {
                await this.broadcastServiceState(name);
            }
        } catch (error) {
            logApi.error('Error performing health checks:', error);
            this.sendError(ws, 'HEALTH_CHECK_ERROR', error.message);
        }
    }

    // Send dependency graph
    async sendDependencyGraph(ws) {
        try {
            const graph = [];
            const services = Array.from(serviceManager.services.entries());
            
            for (const [name, service] of services) {
                const dependencies = service.config.dependencies || [];
                const dependents = services
                    .filter(([_, s]) => (s.config.dependencies || []).includes(name))
                    .map(([n, _]) => n);
                    
                graph.push({
                    service: name,
                    displayName: getServiceMetadata(name)?.displayName || name,
                    description: getServiceMetadata(name)?.description || '',
                    layer: getServiceMetadata(name)?.layer,
                    dependencies,
                    dependents,
                    operational: service.isOperational,
                    initialized: service.isInitialized,
                    started: service.isStarted
                });
            }
            
            this.sendToClient(ws, {
                type: 'dependency:graph',
                timestamp: new Date().toISOString(),
                graph
            });
        } catch (error) {
            logApi.error('Error sending dependency graph:', error);
            this.sendError(ws, 'DEPENDENCY_GRAPH_ERROR', error.message);
        }
    }

    // Broadcast service state to all subscribers
    async broadcastServiceState(serviceName) {
        const subscribers = this.serviceSubscriptions.get(serviceName);
        if (!subscribers || subscribers.size === 0) return;
        
        const service = serviceManager.services.get(serviceName);
        if (!service) return;
        
        const state = await serviceManager.getServiceState(serviceName);
        
        const message = {
            type: 'service:state',
            timestamp: new Date().toISOString(),
            service: serviceName,
            status: serviceManager.determineServiceStatus(service.stats),
            isOperational: service.isOperational,
            isInitialized: service.isInitialized,
            isStarted: service.isStarted || false,
            lastRun: service.stats?.lastRun || null,
            lastAttempt: service.stats?.lastAttempt || null,
            uptime: service.stats?.uptime || 0,
            operations: service.stats?.operations || { total: 0, successful: 0, failed: 0 },
            circuitBreaker: {
                isOpen: service.stats?.circuitBreaker?.isOpen || false,
                failures: service.stats?.circuitBreaker?.failures || 0,
                lastFailure: service.stats?.circuitBreaker?.lastFailure,
                lastSuccess: service.stats?.circuitBreaker?.lastSuccess,
                recoveryAttempts: service.stats?.circuitBreaker?.recoveryAttempts || 0
            },
            performance: service.stats?.performance || {},
            metrics: service.stats?.metrics || {},
            lastError: service.stats?.history?.lastError,
            lastErrorTime: service.stats?.history?.lastErrorTime,
            config: service.config,
            ...state
        };
        
        for (const ws of subscribers) {
            this.sendToClient(ws, message);
        }
    }

    // Start periodic updates
    startPeriodicUpdates() {
        // Update service states every 3 seconds
        setInterval(async () => {
            const services = Array.from(serviceManager.services.keys());
            
            for (const service of services) {
                await this.broadcastServiceState(service);
            }
        }, 3000);
    }

    // Get server metrics for monitoring
    getMetrics() {
        return {
            metrics: {
                totalConnections: this.adminSessions.size,
                subscriptions: this.serviceSubscriptions.size,
                lastUpdate: new Date().toISOString(),
                serviceCount: serviceManager.services.size
            },
            status: 'operational'
        };
    }
}

let instance = null;

// Create or get the SkyDuel WebSocket instance
export function createSkyDuelWebSocket(server) {
    if (!instance) {
        instance = new SkyDuelWebSocketServer(server);
    }
    return instance;
}

// Export the class for testing
export { SkyDuelWebSocketServer };

// Export the singleton instance
export default instance;
```

### 2. SkyDuel Management API (`routes/admin/skyduel-management.js`)

REST endpoints for initial setup and authentication:

```javascript
// routes/admin/skyduel-management.js

import express from 'express';
import { requireSuperAdmin } from '../../middleware/auth.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import AdminLogger from '../../utils/admin-logger.js';
import serviceManager from '../../utils/service-suite/service-manager.js';

const router = express.Router();

/**
 * Get quick status of all services for initial dashboard load
 */
router.get('/status', requireSuperAdmin, async (req, res) => {
    try {
        const services = Array.from(serviceManager.services.entries());
        const statuses = services.map(([name, service]) => ({
            name,
            status: serviceManager.determineServiceStatus(service.stats),
            isOperational: service.isOperational,
            isStarted: service.isStarted || false
        }));

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_SERVICE_STATUS',
            {
                count: statuses.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            services: statuses,
            timestamp: new Date().toISOString(),
            wsEndpoint: '/api/v2/ws/admin'
        });
    } catch (error) {
        logApi.error('Failed to get unified service status:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get a temporary auth token for WebSocket connection
 */
router.post('/websocket-auth', requireSuperAdmin, async (req, res) => {
    try {
        // Generate a temporary token based on session
        const tempToken = req.user.auth_token || req.headers.authorization?.split(' ')[1];
        
        if (!tempToken) {
            return res.status(401).json({
                success: false,
                error: 'No valid auth token found'
            });
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'WS_AUTH_TOKEN_REQUEST',
            {
                action: 'websocket_auth'
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            token: tempToken,
            expires: new Date(Date.now() + 300000).toISOString() // 5 minutes
        });
    } catch (error) {
        logApi.error('Failed to generate WebSocket auth token:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
```

### 3. WebSocket Initializer Update 

Update the existing WebSocket initializer to integrate our new WebSocket:

```javascript
// In websocket-initializer.js

import { createSkyDuelWebSocket } from '../../websocket/skyduel-ws.js';

// Inside initializeWebSockets function:
const wsServers = {
    // ... existing WebSockets
    
    // Add the SkyDuel WebSocket
    'SkyDuel': createSkyDuelWebSocket(server)
};
```

### 4. Main Index.js Update

Mount the new routes:

```javascript
// In index.js

import skyduelManagementRoutes from './routes/admin/skyduel-management.js';

// Mount the routes
app.use('/api/admin/skyduel', skyduelManagementRoutes);
```

## Frontend Integration

TypeScript client for React dashboard:

```typescript
/**
 * SkyDuelClient.ts
 * 
 * Client-side WebSocket manager for the SkyDuel Service dashboard
 */
export class SkyDuelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectTimeout: any = null;
  private heartbeatInterval: any = null;
  private services: Map<string, ServiceState> = new Map();
  private catalog: ServiceCatalogItem[] = [];
  private subscriptions: Set<string> = new Set();
  private isConnecting: boolean = false;
  private connectionAttempts: number = 0;
  private MAX_RECONNECT_DELAY = 30000; // 30 seconds

  constructor(baseUrl: string, token: string) {
    super();
    this.url = `${baseUrl}/api/v2/ws/admin`;
    this.token = token;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;
    this.connectionAttempts++;

    try {
      // Include token for authentication
      const wsUrl = `${this.url}?token=${this.token}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('WebSocket connection error:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  // Administrative actions
  public startService(service: string): void {
    this.send({
      type: 'service:start',
      service
    });
  }

  public stopService(service: string): void {
    this.send({
      type: 'service:stop',
      service
    });
  }

  public restartService(service: string): void {
    this.send({
      type: 'service:restart',
      service
    });
  }

  public resetCircuitBreaker(service: string): void {
    this.send({
      type: 'circuit-breaker:reset',
      service
    });
  }

  public updateServiceConfig(service: string, config: any): void {
    this.send({
      type: 'service:config-update',
      service,
      config
    });
  }

  public requestDependencyGraph(): void {
    this.send({
      type: 'get:dependency-graph'
    });
  }
}
```

## React Dashboard Components

Here's a high-level overview of the React components needed for the admin dashboard:

```jsx
// ServiceDashboard.jsx
import React, { useEffect, useState } from 'react';
import { SkyDuelClient } from './SkyDuelClient';
import ServiceCard from './ServiceCard';
import DependencyGraph from './DependencyGraph';
import CircuitBreakerPanel from './CircuitBreakerPanel';

function ServiceDashboard() {
  const [wsClient, setWsClient] = useState(null);
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  
  useEffect(() => {
    // Get auth token from API
    async function initWebSocket() {
      const res = await fetch('/api/admin/skyduel/websocket-auth', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      
      const data = await res.json();
      
      if (data.success) {
        const client = new SkyDuelClient(window.location.origin, data.token);
        
        client.on('connected', () => {
          console.log('Connected to service management');
        });
        
        client.on('catalog', (catalog) => {
          console.log('Received service catalog', catalog);
        });
        
        client.on('all-states', (states) => {
          setServices(states);
        });
        
        client.on('service-update', (serviceId, state) => {
          setServices(prev => {
            const newServices = [...prev];
            const index = newServices.findIndex(s => s.id === serviceId);
            
            if (index >= 0) {
              newServices[index] = state;
            }
            
            return newServices;
          });
        });
        
        client.connect();
        setWsClient(client);
      }
    }
    
    initWebSocket();
    
    return () => {
      if (wsClient) {
        wsClient.disconnect();
      }
    };
  }, []);
  
  return (
    <div className="dashboard">
      <h1>Service Management Dashboard</h1>
      
      <div className="service-grid">
        {services.map(service => (
          <ServiceCard 
            key={service.id}
            service={service}
            onSelect={() => setSelectedService(service)}
            onStart={() => wsClient.startService(service.id)}
            onStop={() => wsClient.stopService(service.id)}
            onRestart={() => wsClient.restartService(service.id)}
            onResetCircuitBreaker={() => wsClient.resetCircuitBreaker(service.id)}
          />
        ))}
      </div>
      
      {selectedService && (
        <div className="service-detail">
          <h2>{selectedService.name}</h2>
          <CircuitBreakerPanel service={selectedService} />
          <pre>{JSON.stringify(selectedService, null, 2)}</pre>
        </div>
      )}
      
      <DependencyGraph wsClient={wsClient} />
    </div>
  );
}

export default ServiceDashboard;
```

## Integration Plan

1. Create the `skyduel-ws.js` file in `/websocket/`
2. Create the `skyduel-management.js` file in `/routes/admin/`
3. Update `websocket-initializer.js` to include the SkyDuel WebSocket
4. Update `index.js` to mount the new routes
5. Test connection with a simple client tool like Postman or WebSocket client
6. Implement the frontend integration with the SkyDuelClient

## Deployment Checklist

- Backup existing service management code
- Test with a subset of services before full deployment
- Implement proper error handling and logging for each component
- Monitor performance during initial deployment
- Have fallback mechanisms ready in case of issues

## Key Features

1. **Real-time Service Monitoring**
   - Status, operations, and performance metrics
   - Last run/attempt times and uptime statistics
   - Circuit breaker state and history
   - Detailed service metrics

2. **Full Administrative Control**
   - Start/stop/restart services with one click
   - Reset circuit breakers
   - Update configuration with validation
   - Health check system

3. **Security**
   - Strict superadmin-only access
   - Authentication token system with expiration
   - Comprehensive action logging

4. **Resilience**
   - Automatic reconnection with backoff
   - Heartbeat mechanism to detect connection issues
   - Robust error handling and reporting
   - Backward compatibility during transition

5. **Advanced Visualization**
   - Interactive service dependency graph
   - Real-time performance monitoring
   - Circuit breaker status indicators
   - Service health history