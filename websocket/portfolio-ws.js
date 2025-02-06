// /websocket/portfolio-ws.js

import WebSocket from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';

// Store active connections
const connections = new Map();

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

// Create WebSocket server function (to be called with HTTP server)
export function createWebSocketServer(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/portfolio'
  });

  // Handle new WebSocket connections
  wss.on('connection', handleConnection);

  return wss;
}

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
            name: true
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
            name: true
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
}

export { broadcastTradeExecution }; 