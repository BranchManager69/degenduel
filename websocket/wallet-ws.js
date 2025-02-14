import { WebSocketServer } from 'ws';
import { logApi } from '../utils/logger-suite/logger.js';
import { BaseWebSocketServer } from '../utils/websocket-suite/base-websocket.js';
import prisma from '../config/prisma.js';
import SolanaServiceManager from '../utils/solana-suite/solana-service-manager.js';

class WalletWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/ws/wallet',
            clientTracking: true,
            maxPayload: 1024 * 32, // 32KB max payload
        });

        this.walletSubscriptions = new Map(); // userId -> subscription
        this.solanaManager = SolanaServiceManager.getInstance();
    }

    async handleClientMessage(client, message) {
        try {
            const { type, data } = message;

            switch (type) {
                case 'SUBSCRIBE_WALLET':
                    await this.handleWalletSubscription(client, data);
                    break;
                case 'UNSUBSCRIBE_WALLET':
                    await this.handleWalletUnsubscription(client);
                    break;
                case 'REQUEST_BALANCE':
                    await this.handleBalanceRequest(client);
                    break;
                case 'REQUEST_TRANSACTIONS':
                    await this.handleTransactionsRequest(client, data);
                    break;
                default:
                    logApi.warn(`Unknown wallet message type: ${type}`);
            }
        } catch (error) {
            logApi.error('Error handling wallet message:', error);
            this.sendError(client, 'WALLET_ERROR', 'Failed to process wallet request');
        }
    }

    async handleWalletSubscription(client, { walletAddress }) {
        try {
            // Validate wallet ownership
            const user = await prisma.user.findUnique({
                where: { id: client.userId },
                select: { wallet_address: true }
            });

            if (!user || user.wallet_address !== walletAddress) {
                this.sendError(client, 'UNAUTHORIZED', 'Not authorized to subscribe to this wallet');
                return;
            }

            // Create subscription
            const subscription = await this.solanaManager.subscribeToWallet(
                walletAddress,
                async (update) => {
                    await this.handleWalletUpdate(client, update);
                }
            );

            // Store subscription
            this.walletSubscriptions.set(client.userId, {
                walletAddress,
                subscription
            });

            // Send initial state
            await this.sendWalletState(client, walletAddress);

        } catch (error) {
            logApi.error('Error in wallet subscription:', error);
            this.sendError(client, 'SUBSCRIPTION_ERROR', 'Failed to subscribe to wallet updates');
        }
    }

    async handleWalletUnsubscription(client) {
        const subscription = this.walletSubscriptions.get(client.userId);
        if (subscription) {
            await this.solanaManager.unsubscribeFromWallet(subscription.subscription);
            this.walletSubscriptions.delete(client.userId);
        }
    }

    async handleBalanceRequest(client) {
        const subscription = this.walletSubscriptions.get(client.userId);
        if (!subscription) {
            this.sendError(client, 'NOT_SUBSCRIBED', 'Must subscribe to wallet first');
            return;
        }

        await this.sendWalletState(client, subscription.walletAddress);
    }

    async handleTransactionsRequest(client, { limit = 10, before = null }) {
        const subscription = this.walletSubscriptions.get(client.userId);
        if (!subscription) {
            this.sendError(client, 'NOT_SUBSCRIBED', 'Must subscribe to wallet first');
            return;
        }

        try {
            const transactions = await this.solanaManager.getWalletTransactions(
                subscription.walletAddress,
                limit,
                before
            );

            this.sendToClient(client, {
                type: 'TRANSACTIONS_UPDATE',
                data: {
                    transactions,
                    hasMore: transactions.length === limit
                }
            });
        } catch (error) {
            logApi.error('Error fetching transactions:', error);
            this.sendError(client, 'TRANSACTION_ERROR', 'Failed to fetch transactions');
        }
    }

    async handleWalletUpdate(client, update) {
        this.sendToClient(client, {
            type: 'WALLET_UPDATE',
            data: update
        });
    }

    async sendWalletState(client, walletAddress) {
        try {
            const [balance, recentTransactions] = await Promise.all([
                this.solanaManager.getWalletBalance(walletAddress),
                this.solanaManager.getWalletTransactions(walletAddress, 5)
            ]);

            this.sendToClient(client, {
                type: 'WALLET_STATE',
                data: {
                    balance,
                    recentTransactions
                }
            });
        } catch (error) {
            logApi.error('Error fetching wallet state:', error);
            this.sendError(client, 'STATE_ERROR', 'Failed to fetch wallet state');
        }
    }

    cleanup() {
        // Cleanup all subscriptions
        for (const [userId, subscription] of this.walletSubscriptions) {
            this.solanaManager.unsubscribeFromWallet(subscription.subscription)
                .catch(error => logApi.error('Error cleaning up wallet subscription:', error));
        }
        this.walletSubscriptions.clear();
        super.cleanup();
    }
}

export function createWalletWebSocket(httpServer) {
    return new WalletWebSocketServer(httpServer);
}

export default WalletWebSocketServer; 