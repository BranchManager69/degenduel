import Redis from 'ioredis';
import { logApi } from '../logger-suite/logger.js';

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
                logApi.info('[Redis] Connected successfully');
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                logApi.error('[Redis] Error:', err);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logApi.warn('[Redis] Connection closed');
            });

        } catch (error) {
            logApi.error('[Redis] Failed to initialize client:', error);
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
            logApi.error(`[Redis] Error getting key ${key}:`, error);
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
            logApi.error(`[Redis] Error setting key ${key}:`, error);
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
            logApi.error(`[Redis] Error getting TTL for key ${key}:`, error);
            return -2;
        }
    }
}

// Create and export a singleton instance
const redisManager = new RedisManager();
export default redisManager; 