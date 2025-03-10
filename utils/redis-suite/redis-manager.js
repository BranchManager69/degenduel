// utils/redis-suite/redis-manager.js

import Redis from 'ioredis';
import { logApi } from '../logger-suite/logger.js';
import { fancyColors } from '../colors.js';

class RedisManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.initializeClient();
    }

    initializeClient() {
        try {
            this.client = new Redis({
                host: '127.0.0.1',
                port: 6379,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                }
            });

            this.client.on('connect', () => {
                this.isConnected = true;
                logApi.info(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;46mConnected successfully\x1b[0m`);
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                logApi.error(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;196mError: ${err.message}\x1b[0m`);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logApi.warn(`[\x1b[38;5;208mRedis\x1b[0m] \x1b[38;5;226mConnection closed\x1b[0m`);
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
}

// Create and export a singleton instance
const redisManager = new RedisManager();
export default redisManager; 