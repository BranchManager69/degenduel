// utils/redis-suite/redis-manager.js

/**
 * Redis Manager
 * @module utils/redis-suite/redis-manager
 * 
 * This module provides a singleton instance of the Redis client.
 * It handles the connection to the Redis server and provides methods for getting and setting values in Redis.
 * 
 * @author BranchManager69
 * @version 1.9.0
 * @created 2025-01-14
 * @updated 2025-05-01
 */

// Redis
import Redis from 'ioredis';
// Logger
import { logApi } from '../logger-suite/logger.js';
import { fancyColors } from '../colors.js';

/**
 * Redis Manager
 * @class RedisManager
 * @description Manages the Redis client connection and provides methods for interacting with Redis
 */
class RedisManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.initializeClient();
    }

    initializeClient() {
        try {
            // Improved retry strategy with exponential backoff
            this.client = new Redis({
                host: '127.0.0.1',
                port: 6379,
                connectTimeout: 10000, // 10s connection timeout
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => {
                    // Exponential backoff with jitter
                    const delay = Math.min(Math.pow(2, times) * 100 + Math.random() * 100, 10000);
                    logApi.debug(`[\x1b[38;5;208mRedis\x1b[0m] Reconnection attempt ${times}, delay: ${delay}ms`);
                    return delay;
                },
                showFriendlyErrorStack: true
            });

            this.connectionAttempts = 0;
            this.startTime = Date.now();

            this.client.on('connect', () => {
                this.isConnected = true;
                this.connectionAttempts = 0;
                logApi.info(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;46mConnected successfully\x1b[0m`);
                
                // Immediately check Redis info for diagnostics
                this.getDiagnostics().catch(err => 
                    logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] Failed to get diagnostics: ${err.message}`)
                );
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                this.connectionAttempts++;
                
                // Enhanced error logging
                const errDetails = err.stack || err.message;
                const timeElapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
                
                logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mConnection error #${this.connectionAttempts} after ${timeElapsed}s: ${errDetails}\x1b[0m`);
                
                // After multiple failures, suggest solutions
                if (this.connectionAttempts >= 3) {
                    logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mPersistent connection issues - check if Redis is running: 'sudo systemctl status redis-server' or memory issues: 'free -h'\x1b[0m`);
                }
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;226mConnection closed\x1b[0m`);
            });
            
            // Add reconnect attempt diagnostic
            this.client.on('reconnecting', (delay) => {
                logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] Attempting reconnection in ${delay}ms`);
            });

        } catch (error) {
            logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mFailed to initialize client: ${error.message}\x1b[0m`);
            throw error;
        }
    }

    async get(key) {
        try {
            if (!this.isConnected) {
                throw new Error('Redis not connected');
            }
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mError getting key ${key}: ${error.message}\x1b[0m`);
            return null;
        }
    }

    async set(key, value, ttlSeconds = 30) {
        try {
            if (!this.isConnected) {
                throw new Error('Redis not connected');
            }
            await this.client.setex(key, ttlSeconds, JSON.stringify(value));
            return true;
        } catch (error) {
            logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mError setting key ${key}: ${error.message}\x1b[0m`);
            return false;
        }
    }

    async getTtl(key) {
        try {
            if (!this.isConnected) {
                throw new Error('Redis not connected');
            }
            return await this.client.ttl(key);
        } catch (error) {
            logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mError getting TTL for key ${key}: ${error.message}\x1b[0m`);
            return -2;
        }
    }
    
    /**
     * Get Redis server diagnostics information
     * @returns {Promise<Object>} - Redis server info
     */
    async getDiagnostics() {
        try {
            if (!this.isConnected) {
                throw new Error('Redis not connected');
            }
            
            const pipeline = this.client.pipeline();
            pipeline.info();
            pipeline.dbsize();
            pipeline.config('get', 'maxmemory');
            pipeline.config('get', 'maxmemory-policy');
            pipeline.memory('stats');
            pipeline.keys(`${this.KEY_PREFIX || 'jupiter'}_*`);
            
            const results = await pipeline.exec();
            
            // Extract info from results
            const info = results[0][1];
            const dbSize = results[1][1];
            const maxMemory = results[2][1];
            const maxMemoryPolicy = results[3][1];
            const memoryStats = results[4][1];
            const tokenKeys = results[5][1];
            
            // Parse Redis info
            const infoLines = info.split('\r\n');
            const infoSections = {};
            let currentSection = '';
            
            infoLines.forEach(line => {
                if (line.startsWith('#')) {
                    currentSection = line.substring(2).trim().toLowerCase();
                    infoSections[currentSection] = {};
                } else if (line.includes(':')) {
                    const [key, value] = line.split(':');
                    if (currentSection && key) {
                        infoSections[currentSection][key.trim()] = value.trim();
                    }
                }
            });
            
            // Extract key metrics
            const usedMemory = parseInt(infoSections.memory?.['used_memory'] || 0);
            const usedMemoryHuman = infoSections.memory?.['used_memory_human'] || '0B';
            const maxClients = parseInt(infoSections.clients?.['maxclients'] || 0);
            const connectedClients = parseInt(infoSections.clients?.['connected_clients'] || 0);
            const uptime = parseInt(infoSections.server?.['uptime_in_seconds'] || 0);
            
            // Format diagnostics results
            const diagnostics = {
                server: {
                    version: infoSections.server?.['redis_version'] || 'unknown',
                    uptime: `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                    mode: infoSections.server?.['redis_mode'] || 'unknown'
                },
                memory: {
                    used: usedMemoryHuman,
                    peak: infoSections.memory?.['used_memory_peak_human'] || '0B',
                    maxMemory: maxMemory && maxMemory[1] ? `${Math.round(parseInt(maxMemory[1]) / (1024 * 1024))}MB` : 'unlimited',
                    policy: maxMemoryPolicy && maxMemoryPolicy[1] ? maxMemoryPolicy[1] : 'unknown',
                    fragmentation: infoSections.memory?.['mem_fragmentation_ratio'] || 'unknown'
                },
                clients: {
                    connected: connectedClients,
                    max: maxClients
                },
                keys: {
                    total: dbSize,
                    tokenKeys: tokenKeys.length,
                    tokenKeyPattern: `${this.KEY_PREFIX || 'jupiter'}_*`,
                    tokenKeySizeEstimate: `${Math.round(tokenKeys.length * 1000 / 1024)}KB (estimated)`
                }
            };
            
            // Log the diagnostics
            logApi.info(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;46mDiagnostics:\x1b[0m`, JSON.stringify(diagnostics, null, 2));
            
            // Issue warnings for potential problems
            if (maxMemory && maxMemory[1] && parseInt(maxMemory[1]) > 0 && usedMemory > 0.9 * parseInt(maxMemory[1])) {
                logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;226mWARNING: Redis memory usage is approaching limit (${usedMemoryHuman}/${diagnostics.memory.maxMemory})\x1b[0m`);
            }
            
            if (tokenKeys.length > 10) {
                logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;226mWARNING: Large number of token tracking keys (${tokenKeys.length})\x1b[0m`);
            }
            
            return diagnostics;
        } catch (error) {
            logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mError getting diagnostics: ${error.message}\x1b[0m`);
            throw error;
        }
    }
}

// Create and export a singleton instance
const redisManager = new RedisManager();
export default redisManager; 