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
 * @route GET /api/admin/skyduel/status
 * @desc Get quick status of all services for initial dashboard load
 * @access Super Admin
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
            wsEndpoint: '/api/v2/ws/skyduel'
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
 * @route POST /api/admin/skyduel/websocket-auth
 * @desc Get a temporary auth token for WebSocket connection
 * @access Super Admin
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

/**
 * @route GET /api/admin/skyduel/services
 * @desc Get detailed information about all services
 * @access Super Admin
 */
router.get('/services', requireSuperAdmin, async (req, res) => {
    try {
        const serviceDetails = [];
        const services = Array.from(serviceManager.services.entries());
        
        for (const [name, service] of services) {
            try {
                const state = await serviceManager.getServiceState(name);
                
                serviceDetails.push({
                    id: name,
                    displayName: service.config?.displayName || name,
                    status: serviceManager.determineServiceStatus(service.stats),
                    isOperational: service.isOperational,
                    isInitialized: service.isInitialized,
                    isStarted: service.isStarted || false,
                    lastRun: service.stats?.lastRun,
                    lastAttempt: service.stats?.lastAttempt,
                    uptime: service.stats?.uptime,
                    circuitBreaker: {
                        isOpen: service.stats?.circuitBreaker?.isOpen || false,
                        failures: service.stats?.circuitBreaker?.failures || 0
                    },
                    operations: service.stats?.operations,
                    state
                });
            } catch (error) {
                logApi.error(`Error getting state for service ${name}:`, error);
                serviceDetails.push({
                    id: name,
                    displayName: service.config?.displayName || name,
                    status: 'error',
                    error: error.message
                });
            }
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_DETAILED_SERVICE_STATUS',
            {
                count: serviceDetails.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            services: serviceDetails,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to get detailed service information:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route GET /api/admin/skyduel/dependency-graph
 * @desc Get service dependency graph
 * @access Super Admin
 */
router.get('/dependency-graph', requireSuperAdmin, async (req, res) => {
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
                displayName: service.config?.displayName || name,
                description: service.config?.description || '',
                layer: service.config?.layer,
                dependencies,
                dependents,
                operational: service.isOperational,
                initialized: service.isInitialized,
                started: service.isStarted
            });
        }

        // Log the admin action
        await AdminLogger.logAction(
            req.user.id,
            'GET_DEPENDENCY_GRAPH',
            {
                serviceCount: graph.length
            },
            {
                ip_address: req.ip
            }
        );

        res.json({
            success: true,
            graph,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to generate dependency graph:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/start
 * @desc Start a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/start', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Start the service
        await serviceManager.startService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'start',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to start service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'start',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/stop
 * @desc Stop a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/stop', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Stop the service
        await serviceManager.stopService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'stop',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to stop service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'stop',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/restart
 * @desc Restart a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/restart', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Create admin context for logging
        const adminContext = {
            adminAddress: req.user.id,
            ip: req.ip,
            userAgent: req.headers['user-agent'] || 'Unknown'
        };
        
        // Restart the service
        await serviceManager.restartService(serviceName, adminContext);
        
        res.json({
            success: true,
            service: serviceName,
            action: 'restart',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to restart service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'restart',
            error: error.message
        });
    }
});

/**
 * @route POST /api/admin/skyduel/services/:serviceName/reset-circuit-breaker
 * @desc Reset circuit breaker for a specific service
 * @access Super Admin
 */
router.post('/services/:serviceName/reset-circuit-breaker', requireSuperAdmin, async (req, res) => {
    const { serviceName } = req.params;
    
    try {
        // Get service instance
        const service = serviceManager.services.get(serviceName);
        if (!service) {
            return res.status(404).json({
                success: false,
                service: serviceName,
                action: 'reset-circuit-breaker',
                error: `Service ${serviceName} not found`
            });
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
            req.user.id,
            'RESET_CIRCUIT_BREAKER',
            {
                service: serviceName,
                action: 'reset',
                timestamp: new Date().toISOString()
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent'] || 'Unknown'
            }
        );
        
        res.json({
            success: true,
            service: serviceName,
            action: 'reset-circuit-breaker',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error(`Failed to reset circuit breaker for service ${serviceName}:`, error);
        res.status(500).json({
            success: false,
            service: serviceName,
            action: 'reset-circuit-breaker',
            error: error.message
        });
    }
});

export default router;
```

### 3. WebSocket Initializer Update 

Update the existing WebSocket initializer to integrate our SkyDuel WebSocket:

```javascript
// In utils/websocket-suite/websocket-initializer.js (partial update)

import { logApi } from '../logger-suite/logger.js';
import InitLogger from '../logger-suite/init-logger.js';
import { createWebSocketMonitor } from '../../websocket/monitor-ws.js';
import { createCircuitBreakerWebSocket } from '../../websocket/circuit-breaker-ws.js';
import { createAnalyticsWebSocket } from '../../websocket/analytics-ws.js';
import { createPortfolioWebSocket } from '../../websocket/portfolio-ws.js';
import { createMarketDataWebSocket } from '../../websocket/market-ws.js';
import { createWalletWebSocket } from '../../websocket/wallet-ws.js';
import { createContestWebSocket } from '../../websocket/contest-ws.js';
import { createTokenDataWebSocket } from '../../websocket/token-data-ws.js';
import { createUserNotificationWebSocket } from '../../websocket/user-notification-ws.js';
import { createSkyDuelWebSocket } from '../../websocket/skyduel-ws.js';

// Inside initializeWebSockets function
const wsServers = {
    // Standard names matching frontend expectations
    'Monitor': wsMonitor,
    'Circuit Breaker': createCircuitBreakerWebSocket(server),
    'Analytics': createAnalyticsWebSocket(server),
    'Market': createMarketDataWebSocket(server),
    'Portfolio': createPortfolioWebSocket(server),
    'Wallet': createWalletWebSocket(server), 
    'Contest': createContestWebSocket(server),
    
    // Additional services with formatted names
    'Token Data': createTokenDataWebSocket(server),
    'Notifications': createUserNotificationWebSocket(server),
    
    // Unified service management system
    'SkyDuel': createSkyDuelWebSocket(server),
    
    // Include Base WebSocket reference for dependency tracking
    'Base': null  // Base is a class, not an instance
};
```

### 4. Main Index.js Update

Mount the new routes in the main index.js:

```javascript
// In index.js (partial update)

// Import SkyDuel management routes
import skyduelManagementRoutes from "./routes/admin/skyduel-management.js";

// Mount the routes (in the Admin Routes section)
app.use("/api/admin/skyduel", skyduelManagementRoutes);
```

## Frontend Integration

This section provides the TypeScript client and React components for the frontend team to integrate with the SkyDuel system.

### TypeScript Client

```typescript
/**
 * SkyDuelClient.ts
 * Client-side WebSocket manager for the SkyDuel service dashboard
 */
import { EventEmitter } from 'events';

export interface ServiceState {
  id: string;
  displayName: string;
  status: string;
  isOperational: boolean;
  isInitialized: boolean;
  isStarted: boolean;
  lastRun?: string;
  lastAttempt?: string;
  uptime: number;
  operations: {
    total: number;
    successful: number;
    failed: number;
  };
  circuitBreaker: {
    isOpen: boolean;
    failures: number;
    lastFailure?: string;
    lastSuccess?: string;
    recoveryAttempts: number;
  };
  performance?: any;
  metrics?: any;
  lastError?: string;
  lastErrorTime?: string;
  config?: any;
}

export interface ServiceCatalogItem {
  id: string;
  displayName: string;
  type: string;
  layer: string;
  description: string;
  category: string;
  critical: boolean;
}

export interface DependencyGraphNode {
  service: string;
  displayName: string;
  description: string;
  layer?: string;
  dependencies: string[];
  dependents: string[];
  operational: boolean;
  initialized: boolean;
  started: boolean;
}

export class SkyDuelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private reconnectTimeout: any = null;
  private heartbeatInterval: any = null;
  private services: Map<string, ServiceState> = new Map();
  private catalog: ServiceCatalogItem[] = [];
  private dependencyGraph: DependencyGraphNode[] = [];
  private subscriptions: Set<string> = new Set();
  private isConnecting: boolean = false;
  private connectionAttempts: number = 0;
  private MAX_RECONNECT_DELAY = 30000; // 30 seconds

  constructor(baseUrl: string, token: string) {
    super();
    this.url = `${baseUrl}/api/v2/ws/skyduel`; // Updated path
    this.token = token;
  }

  /**
   * Connect to the SkyDuel WebSocket server
   */
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

  /**
   * Disconnect from the WebSocket server
   */
  public disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      this.ws = null;
    }
  }

  /**
   * Subscribe to updates for specific services
   */
  public subscribeToService(service: string): void {
    if (!this.subscriptions.has(service)) {
      this.subscriptions.add(service);
      this.send({
        type: 'service:subscribe',
        service
      });
    }
  }

  /**
   * Unsubscribe from service updates
   */
  public unsubscribeFromService(service: string): void {
    if (this.subscriptions.has(service)) {
      this.subscriptions.delete(service);
      this.send({
        type: 'service:unsubscribe',
        service
      });
    }
  }

  /**
   * Start a service
   */
  public startService(service: string): void {
    this.send({
      type: 'service:start',
      service
    });
  }

  /**
   * Stop a service
   */
  public stopService(service: string): void {
    this.send({
      type: 'service:stop',
      service
    });
  }

  /**
   * Restart a service
   */
  public restartService(service: string): void {
    this.send({
      type: 'service:restart',
      service
    });
  }

  /**
   * Reset circuit breaker for a service
   */
  public resetCircuitBreaker(service: string): void {
    this.send({
      type: 'circuit-breaker:reset',
      service
    });
  }

  /**
   * Update service configuration
   */
  public updateServiceConfig(service: string, config: any): void {
    this.send({
      type: 'service:config-update',
      service,
      config
    });
  }

  /**
   * Request a dependency graph
   */
  public requestDependencyGraph(): void {
    this.send({
      type: 'get:dependency-graph'
    });
  }

  /**
   * Request the current state of all services
   */
  public requestAllServiceStates(): void {
    this.send({
      type: 'get:all-states'
    });
  }

  /**
   * Request service catalog
   */
  public requestServiceCatalog(): void {
    this.send({
      type: 'get:service-catalog'
    });
  }

  /**
   * Request state for a specific service
   */
  public requestServiceState(service: string): void {
    this.send({
      type: 'get:service-state',
      service
    });
  }

  // Private methods

  private handleOpen(): void {
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.emit('connected');

    // Set up heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'heartbeat' });
    }, 30000);

    // Re-subscribe to previous subscriptions
    this.subscriptions.forEach(service => {
      this.send({
        type: 'service:subscribe',
        service
      });
    });

    // Request initial data
    this.requestServiceCatalog();
    this.requestAllServiceStates();
    this.requestDependencyGraph();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'welcome':
          this.emit('welcome', data);
          break;
          
        case 'service:catalog':
          this.catalog = data.catalog;
          this.emit('catalog', data.catalog);
          break;
          
        case 'all-states':
          data.states.forEach((state: ServiceState) => {
            this.services.set(state.id, state);
          });
          this.emit('all-states', data.states);
          break;
          
        case 'service:state':
          this.services.set(data.service, data);
          this.emit('service-update', data.service, data);
          break;
          
        case 'dependency:graph':
          this.dependencyGraph = data.graph;
          this.emit('dependency-graph', data.graph);
          break;
          
        case 'error':
          this.emit('error', data);
          break;
          
        case 'heartbeat:ack':
          this.emit('heartbeat', data);
          break;
          
        case 'subscription:success':
          this.emit('subscription', data.service, true);
          break;
          
        case 'unsubscription:success':
          this.emit('subscription', data.service, false);
          break;
          
        case 'service:start:success':
        case 'service:stop:success':
        case 'service:restart:success':
          this.emit('service-control', data);
          break;
          
        case 'circuit-breaker:reset:success':
          this.emit('circuit-breaker-reset', data);
          break;
          
        case 'service:config-update:success':
          this.emit('config-update', data);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.isConnecting = false;
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.emit('disconnected', event.code, event.reason);
    this.scheduleReconnect();
  }

  private handleError(event: Event): void {
    this.isConnecting = false;
    this.emit('connection-error', event);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    // Exponential backoff with jitter, capped at MAX_RECONNECT_DELAY
    const delay = Math.min(
      1000 * Math.pow(1.5, this.connectionAttempts) + Math.random() * 1000,
      this.MAX_RECONNECT_DELAY
    );
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
    
    this.emit('reconnecting', this.connectionAttempts, delay);
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not open, message not sent:', data);
    }
  }
}
```

### React Components

```jsx
// ServiceDashboard.jsx
import React, { useEffect, useState } from 'react';
import { SkyDuelClient } from './SkyDuelClient';
import ServiceCard from './ServiceCard';
import DependencyGraph from './DependencyGraph';
import ServiceDetail from './ServiceDetail';

function ServiceDashboard() {
  const [wsClient, setWsClient] = useState(null);
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  
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
          setConnectionStatus('connected');
        });
        
        client.on('disconnected', () => {
          setConnectionStatus('disconnected');
        });
        
        client.on('reconnecting', (attempts, delay) => {
          setConnectionStatus(`reconnecting (attempt ${attempts})`);
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
          
          // Update selected service if it's the one that changed
          if (selectedService && selectedService.id === serviceId) {
            setSelectedService(state);
          }
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
  
  const handleServiceAction = (serviceId, action) => {
    if (!wsClient) return;
    
    switch (action) {
      case 'start':
        wsClient.startService(serviceId);
        break;
      case 'stop':
        wsClient.stopService(serviceId);
        break;
      case 'restart':
        wsClient.restartService(serviceId);
        break;
      case 'reset-circuit-breaker':
        wsClient.resetCircuitBreaker(serviceId);
        break;
      default:
        console.warn('Unknown action:', action);
    }
  };
  
  const handleUpdateConfig = (serviceId, config) => {
    if (!wsClient) return;
    wsClient.updateServiceConfig(serviceId, config);
  };
  
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Service Management Dashboard</h1>
        <div className={`connection-status ${connectionStatus}`}>
          {connectionStatus}
        </div>
      </header>
      
      <div className="service-grid">
        {services.map(service => (
          <ServiceCard 
            key={service.id}
            service={service}
            onSelect={() => setSelectedService(service)}
            onAction={(action) => handleServiceAction(service.id, action)}
          />
        ))}
      </div>
      
      {selectedService && (
        <ServiceDetail 
          service={selectedService}
          onAction={(action) => handleServiceAction(selectedService.id, action)}
          onUpdateConfig={(config) => handleUpdateConfig(selectedService.id, config)}
        />
      )}
      
      <DependencyGraph wsClient={wsClient} />
    </div>
  );
}

export default ServiceDashboard;
```

## WebSocket Message Types

### Client → Server:

```javascript
// Heartbeat (keep connection alive)
{ "type": "heartbeat" }

// Service subscription
{ "type": "service:subscribe", "service": "tokenSyncService" }

// Service unsubscription
{ "type": "service:unsubscribe", "service": "tokenSyncService" }

// Service control
{ "type": "service:start", "service": "tokenSyncService" }
{ "type": "service:stop", "service": "tokenSyncService" }
{ "type": "service:restart", "service": "tokenSyncService" }

// Circuit breaker reset
{ "type": "circuit-breaker:reset", "service": "tokenSyncService" }

// Request information
{ "type": "get:service-catalog" }
{ "type": "get:service-state", "service": "tokenSyncService" }
{ "type": "get:all-states" }
{ "type": "get:dependency-graph" }

// Service configuration update
{ "type": "service:config-update", "service": "tokenSyncService", "config": {
    "refreshInterval": 5000,
    "maxRetries": 3,
    "batchSize": 50
}}
```

### Server → Client:

```javascript
// Welcome message on connection
{ "type": "welcome", "message": "...", "timestamp": "..." }

// Service catalog
{ "type": "service:catalog", "catalog": [...], "timestamp": "..." }

// Service state update
{ "type": "service:state", "service": "...", "status": "...", ... }

// All service states
{ "type": "all-states", "states": [...], "timestamp": "..." }

// Dependency graph
{ "type": "dependency:graph", "graph": [...], "timestamp": "..." }

// Success responses
{ "type": "subscription:success", "service": "...", "timestamp": "..." }
{ "type": "service:start:success", "service": "...", "timestamp": "..." }
{ "type": "service:config-update:success", "service": "...", "timestamp": "..." }

// Error responses
{ "type": "error", "code": "...", "message": "...", "timestamp": "..." }

// Heartbeat acknowledgment
{ "type": "heartbeat:ack", "timestamp": "..." }
```

## REST API Endpoints

### SkyDuel Management API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/skyduel/status` | GET | Get quick status of all services |
| `/api/admin/skyduel/websocket-auth` | POST | Get a temporary auth token for WebSocket connection |
| `/api/admin/skyduel/services` | GET | Get detailed information about all services |
| `/api/admin/skyduel/dependency-graph` | GET | Get service dependency graph |
| `/api/admin/skyduel/services/:serviceName/start` | POST | Start a specific service |
| `/api/admin/skyduel/services/:serviceName/stop` | POST | Stop a specific service |
| `/api/admin/skyduel/services/:serviceName/restart` | POST | Restart a specific service |
| `/api/admin/skyduel/services/:serviceName/reset-circuit-breaker` | POST | Reset circuit breaker for a specific service |

## Implementation Plan

1. Create the `skyduel-ws.js` file in `/websocket/`
2. Create the `skyduel-management.js` file in `/routes/admin/`
3. Update `websocket-initializer.js` to include the SkyDuel WebSocket
4. Update `index.js` to mount the new routes
5. Test connection with a simple client tool like Postman or WebSocket client
6. Implement the frontend integration with the SkyDuelClient

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