// services/admin-wallet/modules/wallet-balance-ws.js

/**
 * Admin Wallet Balance WebSocket Module
 * @module wallet-balance-ws
 * 
 * @description Implements WebSocket-based monitoring for admin wallet balances
 *              using Solana's AccountSubscribe notifications to receive real-time
 *              balance updates. This eliminates the need for frequent RPC polling
 *              and prevents rate limit issues.
 * 
 * @author BranchManager69 (with Claude's assistance)
 * @version 1.0.0
 * @created 2025-05-10
 */

import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import prisma from '../../../config/prisma.js';
import { LAMPORTS_PER_SOL, toAddress } from '../utils/solana-compat.js';
import { WebSocket } from 'ws';
import { config } from '../../../config/config.js';

// Active WebSocket connection
let wsConnection = null;
// Map of account addresses to their DB records and handlers
const monitoredAccounts = new Map();
// Connection state
let connectionState = 'disconnected';
// Subscription IDs by address
const subscriptionIds = new Map();
// Reconnection timer
let reconnectTimer = null;
// Reconnection attempt counter
let reconnectAttempts = 0;
// Max reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 10;
// Base reconnection delay in ms (will be multiplied by attempt count)
const BASE_RECONNECT_DELAY = 2000;
// Ping interval id
let pingIntervalId = null;

/**
 * Initialize the WebSocket connection to monitor wallet balances
 * @param {Object} solanaEngine - Reference to solanaEngine (can be used for fallback)
 * @param {Object} config - Configuration object
 * @returns {Promise<boolean>} - Success status
 */
export async function initializeWalletBalanceWebSocket(solanaEngine, serviceConfig) {
    if (wsConnection !== null) {
        // Already initialized
        return connectionState === 'connected';
    }

    try {
        // Get the WebSocket endpoint from config
        const wsEndpoint = config.rpc_urls.mainnet_wss;
        
        if (!wsEndpoint) {
            logApi.error(`${fancyColors.RED}[WalletBalanceWS] No WebSocket endpoint configured in config.rpc_urls.mainnet_wss${fancyColors.RESET}`);
            return false;
        }

        // Load active wallet accounts from database
        const managedWallets = await prisma.managed_wallets.findMany({
            where: {
                status: 'active'
            },
            select: {
                id: true,
                public_key: true,
                label: true,
                metadata: true
            }
        });

        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Initializing WebSocket connection to ${wsEndpoint} for ${managedWallets.length} wallets${fancyColors.RESET}`);

        // Store wallet info in monitored accounts map
        managedWallets.forEach(wallet => {
            if (wallet.public_key) {
                monitoredAccounts.set(wallet.public_key, {
                    id: wallet.id,
                    label: wallet.label,
                    metadata: wallet.metadata || {},
                    lastBalance: wallet.metadata?.balance?.sol || 0
                });
            }
        });

        // Connect to the WebSocket endpoint
        connectWebSocket(wsEndpoint);

        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to initialize WebSocket: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Connect to the WebSocket endpoint and set up event handlers
 * @param {string} wsEndpoint - WebSocket endpoint URL
 */
function connectWebSocket(wsEndpoint) {
    try {
        // Close existing connection if any
        if (wsConnection) {
            wsConnection.terminate();
        }

        // Clear existing ping interval
        if (pingIntervalId) {
            clearInterval(pingIntervalId);
            pingIntervalId = null;
        }

        // Create new WebSocket connection
        wsConnection = new WebSocket(wsEndpoint);
        connectionState = 'connecting';

        // Setup event handlers
        wsConnection.on('open', () => handleSocketOpen());
        wsConnection.on('message', (data) => handleSocketMessage(data));
        wsConnection.on('error', (error) => handleSocketError(error));
        wsConnection.on('close', () => handleSocketClose());

        // Setup ping interval to keep connection alive
        pingIntervalId = setInterval(() => {
            if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                wsConnection.ping();
                // Also send a custom ping message
                const pingMessage = {
                    jsonrpc: '2.0',
                    method: 'ping',
                    id: Date.now()
                };
                wsConnection.send(JSON.stringify(pingMessage));
            }
        }, 30000); // Every 30 seconds

        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Connecting to WebSocket endpoint: ${wsEndpoint}${fancyColors.RESET}`);
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to connect to WebSocket: ${error.message}${fancyColors.RESET}`, error);
        handleReconnect();
    }
}

/**
 * Handle WebSocket open event
 */
function handleSocketOpen() {
    connectionState = 'connected';
    reconnectAttempts = 0;
    logApi.info(`${fancyColors.GREEN}[WalletBalanceWS] Connected to WebSocket successfully${fancyColors.RESET}`);
    
    // Subscribe to all wallet accounts
    subscribeToAccounts();
}

/**
 * Subscribe to account notifications for all monitored wallet addresses
 */
async function subscribeToAccounts() {
    try {
        // Clear any existing subscriptions
        subscriptionIds.clear();

        // Subscribe to each account
        const walletAddresses = Array.from(monitoredAccounts.keys());
        
        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Subscribing to ${walletAddresses.length} wallet accounts${fancyColors.RESET}`);
        
        for (const address of walletAddresses) {
            subscribeToAccount(address);
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to subscribe to accounts: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Subscribe to a single account for balance updates
 * @param {string} address - Account address to subscribe to
 */
function subscribeToAccount(address) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        logApi.warn(`${fancyColors.YELLOW}[WalletBalanceWS] Cannot subscribe to account ${address}: WebSocket not connected${fancyColors.RESET}`);
        return;
    }

    try {
        const subscribeMessage = {
            jsonrpc: '2.0',
            id: `subscribe-${address}`,
            method: 'accountSubscribe',
            params: [
                address,
                {
                    encoding: 'jsonParsed',
                    commitment: 'confirmed'
                }
            ]
        };

        wsConnection.send(JSON.stringify(subscribeMessage));
        logApi.debug(`${fancyColors.CYAN}[WalletBalanceWS] Sent subscription request for account ${address}${fancyColors.RESET}`);
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to subscribe to account ${address}: ${error.message}${fancyColors.RESET}`);
    }
}

/**
 * Handle WebSocket message event
 * @param {Buffer} data - Raw message data from WebSocket
 */
function handleSocketMessage(data) {
    try {
        const message = JSON.parse(data.toString());
        
        // Handle subscription confirmation
        if (message.id && message.id.toString().startsWith('subscribe-') && message.result !== undefined) {
            const address = message.id.toString().replace('subscribe-', '');
            subscriptionIds.set(address, message.result);

            // Only log 1 out of every 10 subscriptions for consistency with other wallet services
            if (subscriptionIds.size % 10 === 0) {
                logApi.info(`${fancyColors.GREEN}[WalletBalanceWS] Successfully subscribed to account ${address} with subscription ID ${message.result} (subscription #${subscriptionIds.size})${fancyColors.RESET}`);
            } else {
                // Keep detailed logs at debug level
                logApi.debug(`${fancyColors.GREEN}[WalletBalanceWS] Successfully subscribed to account ${address} with subscription ID ${message.result}${fancyColors.RESET}`);
            }
            return;
        }
        
        // Handle account update notification
        if (message.method === 'accountNotification' && message.params && message.params.result) {
            handleAccountUpdate(message.params);
            return;
        }

        // Handle ping response
        if (message.method === 'pong' || (message.id && message.result === 'pong')) {
            logApi.debug(`${fancyColors.CYAN}[WalletBalanceWS] Received pong${fancyColors.RESET}`);
            return;
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to process WebSocket message: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Handle account update notification
 * @param {Object} params - Account update parameters
 */
async function handleAccountUpdate(params) {
    try {
        const { subscription, result } = params;
        if (!result || !result.value || !result.value.lamports) {
            logApi.debug(`${fancyColors.YELLOW}[WalletBalanceWS] Received update without lamports value: ${JSON.stringify(params)}${fancyColors.RESET}`);
            return;
        }

        // For debugging, log every account update
        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Received account update for subscription ${subscription} with ${result.value.lamports} lamports${fancyColors.RESET}`);

        // Find the address by subscription ID
        let accountAddress = null;
        for (const [address, subId] of subscriptionIds.entries()) {
            if (subId === subscription) {
                accountAddress = address;
                break;
            }
        }

        if (!accountAddress) {
            logApi.warn(`${fancyColors.YELLOW}[WalletBalanceWS] Received update for unknown subscription ID: ${subscription}${fancyColors.RESET}`);
            return;
        }

        const walletInfo = monitoredAccounts.get(accountAddress);
        if (!walletInfo) {
            logApi.warn(`${fancyColors.YELLOW}[WalletBalanceWS] Received update for unknown wallet: ${accountAddress}${fancyColors.RESET}`);
            return;
        }

        // Get the new balance in SOL
        const newLamports = result.value.lamports;
        const newBalance = newLamports / LAMPORTS_PER_SOL;
        const oldBalance = walletInfo.lastBalance;
        const difference = newBalance - oldBalance;

        // Update our cached balance
        walletInfo.lastBalance = newBalance;
        monitoredAccounts.set(accountAddress, walletInfo);

        // Always log the balance (for debugging)
        logApi.info(`${fancyColors.MAGENTA}[WalletBalanceWS] Wallet ${walletInfo.label || accountAddress}: Balance = ${newBalance} SOL (diff: ${difference > 0 ? '+' : ''}${difference.toFixed(9)} SOL)${fancyColors.RESET}`);

        // Only update DB if balance actually changed by a meaningful amount
        if (Math.abs(difference) > 0.000001) {
            logApi.info(`${fancyColors.GREEN}[WalletBalanceWS] Significant balance update for wallet ${walletInfo.label || accountAddress}: ${oldBalance} SOL -> ${newBalance} SOL (${difference > 0 ? '+' : ''}${difference.toFixed(9)} SOL)${fancyColors.RESET}`);

            // Update in the database
            await updateWalletBalanceInDb(walletInfo.id, accountAddress, newBalance);
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to process account update: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Update wallet balance in the database
 * @param {number} walletId - Database ID of the wallet
 * @param {string} address - Wallet address
 * @param {number} newBalance - New SOL balance
 */
async function updateWalletBalanceInDb(walletId, address, newBalance) {
    try {
        // Get the wallet record from DB
        const wallet = await prisma.managed_wallets.findUnique({
            where: { id: walletId }
        });

        if (!wallet) {
            logApi.warn(`${fancyColors.YELLOW}[WalletBalanceWS] Wallet not found in DB: ${walletId}${fancyColors.RESET}`);
            return;
        }

        // Update wallet metadata with balance info
        const currentMetadata = wallet.metadata || {};
        const updatedMetadata = {
            ...currentMetadata,
            balance: {
                sol: newBalance,
                last_updated: new Date().toISOString()
            }
        };

        // Update in database
        await prisma.managed_wallets.update({
            where: { id: walletId },
            data: {
                metadata: updatedMetadata,
                updated_at: new Date()
            }
        });

        logApi.debug(`${fancyColors.GREEN}[WalletBalanceWS] Updated balance in DB for wallet ${address} to ${newBalance} SOL${fancyColors.RESET}`);
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to update wallet balance in DB: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Handle WebSocket error event
 * @param {Error} error - WebSocket error
 */
function handleSocketError(error) {
    logApi.error(`${fancyColors.RED}[WalletBalanceWS] WebSocket error: ${error.message}${fancyColors.RESET}`, error);
    handleReconnect();
}

/**
 * Handle WebSocket close event
 */
function handleSocketClose() {
    connectionState = 'disconnected';
    logApi.warn(`${fancyColors.YELLOW}[WalletBalanceWS] WebSocket connection closed${fancyColors.RESET}`);
    handleReconnect();
}

/**
 * Handle WebSocket reconnection
 */
function handleReconnect() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
    }

    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Maximum reconnection attempts reached (${MAX_RECONNECT_ATTEMPTS}). Giving up.${fancyColors.RESET}`);
        connectionState = 'failed';
        return;
    }

    const delay = BASE_RECONNECT_DELAY * Math.min(reconnectAttempts, 10);
    logApi.info(`${fancyColors.YELLOW}[WalletBalanceWS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})${fancyColors.RESET}`);
    
    reconnectTimer = setTimeout(() => {
        connectWebSocket(config.rpc_urls.mainnet_wss);
    }, delay);
}

/**
 * Stop WebSocket monitoring and close connection
 */
export function stopWalletBalanceWebSocket() {
    try {
        // Clear reconnect timer if active
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        // Clear ping interval if active
        if (pingIntervalId) {
            clearInterval(pingIntervalId);
            pingIntervalId = null;
        }

        // Close WebSocket connection if open
        if (wsConnection) {
            wsConnection.terminate();
            wsConnection = null;
        }

        // Reset state
        connectionState = 'disconnected';
        subscriptionIds.clear();
        
        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] WebSocket monitoring stopped${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Error stopping WebSocket: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Add a new wallet to monitor
 * @param {Object} wallet - Wallet object from the database
 * @returns {Promise<boolean>} - Success status
 */
export async function addWalletToMonitor(wallet) {
    if (!wallet || !wallet.public_key) {
        return false;
    }

    try {
        // Add to monitored accounts
        monitoredAccounts.set(wallet.public_key, {
            id: wallet.id,
            label: wallet.label,
            metadata: wallet.metadata || {},
            lastBalance: wallet.metadata?.balance?.sol || 0
        });

        // Subscribe if WebSocket is connected
        if (connectionState === 'connected' && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            subscribeToAccount(wallet.public_key);
        }

        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Added wallet to monitor: ${wallet.label || wallet.public_key}${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to add wallet to monitor: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Remove a wallet from monitoring
 * @param {string} address - Wallet address to remove
 * @returns {boolean} - Success status
 */
export function removeWalletFromMonitor(address) {
    try {
        // Unsubscribe if connected
        if (connectionState === 'connected' && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            const subscriptionId = subscriptionIds.get(address);
            if (subscriptionId) {
                const unsubscribeMessage = {
                    jsonrpc: '2.0',
                    id: `unsubscribe-${address}`,
                    method: 'accountUnsubscribe',
                    params: [subscriptionId]
                };
                wsConnection.send(JSON.stringify(unsubscribeMessage));
                subscriptionIds.delete(address);
            }
        }

        // Remove from monitored accounts
        monitoredAccounts.delete(address);

        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Removed wallet from monitor: ${address}${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to remove wallet from monitor: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Get the status of WebSocket connection
 * @returns {Object} - Connection status information
 */
export function getWebSocketStatus() {
    const walletCount = monitoredAccounts.size;
    const subscriptionCount = subscriptionIds.size;
    
    return {
        connectionState,
        reconnectAttempts,
        walletCount,
        subscriptionCount,
        readyState: wsConnection ? wsConnection.readyState : null,
        readyStateText: wsConnection ? getReadyStateText(wsConnection.readyState) : 'No connection'
    };
}

/**
 * Get text representation of WebSocket ready state
 * @param {number} readyState - WebSocket ready state
 * @returns {string} - Human-readable state description
 */
function getReadyStateText(readyState) {
    switch (readyState) {
        case WebSocket.CONNECTING: return 'Connecting';
        case WebSocket.OPEN: return 'Open';
        case WebSocket.CLOSING: return 'Closing';
        case WebSocket.CLOSED: return 'Closed';
        default: return 'Unknown';
    }
}

/**
 * Refresh monitored wallet list from database
 * @returns {Promise<boolean>} - Success status
 */
export async function refreshMonitoredWallets() {
    try {
        // Load active wallet accounts from database
        const managedWallets = await prisma.managed_wallets.findMany({
            where: {
                status: 'active'
            },
            select: {
                id: true,
                public_key: true,
                label: true,
                metadata: true
            }
        });

        // Reset monitored accounts
        monitoredAccounts.clear();

        // Store wallet info in monitored accounts map
        managedWallets.forEach(wallet => {
            if (wallet.public_key) {
                monitoredAccounts.set(wallet.public_key, {
                    id: wallet.id,
                    label: wallet.label,
                    metadata: wallet.metadata || {},
                    lastBalance: wallet.metadata?.balance?.sol || 0
                });
            }
        });

        // Resubscribe if connected
        if (connectionState === 'connected' && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            subscribeToAccounts();
        }

        logApi.info(`${fancyColors.CYAN}[WalletBalanceWS] Refreshed monitored wallets: ${managedWallets.length} active wallets${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[WalletBalanceWS] Failed to refresh monitored wallets: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

export default {
    initializeWalletBalanceWebSocket,
    stopWalletBalanceWebSocket,
    addWalletToMonitor,
    removeWalletFromMonitor,
    getWebSocketStatus,
    refreshMonitoredWallets
};