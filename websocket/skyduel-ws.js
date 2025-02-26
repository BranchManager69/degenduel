// websocket/skyduel-ws.js

/**
 * SkyDuel WebSocket Server
 * 
 * Unified service management system that provides real-time monitoring and control of services
 * with detailed metrics, circuit breaker states, and dependency visualization.
 * 
 * Features:
 * - Real-time monitoring of all services
 * - Administrative control (start/stop/restart)
 * - Circuit breaker management
 * - Dependency visualization
 * - Service state and config updates
 */

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { logApi } from '../utils/logger-suite/logger.js';
import serviceManager from '../utils/service-suite/service-manager.js';
import { SERVICE_NAMES, getServiceMetadata } from '../utils/service-suite/service-constants.js';
import AdminLogger from '../utils/admin-logger.js';
import { getCircuitBreakerConfig } from '../utils/service-suite/circuit-breaker-config.js';

class SkyDuelWebSocketServer {
    constructor(server) {
        if (!server) {
            throw new Error('HTTP server instance is required to initialize SkyDuel WebSocket');
        }

        this.wss = new WebSocket.Server({ 
            server, 
            path: '/api/v2/ws/skyduel'
        });

        this.adminSessions = new Map(); // Map of active admin sessions
        this.serviceSubscriptions = new Map(); // Map of service name to set of WebSocket connections
        this.connectionHeartbeats = new Map(); // Map of WebSocket connections to last heartbeat time
        
        this.initialize();
        logApi.info('SkyDuel WebSocket server initialized');
    }

    initialize() {
        this.wss.on('connection', this.handleConnection.bind(this));
        this.wss.on('error', (error) => {
            logApi.error('SkyDuel WebSocket server error:', error);
        });

        // Start heartbeat check interval
        setInterval(() => {
            this.checkHeartbeats();
        }, 30000); // Check every 30 seconds

        // Start periodic updates
        this.startPeriodicUpdates();
    }

    async checkHeartbeats() {
        const now = Date.now();
        
        // Check each connection's heartbeat
        for (const [ws, lastHeartbeat] of this.connectionHeartbeats.entries()) {
            if (now - lastHeartbeat > 60000) { // 60 seconds timeout
                logApi.warn('SkyDuel connection timed out, terminating');
                this.cleanupConnection(ws);
                
                try {
                    ws.terminate();
                } catch (error) {
                    // Already closed
                }
            }
        }
    }

    // Handle new WebSocket connections
    async handleConnection(ws, req) {
        try {
            // Get token from query params
            const url = new URL(req.url, `http://${req.headers.host}`);
            const token = url.searchParams.get('token');
            
            // Validate token and get user information
            const user = await this.validateToken(token);
            
            if (!user || !user.isSuperAdmin) {
                logApi.warn('Unauthorized SkyDuel connection attempt', {
                    ip: req.socket.remoteAddress,
                    token_provided: !!token
                });
                
                ws.send(JSON.stringify({
                    type: 'error',
                    code: 'UNAUTHORIZED',
                    message: 'Unauthorized access'
                }));
                
                ws.close();
                return;
            }
            
            // Get client info for logging
            const clientInfo = {
                ip: req.socket.remoteAddress,
                userAgent: req.headers['user-agent'] || 'Unknown',
                userId: user.id
            };
            
            // Store admin session
            this.adminSessions.set(ws, {
                user,
                authenticated: true,
                clientInfo,
                subscriptions: new Set()
            });
            
            // Log admin connection
            logApi.info('Admin connected to SkyDuel', { 
                adminId: user.id, 
                ip: clientInfo.ip, 
                connections: this.adminSessions.size 
            });
            
            // Register event handlers for this connection
            ws.on('message', (message) => this.handleMessage(ws, message, user));
            ws.on('close', () => this.handleClose(ws, user));
            ws.on('error', (error) => this.handleError(ws, error, user));
            
            // Set initial heartbeat
            this.connectionHeartbeats.set(ws, Date.now());
            
            // Send welcome message
            this.sendToClient(ws, {
                type: 'welcome',
                message: 'SkyDuel service management connection established',
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            });
            
            // Log admin action
            await AdminLogger.logAction(
                user.id,
                'SKYDUEL_CONNECTION',
                {
                    action: 'connect',
                    connectionTime: new Date().toISOString()
                },
                {
                    ip_address: clientInfo.ip,
                    user_agent: clientInfo.userAgent
                }
            );
            
            // Send initial service catalog
            this.sendServiceCatalog(ws);
            
            // Send initial service states
            this.sendAllServiceStates(ws);
            
            // Send dependency graph
            this.sendDependencyGraph(ws);
        } catch (error) {
            logApi.error('Error handling SkyDuel connection:', error);
            
            try {
                ws.send(JSON.stringify({
                    type: 'error',
                    code: 'CONNECTION_ERROR',
                    message: 'Error establishing connection'
                }));
                
                ws.close();
            } catch (closeError) {
                // Ignore errors during close
            }
        }
    }

    // Validate authentication token
    async validateToken(token) {
        if (!token) return null;
        
        try {
            // Verify the token
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
            
            // Check if the user is a super admin
            if (decoded && decoded.userRole === 'superadmin') {
                return {
                    id: decoded.userId,
                    username: decoded.username,
                    isSuperAdmin: true
                };
            }
            
            return null;
        } catch (error) {
            logApi.error('Token validation error:', error);
            return null;
        }
    }

    // Handle incoming messages
    async handleMessage(ws, message, user) {
        try {
            // Parse message
            const data = JSON.parse(message);
            
            // Reset heartbeat
            this.connectionHeartbeats.set(ws, Date.now());
            
            // Handle message by type
            switch (data.type) {
                case 'heartbeat':
                    this.handleHeartbeat(ws);
                    break;
                    
                case 'service:subscribe':
                    await this.handleServiceSubscribe(ws, data, user);
                    break;
                    
                case 'service:unsubscribe':
                    await this.handleServiceUnsubscribe(ws, data, user);
                    break;
                    
                case 'service:start':
                    await this.handleServiceStart(ws, data, user);
                    break;
                    
                case 'service:stop':
                    await this.handleServiceStop(ws, data, user);
                    break;
                    
                case 'service:restart':
                    await this.handleServiceRestart(ws, data, user);
                    break;
                    
                case 'circuit-breaker:reset':
                    await this.handleCircuitBreakerReset(ws, data, user);
                    break;
                    
                case 'get:service-catalog':
                    await this.sendServiceCatalog(ws);
                    break;
                    
                case 'get:service-state':
                    await this.sendServiceState(ws, data.service);
                    break;
                    
                case 'get:all-states':
                    await this.sendAllServiceStates(ws);
                    break;
                    
                case 'get:dependency-graph':
                    await this.sendDependencyGraph(ws);
                    break;
                    
                case 'service:config-update':
                    await this.handleConfigUpdate(ws, data, user);
                    break;
                    
                default:
                    this.sendError(ws, 'UNKNOWN_COMMAND', `Unknown command: ${data.type}`);
            }
        } catch (error) {
            logApi.error('Error handling message:', error);
            this.sendError(ws, 'MESSAGE_ERROR', 'Error processing message');
        }
    }

    // Handle connection close
    handleClose(ws, user) {
        try {
            // Log admin disconnection
            if (user) {
                logApi.info('Admin disconnected from SkyDuel', {
                    adminId: user.id,
                    connections: this.adminSessions.size - 1
                });
            }
            
            // Clean up connection resources
            this.cleanupConnection(ws);
        } catch (error) {
            logApi.error('Error handling connection close:', error);
        }
    }

    // Handle connection errors
    handleError(ws, error, user) {
        logApi.error('SkyDuel connection error:', error);
        
        try {
            // Clean up connection resources
            this.cleanupConnection(ws);
        } catch (cleanupError) {
            logApi.error('Error cleaning up connection:', cleanupError);
        }
    }

    // Handle client heartbeat messages
    handleHeartbeat(ws) {
        this.connectionHeartbeats.set(ws, Date.now());
        
        this.sendToClient(ws, {
            type: 'heartbeat:ack',
            timestamp: new Date().toISOString()
        });
    }

    // Handle service subscription
    async handleServiceSubscribe(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Add to service-specific subscriptions
            let serviceSubscribers = this.serviceSubscriptions.get(serviceName);
            if (!serviceSubscribers) {
                serviceSubscribers = new Set();
                this.serviceSubscriptions.set(serviceName, serviceSubscribers);
            }
            serviceSubscribers.add(ws);
            
            // Add to session subscriptions
            session.subscriptions.add(serviceName);
            
            // Send current service state
            await this.sendServiceState(ws, serviceName);
            
            // Log subscription
            logApi.info(`Admin subscribed to service: ${serviceName}`, {
                adminId: user.id,
                subscribers: serviceSubscribers.size
            });
            
            this.sendToClient(ws, {
                type: 'subscription:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error('Error handling service subscription:', error);
            this.sendError(ws, 'SUBSCRIPTION_ERROR', 'Error subscribing to service');
        }
    }

    // Handle service unsubscription
    async handleServiceUnsubscribe(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Remove from service-specific subscriptions
            const serviceSubscribers = this.serviceSubscriptions.get(serviceName);
            if (serviceSubscribers) {
                serviceSubscribers.delete(ws);
                
                if (serviceSubscribers.size === 0) {
                    this.serviceSubscriptions.delete(serviceName);
                }
            }
            
            // Remove from session subscriptions
            session.subscriptions.delete(serviceName);
            
            // Log unsubscription
            logApi.info(`Admin unsubscribed from service: ${serviceName}`, {
                adminId: user.id,
                remainingSubscribers: (serviceSubscribers?.size || 0)
            });
            
            this.sendToClient(ws, {
                type: 'unsubscription:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error('Error handling service unsubscription:', error);
            this.sendError(ws, 'UNSUBSCRIPTION_ERROR', 'Error unsubscribing from service');
        }
    }

    // Handle service start request
    async handleServiceStart(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Get admin context for logging
            const adminContext = {
                adminAddress: user.id,
                ip: session.clientInfo.ip,
                userAgent: session.clientInfo.userAgent
            };
            
            // Start the service
            await serviceManager.startService(serviceName, adminContext);
            
            // Send updated state
            await this.sendServiceState(ws, serviceName);
            
            this.sendToClient(ws, {
                type: 'service:start:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Error starting service: ${data.service}`, error);
            this.sendError(ws, 'SERVICE_START_ERROR', `Error starting service: ${error.message}`);
        }
    }

    // Handle service stop request
    async handleServiceStop(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Get admin context for logging
            const adminContext = {
                adminAddress: user.id,
                ip: session.clientInfo.ip,
                userAgent: session.clientInfo.userAgent
            };
            
            // Stop the service
            await serviceManager.stopService(serviceName, adminContext);
            
            // Send updated state
            await this.sendServiceState(ws, serviceName);
            
            this.sendToClient(ws, {
                type: 'service:stop:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Error stopping service: ${data.service}`, error);
            this.sendError(ws, 'SERVICE_STOP_ERROR', `Error stopping service: ${error.message}`);
        }
    }

    // Handle service restart request
    async handleServiceRestart(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Get admin context for logging
            const adminContext = {
                adminAddress: user.id,
                ip: session.clientInfo.ip,
                userAgent: session.clientInfo.userAgent
            };
            
            // Restart the service
            await serviceManager.restartService(serviceName, adminContext);
            
            // Send updated state
            await this.sendServiceState(ws, serviceName);
            
            this.sendToClient(ws, {
                type: 'service:restart:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Error restarting service: ${data.service}`, error);
            this.sendError(ws, 'SERVICE_RESTART_ERROR', `Error restarting service: ${error.message}`);
        }
    }

    // Handle circuit breaker reset request
    async handleCircuitBreakerReset(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            const serviceName = data.service;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Get service instance
            const service = serviceManager.services.get(serviceName);
            if (!service) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${serviceName} not found`);
            }
            
            // Reset circuit breaker
            if (service.resetCircuitBreaker) {
                await service.resetCircuitBreaker();
            } else {
                // Manually reset stats if method doesn't exist
                if (service.stats && service.stats.circuitBreaker) {
                    service.stats.circuitBreaker.isOpen = false;
                    service.stats.circuitBreaker.failures = 0;
                    service.stats.circuitBreaker.lastReset = new Date().toISOString();
                }
                
                // Call service manager to mark as recovered
                await serviceManager.markServiceRecovered(serviceName);
            }
            
            // Log admin action
            await AdminLogger.logAction(
                user.id,
                'RESET_CIRCUIT_BREAKER',
                {
                    service: serviceName,
                    action: 'reset',
                    timestamp: new Date().toISOString()
                },
                {
                    ip_address: session.clientInfo.ip,
                    user_agent: session.clientInfo.userAgent
                }
            );
            
            // Send updated state
            await this.sendServiceState(ws, serviceName);
            
            this.sendToClient(ws, {
                type: 'circuit-breaker:reset:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Error resetting circuit breaker for service: ${data.service}`, error);
            this.sendError(ws, 'CIRCUIT_BREAKER_RESET_ERROR', `Error resetting circuit breaker: ${error.message}`);
        }
    }

    // Handle service configuration update
    async handleConfigUpdate(ws, data, user) {
        try {
            if (!data.service) {
                return this.sendError(ws, 'MISSING_SERVICE', 'Service name is required');
            }
            
            if (!data.config) {
                return this.sendError(ws, 'MISSING_CONFIG', 'Configuration is required');
            }
            
            const serviceName = data.service;
            const newConfig = data.config;
            const session = this.adminSessions.get(ws);
            
            if (!session) {
                return this.sendError(ws, 'SESSION_ERROR', 'Session not found');
            }
            
            // Get service instance
            const service = serviceManager.services.get(serviceName);
            if (!service) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${serviceName} not found`);
            }
            
            // Update configuration (if service supports it)
            if (service.updateConfig) {
                await service.updateConfig(newConfig);
            } else {
                // Fallback to manual config update
                Object.assign(service.config, newConfig);
            }
            
            // Log admin action
            await AdminLogger.logAction(
                user.id,
                'UPDATE_SERVICE_CONFIG',
                {
                    service: serviceName,
                    configUpdated: Object.keys(newConfig),
                    timestamp: new Date().toISOString()
                },
                {
                    ip_address: session.clientInfo.ip,
                    user_agent: session.clientInfo.userAgent
                }
            );
            
            // Send updated state
            await this.sendServiceState(ws, serviceName);
            
            this.sendToClient(ws, {
                type: 'service:config-update:success',
                service: serviceName,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Error updating configuration for service: ${data.service}`, error);
            this.sendError(ws, 'CONFIG_UPDATE_ERROR', `Error updating configuration: ${error.message}`);
        }
    }

    // Clean up connection resources
    cleanupConnection(ws) {
        // Get session
        const session = this.adminSessions.get(ws);
        
        if (session) {
            // Remove from service subscriptions
            for (const serviceName of session.subscriptions) {
                const subscribers = this.serviceSubscriptions.get(serviceName);
                if (subscribers) {
                    subscribers.delete(ws);
                    
                    if (subscribers.size === 0) {
                        this.serviceSubscriptions.delete(serviceName);
                    }
                }
            }
            
            // Remove from admin sessions
            this.adminSessions.delete(ws);
        }
        
        // Remove from heartbeats
        this.connectionHeartbeats.delete(ws);
    }

    // Send error message to client
    sendError(ws, code, message) {
        this.sendToClient(ws, {
            type: 'error',
            code,
            message,
            timestamp: new Date().toISOString()
        });
    }

    // Send message to client
    sendToClient(ws, data) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(data));
            }
        } catch (error) {
            logApi.error('Error sending message to client:', error);
        }
    }

    // Send service catalog to client
    async sendServiceCatalog(ws) {
        try {
            // Get all service names
            const serviceNames = Array.from(serviceManager.services.keys());
            
            // Build catalog entries
            const catalog = [];
            for (const name of serviceNames) {
                const metadata = getServiceMetadata(name);
                
                catalog.push({
                    id: name,
                    displayName: metadata?.displayName || name,
                    type: metadata?.type || 'service',
                    layer: metadata?.layer || 'unknown',
                    description: metadata?.description || '',
                    category: metadata?.category || 'general',
                    critical: metadata?.criticalLevel > 0 || false
                });
            }
            
            this.sendToClient(ws, {
                type: 'service:catalog',
                timestamp: new Date().toISOString(),
                catalog
            });
        } catch (error) {
            logApi.error('Error sending service catalog:', error);
            this.sendError(ws, 'CATALOG_ERROR', 'Error retrieving service catalog');
        }
    }

    // Send service state to client
    async sendServiceState(ws, serviceName) {
        try {
            const service = serviceManager.services.get(serviceName);
            if (!service) {
                return this.sendError(ws, 'SERVICE_NOT_FOUND', `Service ${serviceName} not found`);
            }
            
            const state = await serviceManager.getServiceState(serviceName);
            
            this.sendToClient(ws, {
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
            });
        } catch (error) {
            logApi.error(`Error sending service state for ${serviceName}:`, error);
            this.sendError(ws, 'STATE_ERROR', `Error retrieving service state for ${serviceName}`);
        }
    }

    // Send all service states to client
    async sendAllServiceStates(ws) {
        try {
            const states = [];
            const services = Array.from(serviceManager.services.entries());
            
            for (const [name, service] of services) {
                try {
                    const state = await serviceManager.getServiceState(name);
                    
                    states.push({
                        id: name,
                        displayName: getServiceMetadata(name)?.displayName || name,
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
                            failures: service.stats?.circuitBreaker?.failures || 0
                        },
                        layer: getServiceMetadata(name)?.layer || 'unknown',
                        lastError: service.stats?.history?.lastError,
                        lastErrorTime: service.stats?.history?.lastErrorTime,
                        ...state
                    });
                } catch (stateError) {
                    logApi.error(`Error getting state for service ${name}:`, stateError);
                    // Include minimal info for failed service
                    states.push({
                        id: name,
                        displayName: getServiceMetadata(name)?.displayName || name,
                        status: 'error',
                        error: stateError.message,
                        layer: getServiceMetadata(name)?.layer || 'unknown'
                    });
                }
            }
            
            this.sendToClient(ws, {
                type: 'all-states',
                timestamp: new Date().toISOString(),
                states
            });
        } catch (error) {
            logApi.error('Error sending all service states:', error);
            this.sendError(ws, 'ALL_STATES_ERROR', 'Error retrieving service states');
        }
    }

    // Send service dependency graph
    async sendDependencyGraph(ws) {
        try {
            const graph = [];
            const services = Array.from(serviceManager.services.entries());
            
            for (const [name, service] of services) {
                // Get direct dependencies
                const dependencies = serviceManager.dependencies.get(name) || [];
                
                // Get dependents (services that depend on this one)
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