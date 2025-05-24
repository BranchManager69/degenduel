// services/user-balance-tracking/wallet-balance-ws.js

/**
 * User Wallet Balance WebSocket Module
 * @module wallet-balance-ws
 * 
 * @description Implements WebSocket-based monitoring for user wallet balances
 *              using Solana's AccountSubscribe notifications to receive real-time
 *              balance updates. This eliminates the need for frequent RPC polling
 *              and prevents rate limit issues.
 * 
 * @author BranchManager69 (with Claude's assistance)
 * @version 1.0.0
 * @created 2025-05-10
 */

// Prisma
import prisma from '../../config/prisma.js';
// WebSocket
import { WebSocket } from 'ws';
// Logger
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
// Config
import { config } from '../../config/config.js';

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000;

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
// Statistics for monitoring
const stats = {
    subscribeAttempts: 0,
    subscribeSuccesses: 0,
    subscribeFailures: 0,
    balanceUpdates: 0,
    significantUpdates: 0,
    lastUpdate: null,
    connections: 0,
    disconnections: 0,
    errors: 0,
    lastError: null,
    lastErrorTime: null,
    initTime: null
};

/**
 * Initialize the WebSocket connection to monitor wallet balances
 * @param {Object} solanaEngine - Reference to solanaEngine (can be used for fallback)
 * @param {Object} serviceConfig - Configuration object
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
            logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] No WebSocket endpoint configured in config.rpc_urls.mainnet_wss${fancyColors.RESET}`);
            return false;
        }

        // Set initialization time
        stats.initTime = new Date();

        // Load active wallet accounts from database
        const activeUsers = await prisma.users.findMany({
            where: {
                is_banned: false
            },
            select: {
                id: true,
                wallet_address: true,
                nickname: true,
                last_known_balance: true
            }
        });

        // Filter out null wallet addresses
        const activeWallets = activeUsers.filter(user => user.wallet_address);

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Initializing WebSocket connection to ${wsEndpoint} for ${activeWallets.length} user wallets${fancyColors.RESET}`);

        // Store wallet info in monitored accounts map
        activeWallets.forEach(user => {
            if (user.wallet_address) {
                monitoredAccounts.set(user.wallet_address, {
                    id: user.id,
                    nickname: user.nickname || 'Unknown',
                    lastBalance: user.last_known_balance ? Number(user.last_known_balance) / LAMPORTS_PER_SOL : 0
                });
            }
        });

        // Connect to the WebSocket endpoint
        connectWebSocket(wsEndpoint);

        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to initialize WebSocket: ${error.message}${fancyColors.RESET}`, error);
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

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Connecting to WebSocket endpoint: ${wsEndpoint}${fancyColors.RESET}`);
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to connect to WebSocket: ${error.message}${fancyColors.RESET}`, error);
        handleReconnect();
    }
}

/**
 * Handle WebSocket open event
 */
function handleSocketOpen() {
    connectionState = 'connected';
    reconnectAttempts = 0;
    stats.connections++;
    logApi.info(`${fancyColors.GREEN}[UserWalletBalanceWS] Connected to WebSocket successfully${fancyColors.RESET}`);
    
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
        
        // Prioritize wallets with recent activity
        // For user wallets, we don't have a simple "active" flag like contests,
        // so we'll implement batch processing with small delays

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Subscribing to ${walletAddresses.length} user wallets in batches${fancyColors.RESET}`);
        
        // Process in batches to avoid overwhelming the connection
        const batchSize = 50;
        for (let i = 0; i < walletAddresses.length; i += batchSize) {
            const batch = walletAddresses.slice(i, i + batchSize);
            
            logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(walletAddresses.length/batchSize)} (${batch.length} wallets)${fancyColors.RESET}`);
            
            for (const address of batch) {
                subscribeToAccount(address);
                // Small delay between subscriptions within a batch
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            
            // Larger delay between batches
            if (i + batchSize < walletAddresses.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to subscribe to accounts: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Subscribe to a single account for balance updates
 * @param {string} address - Account address to subscribe to
 */
function subscribeToAccount(address) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] Cannot subscribe to account ${address}: WebSocket not connected${fancyColors.RESET}`);
        return;
    }

    try {
        stats.subscribeAttempts++;
        
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
        logApi.debug(`${fancyColors.CYAN}[UserWalletBalanceWS] Sent subscription request for account ${address}${fancyColors.RESET}`);
    } catch (error) {
        stats.subscribeFailures++;
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to subscribe to account ${address}: ${error.message}${fancyColors.RESET}`);
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
            stats.subscribeSuccesses++;

            // Only log 1 out of every 10 subscriptions to reduce log spam
            if (stats.subscribeSuccesses % 10 === 0) {
                logApi.info(`${fancyColors.GREEN}[UserWalletBalanceWS] Successfully subscribed to account ${address} with subscription ID ${message.result} (subscription #${stats.subscribeSuccesses})${fancyColors.RESET}`);
            } else {
                // Keep detailed logs at debug level
                logApi.debug(`${fancyColors.GREEN}[UserWalletBalanceWS] Successfully subscribed to account ${address} with subscription ID ${message.result}${fancyColors.RESET}`);
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
            logApi.debug(`${fancyColors.CYAN}[UserWalletBalanceWS] Received pong${fancyColors.RESET}`);
            return;
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to process WebSocket message: ${error.message}${fancyColors.RESET}`, error);
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
            logApi.debug(`${fancyColors.YELLOW}[UserWalletBalanceWS] Received update without lamports value: ${JSON.stringify(params)}${fancyColors.RESET}`);
            return;
        }

        stats.balanceUpdates++;
        stats.lastUpdate = new Date().toISOString();

        // Find the address by subscription ID
        let accountAddress = null;
        for (const [address, subId] of subscriptionIds.entries()) {
            if (subId === subscription) {
                accountAddress = address;
                break;
            }
        }

        if (!accountAddress) {
            logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] Received update for unknown subscription ID: ${subscription}${fancyColors.RESET}`);
            return;
        }

        const walletInfo = monitoredAccounts.get(accountAddress);
        if (!walletInfo) {
            logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] Received update for unknown wallet: ${accountAddress}${fancyColors.RESET}`);
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

        // Log all balance updates at debug level
        logApi.debug(`${fancyColors.CYAN}[UserWalletBalanceWS] User ${walletInfo.nickname}: Wallet ${accountAddress}: Balance = ${newBalance} SOL (diff: ${difference > 0 ? '+' : ''}${difference.toFixed(9)} SOL)${fancyColors.RESET}`);

        // Only update DB if balance actually changed by a meaningful amount
        if (Math.abs(difference) > 0.0001) {
            stats.significantUpdates++;
            
            // Format for better logging
            const shortWallet = `${accountAddress.slice(0, 8)}...${accountAddress.slice(-4)}`;
            const changeSymbol = difference > 0 ? '⬆️' : (difference < 0 ? '⬇️' : '⟹');
            const changeText = difference !== 0 ? 
                `${fancyColors.BOLD}${difference > 0 ? fancyColors.GREEN : fancyColors.RED}${changeSymbol} ${Math.abs(difference).toFixed(6)} SOL${fancyColors.RESET}` : 
                `${fancyColors.BOLD}${fancyColors.BLUE}${changeSymbol} No Change${fancyColors.RESET}`;
            
            logApi.info(`${fancyColors.MAGENTA}[UserWalletBalanceWS] Significant balance update for ${fancyColors.BOLD}${fancyColors.YELLOW}${walletInfo.nickname}${fancyColors.RESET} (${fancyColors.CYAN}${shortWallet}${fancyColors.RESET}): ${changeText} → Now: ${fancyColors.BOLD}${fancyColors.YELLOW}${newBalance} SOL${fancyColors.RESET}`);

            // Update in the database
            await updateWalletBalanceInDb(walletInfo.id, accountAddress, newLamports);
        }
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to process account update: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Update wallet balance in the database
 * @param {number} userId - Database ID of the user
 * @param {string} address - Wallet address
 * @param {bigint} lamports - New balance in lamports
 */
async function updateWalletBalanceInDb(userId, address, lamports) {
    try {
        // Update user's last known balance
        await prisma.users.update({
            where: { id: userId },
            data: {
                last_known_balance: BigInt(lamports),
                last_balance_check: new Date()
            }
        });

        // Create balance history record
        await prisma.wallet_balance_history.create({
            data: {
                wallet_address: address,
                balance_lamports: BigInt(lamports),
                timestamp: new Date(),
                user_id: userId
            }
        });

        logApi.debug(`${fancyColors.GREEN}[UserWalletBalanceWS] Updated balance in DB for wallet ${address} to ${lamports / LAMPORTS_PER_SOL} SOL${fancyColors.RESET}`);
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to update wallet balance in DB: ${error.message}${fancyColors.RESET}`, error);
    }
}

/**
 * Handle WebSocket error event
 * @param {Error} error - WebSocket error
 */
function handleSocketError(error) {
    stats.errors++;
    stats.lastError = error.message;
    stats.lastErrorTime = new Date().toISOString();
    
    logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] WebSocket error: ${error.message}${fancyColors.RESET}`, error);
    handleReconnect();
}

/**
 * Handle WebSocket close event
 */
function handleSocketClose() {
    connectionState = 'disconnected';
    stats.disconnections++;
    
    logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] WebSocket connection closed${fancyColors.RESET}`);
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
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Maximum reconnection attempts reached (${MAX_RECONNECT_ATTEMPTS}). Giving up.${fancyColors.RESET}`);
        connectionState = 'failed';
        return;
    }

    const delay = BASE_RECONNECT_DELAY * Math.min(reconnectAttempts, 10);
    logApi.info(`${fancyColors.YELLOW}[UserWalletBalanceWS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})${fancyColors.RESET}`);
    
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
        
        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] WebSocket monitoring stopped${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Error stopping WebSocket: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Add a new wallet to monitor
 * @param {Object} user - User object from the database
 * @returns {Promise<boolean>} - Success status
 */
export async function addWalletToMonitor(user) {
    if (!user || !user.wallet_address) {
        return false;
    }

    try {
        // Add to monitored accounts
        monitoredAccounts.set(user.wallet_address, {
            id: user.id,
            nickname: user.nickname || 'Unknown',
            lastBalance: user.last_known_balance ? Number(user.last_known_balance) / LAMPORTS_PER_SOL : 0
        });

        // Subscribe if WebSocket is connected
        if (connectionState === 'connected' && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            subscribeToAccount(user.wallet_address);
        }

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Added wallet to monitor: ${user.wallet_address} (${user.nickname || 'Unknown'})${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to add wallet to monitor: ${error.message}${fancyColors.RESET}`, error);
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

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Removed wallet from monitor: ${address}${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to remove wallet from monitor: ${error.message}${fancyColors.RESET}`, error);
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
        readyStateText: wsConnection ? getReadyStateText(wsConnection.readyState) : 'No connection',
        stats: {
            ...stats,
            uptime: stats.initTime ? Math.floor((new Date() - new Date(stats.initTime)) / 1000) : 0
        }
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
        const activeUsers = await prisma.users.findMany({
            where: {
                is_banned: false
            },
            select: {
                id: true,
                wallet_address: true,
                nickname: true,
                last_known_balance: true
            }
        });

        // Filter out null wallet addresses
        const activeWallets = activeUsers.filter(user => user.wallet_address);

        // Reset monitored accounts
        monitoredAccounts.clear();

        // Store wallet info in monitored accounts map
        activeWallets.forEach(user => {
            if (user.wallet_address) {
                monitoredAccounts.set(user.wallet_address, {
                    id: user.id,
                    nickname: user.nickname || 'Unknown',
                    lastBalance: user.last_known_balance ? Number(user.last_known_balance) / LAMPORTS_PER_SOL : 0
                });
            }
        });

        // Resubscribe if connected
        if (connectionState === 'connected' && wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            await subscribeToAccounts();
        }

        logApi.info(`${fancyColors.CYAN}[UserWalletBalanceWS] Refreshed monitored wallets: ${activeWallets.length} user wallets${fancyColors.RESET}`);
        return true;
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to refresh monitored wallets: ${error.message}${fancyColors.RESET}`, error);
        return false;
    }
}

/**
 * Manually request a balance refresh for a specific wallet
 * @param {string} address - Wallet address to refresh
 * @returns {Promise<number|null>} - Current balance in SOL or null if failed
 */
export async function refreshWalletBalance(address) {
    try {
        if (!monitoredAccounts.has(address)) {
            logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] Cannot refresh wallet not being monitored: ${address}${fancyColors.RESET}`);
            return null;
        }

        // If WebSocket is not connected, can't refresh
        if (connectionState !== 'connected' || !wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
            logApi.warn(`${fancyColors.YELLOW}[UserWalletBalanceWS] Cannot refresh wallet, WebSocket not connected: ${address}${fancyColors.RESET}`);
            return null;
        }

        // Request account info to get current balance
        const requestId = `refresh-${Date.now()}`;
        
        return new Promise((resolve, reject) => {
            // Set up one-time message handler for this specific request
            const messageHandler = (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.id === requestId && message.result) {
                        // Remove the one-time listener
                        wsConnection.removeListener('message', messageHandler);
                        
                        if (message.result.value && message.result.value.lamports) {
                            const balance = message.result.value.lamports / LAMPORTS_PER_SOL;
                            resolve(balance);
                        } else {
                            resolve(null);
                        }
                    }
                } catch (error) {
                    // Ignore errors in the message handler
                }
            };

            // Add the one-time message handler
            wsConnection.on('message', messageHandler);

            // Set timeout to remove the handler if no response
            setTimeout(() => {
                wsConnection.removeListener('message', messageHandler);
                reject(new Error('Balance refresh request timed out'));
            }, 5000);

            // Send request for account info
            const message = {
                jsonrpc: '2.0',
                id: requestId,
                method: 'getAccountInfo',
                params: [
                    address,
                    {
                        encoding: 'jsonParsed',
                        commitment: 'confirmed'
                    }
                ]
            };

            wsConnection.send(JSON.stringify(message));
        });
    } catch (error) {
        logApi.error(`${fancyColors.RED}[UserWalletBalanceWS] Failed to refresh wallet balance: ${error.message}${fancyColors.RESET}`, error);
        return null;
    }
}

export default {
    initializeWalletBalanceWebSocket,
    stopWalletBalanceWebSocket,
    addWalletToMonitor,
    removeWalletFromMonitor,
    getWebSocketStatus,
    refreshMonitoredWallets,
    refreshWalletBalance
};