/**
 * @file BullMQ integration for realtime events
 * @description Connect background jobs with realtime updates
 */

import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import realtime from '../index.js';
import { TOKEN_CHANNELS, SERVICE_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

// Redis connection for BullMQ
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  connectionName: 'bullmq-connection'
});

/**
 * Create a token refresh queue with realtime events
 * @returns {Object} Queue instance
 */
export function createTokenRefreshQueue() {
  // Create the queue
  const tokenRefreshQueue = new Queue('token-refresh', { connection });
  
  // Listen for completed jobs
  const queueEvents = new QueueEvents('token-refresh', { connection });
  
  queueEvents.on('completed', async ({ jobId, returnvalue }) => {
    try {
      const { tokenId, tokenAddress, newPrice, oldPrice } = JSON.parse(returnvalue);
      
      // Only publish if price actually changed
      if (String(newPrice) !== String(oldPrice)) {
        await realtime.publish(TOKEN_CHANNELS.PRICE, {
          id: tokenId,
          address: tokenAddress,
          price: newPrice,
          previousPrice: oldPrice,
          changePercent: ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100).toFixed(2),
          source: 'background-job',
          timestamp: Date.now()
        });
      }
      
    } catch (err) {
      logApi.error(`Error processing completed token refresh job ${jobId}:`, err);
    }
  });
  
  // Set up error handling
  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logApi.error(`Token refresh job ${jobId} failed: ${failedReason}`);
  });
  
  return tokenRefreshQueue;
}

/**
 * Create a worker for token refresh jobs
 * @param {Object} refreshFunction - Function to refresh token data
 * @returns {Worker} Worker instance
 */
export function createTokenRefreshWorker(refreshFunction) {
  // Create the worker
  const worker = new Worker('token-refresh', async (job) => {
    const { tokenId, tokenAddress } = job.data;
    
    try {
      // Notify that refresh is starting
      await realtime.publish(SERVICE_CHANNELS.TOKEN_ENRICHMENT, {
        action: 'refresh_started',
        tokenId,
        tokenAddress,
        jobId: job.id,
        timestamp: Date.now()
      });
      
      // Perform the refresh
      const result = await refreshFunction(tokenId, tokenAddress);
      
      // Return result for the completed event handler
      return JSON.stringify({
        tokenId,
        tokenAddress,
        newPrice: result.newPrice,
        oldPrice: result.oldPrice
      });
    } catch (err) {
      // Publish error event
      await realtime.publish(SERVICE_CHANNELS.TOKEN_ENRICHMENT, {
        action: 'refresh_error',
        tokenId,
        tokenAddress,
        error: err.message,
        jobId: job.id,
        timestamp: Date.now()
      });
      
      // Re-throw to mark job as failed
      throw err;
    }
  }, { connection });
  
  // Log worker events
  worker.on('completed', (job) => {
    logApi.debug(`Token refresh job ${job.id} completed for token ${job.data.tokenAddress}`);
  });
  
  worker.on('failed', (job, err) => {
    logApi.error(`Token refresh job ${job.id} failed:`, err);
  });
  
  return worker;
}

/**
 * Shutdown queues and workers cleanly
 * @param {Array} instances - Array of queue and worker instances
 */
export async function shutdownBullMQInstances(instances) {
  try {
    for (const instance of instances) {
      if (instance.close) {
        await instance.close();
      }
    }
    
    // Close connection
    await connection.quit();
    
    logApi.info('BullMQ instances shutdown completed');
  } catch (err) {
    logApi.error('Error shutting down BullMQ instances:', err);
  }
}