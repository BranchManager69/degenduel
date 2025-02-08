import { WebSocketServer } from 'ws';
import { WalletManager } from '../service/WalletManager.js';
import Transfer from '../service/Transfer.js';

export function initializeWalletWebSocket(server) {
    const wss = new WebSocketServer({ server, path: '/ws/wallet' });
    const walletManager = WalletManager.getInstance();
    const transfer = Transfer.getInstance();

    wss.on('connection', (ws) => {
        const sendUpdate = (event) => {
            ws.send(JSON.stringify(event));
        };

        // Listen for wallet events
        walletManager.on('walletCreated', (publicKey) => {
            sendUpdate({
                type: 'WALLET_CREATED',
                data: { publicKey }
            });
        });

        walletManager.on('walletStatusChanged', (data) => {
            sendUpdate({
                type: 'WALLET_STATUS_CHANGED',
                data
            });
        });

        // Listen for transfer events
        transfer.on('transferComplete', (data) => {
            sendUpdate({
                type: 'TRANSFER_COMPLETE',
                data
            });
        });

        // Handle client disconnect
        ws.on('close', () => {
            walletManager.removeAllListeners();
            transfer.removeAllListeners();
        });
    });

    return wss;
} 