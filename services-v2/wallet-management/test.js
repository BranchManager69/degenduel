import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { initializeWalletManagement } from './initialize.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import walletRoutes from './routes/wallet.js';
import transferRoutes from './routes/transfer.js';
import prisma from '../../config/prisma.js';
import { decryptPrivateKey } from '../../utils/solana-suite/solana-wallet.js';
import { PublicKey } from '@solana/web3.js';
import { config } from '../../config/config.js';
import { UserRole } from '../../types/userRole.js';
import crypto from 'crypto';

// Create a proper session token for Branch Manager
const sessionToken = jwt.sign(
    {
        wallet_address: process.env.DD_MASTER_WALLET,
        role: UserRole.superadmin,
        session_id: Buffer.from(crypto.randomBytes(16)).toString('hex')
    },
    config.jwt.secret,
    { expiresIn: '24h' }
);

async function verifyWalletOperations(wallet, walletManager) {
    // Verify wallet structure
    if (!wallet.public_key || !wallet.encrypted_private_key) {
        throw new Error('Wallet missing required fields');
    }

    // Verify public key is valid
    try {
        new PublicKey(wallet.public_key);
    } catch (error) {
        throw new Error('Invalid public key format');
    }

    // Test decryption
    try {
        const decrypted = decryptPrivateKey(wallet.encrypted_private_key);
        if (!decrypted) throw new Error('Decryption failed');
    } catch (error) {
        throw new Error(`Decryption verification failed: ${error.message}`);
    }

    // Test balance check
    const balance = await walletManager.checkBalance(wallet.public_key);
    if (typeof balance !== 'number') {
        throw new Error('Invalid balance format');
    }

    return true;
}

async function runTest() {
    let server;
    let ws;
    let testWallets = [];
    let cleanupComplete = false;
    let messages = [];
    
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
        
        const { walletManager, wsServer } = await initializeWalletManagement(server);
        logApi.info('Wallet management initialized');
        
        app.use('/api/v2/wallet', walletRoutes);
        app.use('/api/v2/transfer', transferRoutes);

        const PORT = process.env.TEST_PORT || 3005;
        await new Promise(resolve => server.listen(PORT, resolve));
        logApi.info(`Test server running on port ${PORT}`);

        // Create a promise for WebSocket connection
        const wsConnectionPromise = new Promise((resolve, reject) => {
            const connectTimeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 5000);

            ws = new WebSocket(`ws://localhost:${PORT}/api/v2/ws/wallet`, sessionToken);

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
                    } else if (message.type === 'WALLET_UPDATED') {
                        logApi.info('Received wallet update:', message.data);
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

        // Now proceed with wallet operations
        const wallet1 = await walletManager.generateWallet('test-wallet-1');
        await verifyWalletOperations(wallet1, walletManager);
        testWallets.push(wallet1);
        
        const wallet2 = await walletManager.generateWallet('test-wallet-2');
        await verifyWalletOperations(wallet2, walletManager);
        testWallets.push(wallet2);
        
        logApi.info('Wallet creation and verification successful');

        // Test balance monitoring
        const monitoringInterval = await walletManager.startBalanceMonitoring(wallet1.public_key);
        
        // Wait for potential WebSocket messages
        logApi.info('Waiting for WebSocket messages...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Log all received messages
        logApi.info('All received messages:', messages.map(m => ({ type: m.type, data: m.data })));
        
        // Verify we received expected events
        const hasWalletUpdate = messages.some(m => m.type === 'WALLET_UPDATED');
        const hasConnected = messages.some(m => m.type === 'CONNECTED');
        logApi.info('Connection status:', { hasConnected, hasWalletUpdate });
        
        if (!hasWalletUpdate) {
            throw new Error('Missing expected WebSocket events');
        }

        // Clear monitoring interval
        clearInterval(monitoringInterval);
        logApi.info('All tests passed successfully');

    } catch (error) {
        logApi.error('Test failed:', error);
        throw error;
    } finally {
        // Cleanup
        try {
            if (!cleanupComplete) {
                cleanupComplete = true;
                
                // Deactivate test wallets
                for (const wallet of testWallets) {
                    await prisma.managed_wallets.update({
                        where: { public_key: wallet.public_key },
                        data: { status: 'inactive' }
                    });
                }
                
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