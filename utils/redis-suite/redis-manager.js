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
                logApi.info(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_GREEN}${fancyColors.BOLD} Connected successfully ${fancyColors.RESET}`);
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                logApi.error(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD} Error:${fancyColors.RESET} \n\t\t${fancyColors.BG_DARK_RED}${fancyColors.BOLD}${err.message} ${fancyColors.RESET}`);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logApi.warn(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_GRAY}${fancyColors.BOLD} Connection closed ${fancyColors.RESET}`);
            });

        } catch (error) {
            logApi.error(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD} Failed to initialize client:${fancyColors.RESET} \n\t\t${fancyColors.BG_DARK_RED}${fancyColors.BOLD}${error.message} ${fancyColors.RESET}`);
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
            logApi.error(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD} Error getting key ${key}:${fancyColors.RESET} \n\t\t${fancyColors.BG_DARK_RED}${fancyColors.BOLD}${error.message} ${fancyColors.RESET}`);
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
            logApi.error(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD} Error setting key ${key}:${fancyColors.RESET} \n\t\t${fancyColors.BG_DARK_RED}${fancyColors.BOLD}${error.message} ${fancyColors.RESET}`);
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
            logApi.error(`${fancyColors.ORANGE}[Redis]${fancyColors.RESET} ${fancyColors.BG_DARK_RED}${fancyColors.BOLD} Error getting TTL for key ${key}:${fancyColors.RESET} \n\t\t${fancyColors.BG_DARK_RED}${fancyColors.BOLD}${error.message} ${fancyColors.RESET}`);
            return -2;
        }
    }
}

// Create and export a singleton instance
const redisManager = new RedisManager();
export default redisManager; 