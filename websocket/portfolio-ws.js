// /websocket/portfolio-ws.js

import { BaseWebSocketServer } from '../utils/websocket-suite/base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import ReferralService from '../services/referralService.js';

class PortfolioWebSocketServer extends BaseWebSocketServer {
    constructor(server) {
        super(server, {
            path: '/api/v2/ws/portfolio',
            maxMessageSize: 100 * 1024, // 100KB
            rateLimit: 100, // 100 messages per minute
            requireAuth: true
        });

        this.startPeriodicUpdates();
    }

    async handleClientMessage(ws, message, clientInfo) {
        switch (message.type) {
            case 'PORTFOLIO_UPDATE_REQUEST':
                await this.handlePortfolioUpdateRequest(ws, clientInfo);
                break;
            default:
                this.sendError(ws, 'Unknown message type', 4004);
        }
    }

    async handlePortfolioUpdateRequest(ws, clientInfo) {
        try {
            const portfolioData = await this.getPortfolioData(clientInfo.wallet);
            if (portfolioData) {
                this.sendToClient(ws, {
                    type: 'PORTFOLIO_UPDATED',
                    data: portfolioData,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            logApi.error('Error handling portfolio update request:', error);
            this.sendError(ws, 'Failed to fetch portfolio data', 5001);
        }
    }

    async getPortfolioData(wallet) {
        return await prisma.contest_portfolios.findMany({
            where: { wallet_address: wallet },
            include: {
                tokens: {
                    select: {
                        symbol: true,
                        name: true,
                        decimals: true,
                        market_cap: true,
                        change_24h: true,
                        volume_24h: true
                    }
                }
            }
        });
    }

    startPeriodicUpdates() {
        // Update portfolio values every 15 seconds
        setInterval(async () => {
            try {
                const portfolios = await prisma.contest_portfolios.findMany({
                    include: {
                        tokens: {
                            select: {
                                symbol: true,
                                name: true,
                                decimals: true,
                                market_cap: true,
                                change_24h: true,
                                volume_24h: true
                            }
                        }
                    }
                });

                // Group portfolios by wallet
                const portfoliosByWallet = portfolios.reduce((acc, portfolio) => {
                    if (!acc[portfolio.wallet_address]) {
                        acc[portfolio.wallet_address] = [];
                    }
                    acc[portfolio.wallet_address].push(portfolio);
                    return acc;
                }, {});

                // Broadcast updates to respective clients
                for (const [wallet, data] of Object.entries(portfoliosByWallet)) {
                    this.broadcast(
                        {
                            type: 'PORTFOLIO_UPDATED',
                            data,
                            timestamp: new Date().toISOString(),
                            store: true // Queue if client is offline
                        },
                        (client) => client.wallet === wallet
                    );
                }
            } catch (error) {
                logApi.error('Error in periodic portfolio update:', error);
            }
        }, 15000);

        // Cleanup old messages every 2 days
        setInterval(async () => {
            try {
                await prisma.websocket_messages.deleteMany({
                    where: {
                        timestamp: {
                            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days old
                        }
                    }
                });
            } catch (error) {
                logApi.error('Failed to cleanup old messages:', error);
            }
        }, 2 * 24 * 60 * 60 * 1000);
    }

    // Public methods for external use
    broadcastTradeExecution(tradeData) {
        this.broadcast(
            {
                type: 'TRADE_EXECUTED',
                data: tradeData,
                timestamp: new Date().toISOString(),
                store: true
            },
            (client) => 
                client.wallet === tradeData.wallet_address || 
                client.role === 'superadmin'
        );
    }

    broadcastPriceUpdate(priceData) {
        this.broadcast({
            type: 'PRICE_UPDATED',
            data: priceData,
            timestamp: new Date().toISOString()
        });
    }

    // Service state broadcasting
    async broadcastServiceState(service, state) {
        try {
            const message = {
                type: 'service:state',
                service,
                data: state,
                timestamp: new Date().toISOString()
            };

            this.broadcast(message);
            
            // Store message for offline clients
            await prisma.websocket_messages.create({
                data: {
                    type: 'service:state',
                    data: message,
                    delivered: false,
                    wallet_address: 'SYSTEM',
                    timestamp: new Date()
                }
            });

            logApi.info(`Service state broadcast successful`, {
                service,
                state: state.status,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            logApi.error(`Failed to broadcast service state`, {
                service,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Service metrics broadcasting
    async broadcastServiceMetrics(service, metrics) {
        try {
            const message = {
                type: 'service:metrics',
                service,
                data: {
                    status: metrics.status || 'unknown',
                    uptime: metrics.uptime || 0,
                    latency: metrics.performance?.averageOperationTimeMs || 0,
                    activeUsers: metrics.operations?.total || 0
                },
                timestamp: new Date().toISOString()
            };

            this.broadcast(message);
            logApi.info(`Service metrics broadcast`, { service, metrics: message.data });
        } catch (error) {
            logApi.error(`Failed to broadcast service metrics`, {
                service,
                error: error.message
            });
        }
    }

    // Service alert broadcasting
    async broadcastServiceAlert(service, alert) {
        try {
            const message = {
                type: 'service:alert',
                service,
                data: {
                    severity: alert.severity || 'info',
                    message: alert.message,
                    timestamp: new Date().toISOString()
                }
            };

            this.broadcast(message);
            
            // Store critical alerts
            if (alert.severity === 'critical') {
                await prisma.websocket_messages.create({
                    data: {
                        type: 'service:alert',
                        data: message,
                        delivered: false,
                        wallet_address: 'SYSTEM',
                        timestamp: new Date()
                    }
                });
            }

            logApi.info(`Service alert broadcast`, {
                service,
                severity: alert.severity,
                message: alert.message
            });
        } catch (error) {
            logApi.error(`Failed to broadcast service alert`, {
                service,
                error: error.message
            });
        }
    }
}

// Export singleton instance creator
export const createPortfolioWebSocket = (server) => {
    return new PortfolioWebSocketServer(server);
};

export default PortfolioWebSocketServer;

// Message types
const MESSAGE_TYPES = {
  TRADE_EXECUTED: 'trade_executed',
  PORTFOLIO_UPDATED: 'portfolio_updated',
  PRICE_UPDATED: 'price_updated',
  ERROR: 'error',
  ADMIN_SUBSCRIBE: 'admin_subscribe',
  ADMIN_UNSUBSCRIBE: 'admin_unsubscribe'
};

// Connection types for admins
const ADMIN_SUBSCRIPTIONS = {
  ALL_PORTFOLIOS: 'all_portfolios',
  ALL_TRADES: 'all_trades',
  CONTEST: 'contest',     // Monitor specific contest
  USER: 'user'           // Monitor specific user
};

// Verify session token and get user
async function verifySession(token) {
  try {
    // 1) Verify JWT token
    const decoded = jwt.verify(token, config.jwt.secret);
    if (!decoded.wallet_address) {
      return null;
    }

    // 2) Get user from database
    const user = await prisma.users.findUnique({
      where: {
        wallet_address: decoded.wallet_address
      }
    });

    if (!user) {
      return null;
    }

    return user;
  } catch (error) {
    logApi.error('Session verification failed:', error);
    return null;
  }
}

// Handle new connections
async function handleConnection(ws, req) {
  try {
    // Get token from query parameters
    const url = new URL(req.url, `wss://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.send(JSON.stringify({
        type: MESSAGE_TYPES.ERROR,
        message: 'Authentication required'
      }));
      ws.close();
      return;
    }

    // Verify token and get user
    const user = await verifySession(token);
    if (!user) {
      ws.send(JSON.stringify({
        type: MESSAGE_TYPES.ERROR,
        message: 'Invalid session'
      }));
      ws.close();
      return;
    }

    // Store connection with user info
    connections.set(ws, {
      userId: user.id,
      wallet: user.wallet_address,
      nickname: user.nickname
    });

    logApi.info('New WebSocket connection', {
      userId: user.id,
      wallet: user.wallet_address,
      nickname: user.nickname
    });

    // Send message history first
    await sendMessageHistory(ws, user.wallet_address);

    // Then send current portfolio state
    await sendPortfolioState(ws, user.wallet_address);

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleMessage(ws, data);
      } catch (error) {
        logApi.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({
          type: MESSAGE_TYPES.ERROR,
          message: 'Invalid message format'
        }));
      }
    });

    // Handle client disconnection
    ws.on('close', () => {
      connections.delete(ws);
      logApi.info('WebSocket connection closed', {
        userId: user.id,
        wallet: user.wallet_address,
        nickname: user.nickname
      });
    });
  } catch (error) {
    logApi.error('WebSocket connection error:', error);
    ws.close();
  }
}

// Incoming message handler
async function handleMessage(ws, data) {
  const connection = connections.get(ws);
  if (!connection) return;

  switch (data.type) {
    case ADMIN_SUBSCRIPTIONS.ALL_PORTFOLIOS:
      if (connection.role === 'superadmin') {
        connections.set(ws, {
          ...connection,
          monitorAllPortfolios: true
        });
        logApi.info('Superadmin subscribed to all portfolios', {
          admin: connection.wallet
        });
        // Send initial state
        await sendAllPortfolioStates(ws);
      }
      break;

    case ADMIN_SUBSCRIPTIONS.ALL_TRADES:
      if (connection.role === 'superadmin') {
        connections.set(ws, {
          ...connection,
          monitorAllTrades: true
        });
        logApi.info('Superadmin subscribed to all trades', {
          admin: connection.wallet
        });
      }
      break;

    case ADMIN_SUBSCRIPTIONS.CONTEST:
      if (connection.role === 'superadmin' && data.contestId) {
        connections.set(ws, {
          ...connection,
          monitoredContests: [...(connection.monitoredContests || []), data.contestId]
        });
        logApi.info('Superadmin subscribed to contest', {
          admin: connection.wallet,
          contestId: data.contestId
        });
      }
      break;

    case ADMIN_SUBSCRIPTIONS.USER:
      if (connection.role === 'superadmin' && data.userWallet) {
        connections.set(ws, {
          ...connection,
          monitoredUsers: [...(connection.monitoredUsers || []), data.userWallet]
        });
        logApi.info('Superadmin subscribed to user', {
          admin: connection.wallet,
          userWallet: data.userWallet
        });
      }
      break;

    case 'unsubscribe':
      if (connection.role === 'superadmin') {
        const updatedConnection = { ...connection };
        delete updatedConnection.monitorAllPortfolios;
        delete updatedConnection.monitorAllTrades;
        delete updatedConnection.monitoredContests;
        delete updatedConnection.monitoredUsers;
        connections.set(ws, updatedConnection);
        logApi.info('Superadmin unsubscribed from all monitoring', {
          admin: connection.wallet
        });
      }
      break;

    case 'ping':
      try {
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString(),
          received: data.timestamp
        }));
      } catch (error) {
        logApi.error('Error sending pong:', error);
      }
      break;

    default:
      ws.send(JSON.stringify({
        type: MESSAGE_TYPES.ERROR,
        message: 'Unknown message type'
      }));
  }
}

// Send portfolio state to client
async function sendPortfolioState(ws, wallet) {
  try {
    const connection = connections.get(ws);
    const isAdmin = connection?.role === 'superadmin';

    // For regular users or targeted admin monitoring
    const portfolios = await prisma.contest_portfolios.findMany({
      where: {
        wallet_address: wallet
      },
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true,
            decimals: true,
            market_cap: true,
            change_24h: true,
            volume_24h: true
          }
        },
        contests: {
          select: {
            contest_code: true,
            status: true
          }
        },
        users: {
          select: {
            nickname: true
          }
        }
      }
    });

    const message = {
      type: MESSAGE_TYPES.PORTFOLIO_UPDATED,
      data: portfolios,
      wallet: wallet // Include wallet for admin monitoring
    };

    ws.send(JSON.stringify(message));
  } catch (error) {
    logApi.error('Error sending portfolio state:', error);
    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.ERROR,
      message: 'Failed to fetch portfolio state'
    }));
  }
}

// Send all portfolio states (admin only)
async function sendAllPortfolioStates(ws) {
  try {
    const connection = connections.get(ws);
    if (connection?.role !== 'superadmin') return;

    const portfolios = await prisma.contest_portfolios.findMany({
      include: {
        tokens: {
          select: {
            symbol: true,
            name: true,
            decimals: true,
            market_cap: true,
            change_24h: true,
            volume_24h: true
          }
        },
        contests: {
          select: {
            contest_code: true,
            status: true
          }
        },
        users: {
          select: {
            nickname: true
          }
        }
      },
      where: connection.monitoredContests ? {
        contest_id: {
          in: connection.monitoredContests
        }
      } : connection.monitoredUsers ? {
        wallet_address: {
          in: connection.monitoredUsers
        }
      } : {} // No filter for all portfolios
    });

    // Group portfolios by contest and user for better organization
    const organizedPortfolios = portfolios.reduce((acc, portfolio) => {
      const contestKey = portfolio.contests.contest_code;
      const userKey = portfolio.users.nickname || portfolio.wallet_address;
      
      if (!acc[contestKey]) acc[contestKey] = {};
      if (!acc[contestKey][userKey]) acc[contestKey][userKey] = [];
      
      acc[contestKey][userKey].push(portfolio);
      return acc;
    }, {});

    ws.send(JSON.stringify({
      type: MESSAGE_TYPES.PORTFOLIO_UPDATED,
      data: organizedPortfolios,
      timestamp: new Date()
    }));
  } catch (error) {
    logApi.error('Error sending all portfolio states:', error);
  }
}

// Store message in history
async function storeMessage(type, data, wallet_address) {
  try {
    await prisma.websocket_messages.create({
      data: {
        type,
        data,
        wallet_address
      }
    });
  } catch (error) {
    logApi.error('Failed to store WebSocket message:', error);
  }
}

// Send message history to client
async function sendMessageHistory(ws, wallet) {
  try {
    const messages = await prisma.websocket_messages.findMany({
      where: {
        wallet_address: wallet,
        delivered: false,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
        }
      },
      orderBy: {
        timestamp: 'asc'
      }
    });

    for (const message of messages) {
      ws.send(JSON.stringify({
        type: message.type,
        data: message.data,
        timestamp: message.timestamp
      }));

      // Mark message as delivered
      await prisma.websocket_messages.update({
        where: { id: message.id },
        data: { delivered: true }
      });
    }
  } catch (error) {
    logApi.error('Failed to send message history:', error);
  }
}

// Broadcast trade execution to relevant clients
export async function broadcastTradeExecution(trade) {
  // Store the message
  await storeMessage(MESSAGE_TYPES.TRADE_EXECUTED, trade, trade.wallet_address);

  // Broadcast to connected clients
  for (const [ws, connection] of connections) {
    // Send if:
    // 1. It's the user's own trade
    // 2. Admin is monitoring all trades
    // 3. Admin is monitoring this specific contest
    // 4. Admin is monitoring this specific user
    if (connection.wallet === trade.wallet_address ||
        connection.monitorAllTrades ||
        (connection.monitoredContests && connection.monitoredContests.includes(trade.contest_id)) ||
        (connection.monitoredUsers && connection.monitoredUsers.includes(trade.wallet_address))) {
      
      ws.send(JSON.stringify({
        type: MESSAGE_TYPES.TRADE_EXECUTED,
        data: trade,
        wallet: trade.wallet_address,
        contest: trade.contest_id
      }));
    }
  }
}

// Start the periodic updates
export function startPeriodicTasks() {
  // Update portfolio values periodically (every 15 seconds)
  setInterval(async () => {
    for (const [ws, connection] of connections) {
      if (connection.monitorAllPortfolios) {
        await sendAllPortfolioStates(ws);
      } else if (connection.monitoredContests || connection.monitoredUsers) {
        await sendAllPortfolioStates(ws); // Will filter based on connection settings
      } else {
        await sendPortfolioState(ws, connection.wallet);
      }
    }
  }, 15000);

  // Add cleanup job for old messages
  setInterval(async () => {
    try {
      await prisma.websocket_messages.deleteMany({
        where: {
          timestamp: {
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Delete messages older than 7 days
          }
        }
      });
    } catch (error) {
      logApi.error('Failed to cleanup old messages:', error);
    }
  }, 2 * 24 * 60 * 60 * 1000); // Run every 2 days

  // Check for expired referrals every hour
  setInterval(async () => {
    try {
      await ReferralService.checkExpiredReferrals();
    } catch (error) {
      logApi.error('Error checking expired referrals:', error);
    }
  }, 60 * 60 * 1000); // Run every hour
} 