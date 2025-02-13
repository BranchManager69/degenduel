import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { config } from '../../config/config.js';
import { UserRole } from '../../types/userRole.js';
import crypto from 'crypto';
import PortfolioWebSocketServer from '../../websocket/portfolio-ws.js';

// Create a proper session token for testing
const sessionToken = jwt.sign(
    {
        wallet_address: process.env.DD_MASTER_WALLET,
        role: UserRole.superadmin,
        session_id: Buffer.from(crypto.randomBytes(16)).toString('hex')
    },
    config.jwt.secret,
    { expiresIn: '24h' }
);

async function runTest() {
    let server;
    let ws;
    let messages = [];
    let cleanupComplete = false;
    
    try {
        await prisma.$connect();
        logApi.info('Database connected');
        
        const app = express();
        app.use(express.json());
        
        // Use the actual session token in the request
        app.use((req, res, next) => {
            req.cookies = { session: sessionToken };
            next();
        });
        
        server = http.createServer(app);
        
        // Initialize portfolio WebSocket server
        const portfolioWS = new PortfolioWebSocketServer(server);
        logApi.info('Portfolio WebSocket server initialized');

        const PORT = process.env.TEST_PORT || 3006;
        await new Promise(resolve => server.listen(PORT, resolve));
        logApi.info(`Test server running on port ${PORT}`);

        // Create a promise for WebSocket connection
        const wsConnectionPromise = new Promise((resolve, reject) => {
            const connectTimeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 5000);

            ws = new WebSocket(`ws://localhost:${PORT}/api/v2/ws/portfolio`, sessionToken);

            ws.on('open', () => {
                logApi.info('WebSocket connection is ready');
                clearTimeout(connectTimeout);
                resolve();
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    logApi.info('Raw WebSocket message received:', data.toString());
                    logApi.info('Parsed WebSocket message:', message);
                    messages.push(message);
                    
                    // Log specific message types
                    if (message.type === 'CONNECTED') {
                        logApi.info('Received connection confirmation');
                    } else if (message.type === 'PORTFOLIO_UPDATED') {
                        logApi.info('Received portfolio update:', message.data);
                    }
                } catch (error) {
                    logApi.error('Error parsing WebSocket message:', error);
                }
            });

            ws.on('error', (error) => {
                clearTimeout(connectTimeout);
                reject(error);
            });
        });

        // Wait for WebSocket connection
        await wsConnectionPromise;
        logApi.info('WebSocket connection confirmed ready');

        // Test ping/pong
        ws.send(JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString()
        }));

        // Test portfolio updates
        const testPortfolio = {
            tokens: [
                { symbol: 'SOL', amount: 1.5 },
                { symbol: 'BONK', amount: 1000000 }
            ],
            total_value: 150,
            performance_24h: 5.2
        };

        portfolioWS.broadcastPortfolioUpdate(testPortfolio);
        
        // Wait for messages
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Log all received messages
        logApi.info('All received messages:', messages.map(m => ({ type: m.type, data: m.data })));
        
        // Verify we received expected events
        const hasPortfolioUpdate = messages.some(m => m.type === 'PORTFOLIO_UPDATED');
        const hasConnected = messages.some(m => m.type === 'CONNECTED');
        const hasPong = messages.some(m => m.type === 'pong');
        
        logApi.info('Connection status:', { hasConnected, hasPortfolioUpdate, hasPong });
        
        if (!hasConnected || !hasPortfolioUpdate || !hasPong) {
            throw new Error('Missing expected WebSocket events');
        }

        logApi.info('All tests passed successfully');

    } catch (error) {
        logApi.error('Test failed:', error);
        throw error;
    } finally {
        // Cleanup
        try {
            if (!cleanupComplete) {
                cleanupComplete = true;
                
                // Close connections in the correct order
                if (ws?.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                
                if (server?.listening) {
                    await new Promise(resolve => server.close(resolve));
                }
                
                await prisma.$disconnect();
                logApi.info('Cleanup completed');
            }
        } catch (cleanupError) {
            logApi.error('Cleanup failed:', cleanupError);
        }
    }
}

runTest()
    .then(() => {
        logApi.info('Test suite completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        logApi.error('Test suite failed:', error);
        process.exit(1);
    }); 