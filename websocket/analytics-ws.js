import WebSocket from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

const WHALE_THRESHOLD = 100; // 100 SOL threshold for whale status
const ACTIVE_SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Verify token helper
const verifyUserToken = (token) => {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded.wallet_address ? decoded : null;
  } catch (error) {
    logApi.error('Token verification failed:', error);
    return null;
  }
};

class AnalyticsWebSocketServer {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/analytics'
    });

    this.adminConnections = new Set();
    this.userSessions = new Map();
    this.zoneActivity = new Map();

    this.setupWebSocketServer();
    this.startCleanupInterval();
    this.setupPageViewTracking();
  }

  setupWebSocketServer() {
    this.wss.on('connection', async (ws, req) => {
      try {
        // Verify admin token
        const token = new URL(req.url, 'http://localhost').searchParams.get('token');
        if (!token) {
          ws.close(4001, 'No token provided');
          return;
        }

        const decoded = verifyUserToken(token);
        if (decoded.role !== 'superadmin') {
          ws.close(4003, 'Insufficient permissions');
          return;
        }

        // Add to admin connections
        this.adminConnections.add(ws);
        logApi.info('[Analytics WS] Admin connected', { admin: decoded.wallet_address });

        // Send initial state
        this.broadcastActivityUpdate(ws);

        ws.on('close', () => {
          this.adminConnections.delete(ws);
          logApi.info('[Analytics WS] Admin disconnected', { admin: decoded.wallet_address });
        });

        ws.on('error', (error) => {
          logApi.error('[Analytics WS] WebSocket error:', error);
        });

      } catch (error) {
        logApi.error('[Analytics WS] Connection error:', error);
        ws.close(4000, 'Connection error');
      }
    });
  }

  startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [wallet, session] of this.userSessions) {
        if (now - session.last_active > ACTIVE_SESSION_TIMEOUT) {
          this.userSessions.delete(wallet);
          this.broadcastActivityUpdate();
        }
      }
    }, CLEANUP_INTERVAL);
  }

  setupPageViewTracking() {
    // Middleware to track page views and user activity
    return async (req, res, next) => {
      try {
        if (!req.user) return next();

        const wallet = req.user.wallet_address;
        const path = req.path;
        const zone = this.getZoneFromPath(path);

        if (!zone) return next();

        // Get user's SOL balance
        const balance = await this.getUserBalance(wallet);
        const isWhale = balance >= WHALE_THRESHOLD;

        // Get or create session
        const existingSession = this.userSessions.get(wallet);
        const previousZone = existingSession?.current_zone;

        // Update session
        this.userSessions.set(wallet, {
          wallet,
          nickname: req.user.nickname || 'Anonymous',
          avatar_url: req.user.avatar_url,
          current_zone: zone,
          previous_zone: previousZone,
          wallet_balance: balance,
          last_action: this.getActionFromPath(path),
          last_active: Date.now(),
          session_duration: existingSession ? 
            Date.now() - existingSession.session_start : 
            0,
          session_start: existingSession?.session_start || Date.now(),
          is_whale: isWhale
        });

        // Track zone activity
        const zoneActivity = this.zoneActivity.get(zone) || { users: new Set() };
        zoneActivity.users.add(wallet);
        this.zoneActivity.set(zone, zoneActivity);

        // Broadcast update
        this.broadcastActivityUpdate();

      } catch (error) {
        logApi.error('[Analytics WS] Error tracking activity:', error);
      }

      next();
    };
  }

  async getUserBalance(wallet) {
    try {
      const balance = await prisma.user_balance.findUnique({
        where: { wallet_address: wallet },
        select: { balance: true }
      });
      return Number(balance?.balance || 0);
    } catch (error) {
      logApi.error('[Analytics WS] Error fetching balance:', error);
      return 0;
    }
  }

  getZoneFromPath(path) {
    if (path.includes('/trade')) return 'TRADING';
    if (path.includes('/contests')) return 'CONTESTS';
    if (path.includes('/portfolio')) return 'PORTFOLIO';
    if (path.includes('/tokens')) return 'TOKENS';
    if (path.includes('/profile')) return 'PROFILE';
    if (path.includes('/leaderboard')) return 'LEADERBOARD';
    return null;
  }

  getActionFromPath(path) {
    if (path.includes('/trade')) return 'Trading';
    if (path.includes('/contests/join')) return 'Joining Contest';
    if (path.includes('/contests')) return 'Browsing Contests';
    if (path.includes('/portfolio')) return 'Checking Portfolio';
    if (path.includes('/tokens')) return 'Exploring Tokens';
    if (path.includes('/profile')) return 'Viewing Profile';
    if (path.includes('/leaderboard')) return 'Checking Leaderboard';
    return 'Browsing';
  }

  broadcastActivityUpdate(targetWs = null) {
    const activityData = {
      type: 'user_activity_update',
      users: Array.from(this.userSessions.values()),
      timestamp: new Date().toISOString()
    };

    const message = JSON.stringify(activityData);

    if (targetWs) {
      // Send to specific admin
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(message);
      }
    } else {
      // Broadcast to all admins
      this.adminConnections.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }
}

export const createAnalyticsWebSocket = (server) => {
  return new AnalyticsWebSocketServer(server);
};

export default AnalyticsWebSocketServer; 