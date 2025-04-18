// websocket/analytics-ws.js

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const WHALE_THRESHOLD = 100; // 100 SOL threshold for whale status
const ACTIVE_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Verify token helper (???)
const verifyUserToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded.wallet_address ? decoded : null;
  } catch (error) {
    logApi.error('User token verification failed:', error);
    return null;
  }
};

// Analytics WebSocket Server
class AnalyticsWebSocketServer extends BaseWebSocketServer {
  constructor(httpServer) {
    super(httpServer, {
      path: '/ws/analytics',
      clientTracking: true,
      maxPayload: 1024 * 16, // 16KB max payload
    });

    this.eventBuffer = new Map(); // userId -> events[]
    this.flushInterval = setInterval(() => this.flushEvents(), 5000); // Flush every 5 seconds
  }

  // Add initialize method to support the WebSocket initialization process
  async initialize() {
    // Any specific initialization logic for analytics WebSocket
    logApi.info('Analytics WebSocket server initialized');
    return true;
  }

  async handleClientMessage(client, message) {
    try {
      const { type, data } = message;

      switch (type) {
        case 'PAGE_VIEW':
          await this.handlePageView(client.userId, data);
          break;
        case 'USER_ACTION':
          await this.handleUserAction(client.userId, data);
          break;
        case 'PERFORMANCE_METRIC':
          await this.handlePerformanceMetric(client.userId, data);
          break;
        default:
          logApi.warn(`Unknown analytics message type: ${type}`);
      }
    } catch (error) {
      logApi.error('Error handling analytics message:', error);
      this.sendError(client, 'ANALYTICS_ERROR', 'Failed to process analytics data');
    }
  }

  async handlePageView(userId, { page, referrer, timestamp }) {
    this.bufferEvent(userId, {
      type: 'PAGE_VIEW',
      userId,
      page,
      referrer,
      timestamp: timestamp || new Date().toISOString()
    });
  }

  async handleUserAction(userId, { action, context, timestamp }) {
    this.bufferEvent(userId, {
      type: 'USER_ACTION',
      userId,
      action,
      context,
      timestamp: timestamp || new Date().toISOString()
    });
  }

  async handlePerformanceMetric(userId, { metric, value, timestamp }) {
    this.bufferEvent(userId, {
      type: 'PERFORMANCE',
      userId,
      metric,
      value,
      timestamp: timestamp || new Date().toISOString()
    });
  }

  bufferEvent(userId, event) {
    if (!this.eventBuffer.has(userId)) {
      this.eventBuffer.set(userId, []);
    }
    this.eventBuffer.get(userId).push(event);
  }

  async flushEvents() {
    try {
      const bufferCopy = new Map(this.eventBuffer);
      this.eventBuffer.clear();

      for (const [userId, events] of bufferCopy) {
        await prisma.analytics.createMany({
          data: events.map(event => ({
            userId: event.userId,
            eventType: event.type,
            eventData: event,
            timestamp: new Date(event.timestamp)
          }))
        });
      }
    } catch (error) {
      logApi.error('Error flushing analytics events:', error);
      // Restore events that failed to flush
      for (const [userId, events] of bufferCopy) {
        if (!this.eventBuffer.has(userId)) {
          this.eventBuffer.set(userId, []);
        }
        this.eventBuffer.get(userId).push(...events);
      }
    }
  }

  createTrackingMiddleware() {
    return (req, res, next) => {
      // Add analytics tracking headers
      res.setHeader('X-Analytics-Enabled', 'true');
      res.setHeader('X-Analytics-Endpoint', this.options.path);
      next();
    };
  }

  cleanup() {
    clearInterval(this.flushInterval);
    this.flushEvents(); // Final flush
    super.cleanup();
  }

  /**
   * Get server metrics
   * @returns {Object} Server metrics
   */
  getMetrics() {
    return {
      metrics: {
        totalConnections: this._getConnectedClients().length,
        activeSubscriptions: this.eventBuffer.size,
        messageCount: 0,
        errorCount: 0,
        lastUpdate: new Date().toISOString(),
        cacheHitRate: 0,
        averageLatency: 0
      },
      performance: {
        messageRate: 0,
        errorRate: 0,
        latencyTrend: []
      },
      status: 'operational'
    };
  }
}

// Singleton instance
let instance = null;

/**
 * Create or return existing AnalyticsWebSocketServer instance
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {AnalyticsWebSocketServer} WebSocket server instance
 */
export function createAnalyticsWebSocket(httpServer) {
    if (!instance) {
        instance = new AnalyticsWebSocketServer(httpServer);
    }
    return instance;
}

// Export both the class and the instance
export { AnalyticsWebSocketServer };
export default instance;