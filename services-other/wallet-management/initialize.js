import WalletManager from './service/WalletManager.js';
import WalletWebSocketServer from './websocket/index.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import SolanaServiceManager from '../../utils/solana-suite/solana-service-manager.js';

export async function initializeWalletManagement(server) {
    try {
        // Ensure database is connected
        await prisma.$connect();
        
        // Initialize Solana Service Manager first
        await SolanaServiceManager.initialize();
        
        // Initialize WebSocket server
        const wsServer = new WalletWebSocketServer(server);
        logApi.info('WebSocket server created');
        
        // Initialize WalletManager and connect it to WebSocket
        const walletManager = WalletManager.getInstance();
        walletManager.setWebSocketServer(wsServer);
        logApi.info('WalletManager connected to WebSocket server');

        // Test the connection
        const testWallet = await walletManager.generateWallet('test-initialization');
        logApi.info('Test wallet generated:', testWallet.public_key);
        await walletManager.checkBalance(testWallet.public_key);
        
        logApi.info('Wallet management service initialized successfully');
        
        return {
            walletManager,
            wsServer
        };
    } catch (error) {
        logApi.error('Failed to initialize wallet management:', error);
        throw error;
    }
} 