// utils/redis-suite/redis-session-store.js

import connectRedis from 'connect-redis';
import redisManager from './redis-manager.js';
import { logApi } from '../logger-suite/logger.js';

// Create a Redis store for express-session
const RedisStore = connectRedis;

/**
 * Creates a Redis session store for express-session.
 * This store uses the existing Redis connection from redisManager.
 * 
 * @returns {RedisStore} A Redis session store instance
 */
function createRedisSessionStore() {
  try {
    // Create the Redis store using the existing Redis client
    const store = new RedisStore({
      client: redisManager.client,
      prefix: 'session:',  // Prefix for session keys in Redis
      ttl: 86400,          // 24 hours default TTL for sessions
      disableTouch: false  // Update TTL on session access
    });

    // Add success log
    logApi.info(`[\x1b[38;5;208mRedisSession\x1b[0m] \x1b[38;5;46mRedis session store initialized\x1b[0m`);
    
    return store;
  } catch (error) {
    // Log error but don't throw to allow fallback to default store
    logApi.error(`[\x1b[38;5;208mRedisSession\x1b[0m] \x1b[38;5;196mFailed to initialize Redis session store: ${error.message}\x1b[0m`);
    logApi.error(`[\x1b[38;5;208mRedisSession\x1b[0m] \x1b[38;5;196mStack trace: ${error.stack}\x1b[0m`);
    return null;
  }
}

export { createRedisSessionStore };