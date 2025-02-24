const WebSocket = require('ws');
const prisma = require('../../../db/prismaClient');
const logger = require('../../../logger');

class TokenDataSocket {
    constructor(wss) {
        this.wss = wss;
        this.subscriptions = new Map(); // clientId -> Set<tokenAddress>
        this.reverseSubscriptions = new Map(); // tokenAddress -> Set<clientId>
        this.updateInterval = 30000; // 30 seconds
        this.setupHeartbeat();
    }

    setupHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach(client => {
                if (client.isAlive === false) {
                    this.handleDisconnect(client);
                    return client.terminate();
                }
                client.isAlive = false;
                client.ping();
            });
        }, 30000);
    }

    initialize() {
        this.wss.on('connection', (ws, req) => {
            ws.isAlive = true;
            ws.id = Math.random().toString(36).substring(2);
            
            ws.on('pong', () => { ws.isAlive = true; });
            ws.on('message', (message) => this.handleMessage(ws, message));
            ws.on('close', () => this.handleDisconnect(ws));

            // Send initial connection success
            ws.send(JSON.stringify({
                type: 'connection',
                status: 'connected',
                clientId: ws.id
            }));
        });

        // Start the update loop
        this.startUpdateLoop();
    }

    async handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            
            switch (data.action) {
                case 'subscribe':
                    await this.handleSubscribe(ws, data);
                    break;
                    
                case 'unsubscribe':
                    await this.handleUnsubscribe(ws, data);
                    break;
                    
                case 'get_snapshot':
                    await this.sendSnapshot(ws, data);
                    break;
                    
                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Unknown action'
                    }));
            }
        } catch (error) {
            logger.error('WebSocket message handling error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message'
            }));
        }
    }

    async handleSubscribe(ws, data) {
        const { tokens, options = {} } = data;
        
        if (!Array.isArray(tokens)) {
            throw new Error('tokens must be an array');
        }

        // Initialize client's subscriptions if needed
        if (!this.subscriptions.has(ws.id)) {
            this.subscriptions.set(ws.id, new Set());
        }

        // Add subscriptions
        for (const token of tokens) {
            this.subscriptions.get(ws.id).add(token);
            
            // Update reverse mapping
            if (!this.reverseSubscriptions.has(token)) {
                this.reverseSubscriptions.set(token, new Set());
            }
            this.reverseSubscriptions.get(token).add(ws.id);
        }

        // Send confirmation
        ws.send(JSON.stringify({
            type: 'subscription',
            status: 'subscribed',
            tokens,
            options
        }));

        // Send initial data
        await this.sendSnapshot(ws, { tokens });
    }

    async handleUnsubscribe(ws, data) {
        const { tokens } = data;
        
        if (!Array.isArray(tokens)) {
            throw new Error('tokens must be an array');
        }

        const clientSubs = this.subscriptions.get(ws.id);
        if (clientSubs) {
            for (const token of tokens) {
                clientSubs.delete(token);
                
                // Update reverse mapping
                const tokenSubs = this.reverseSubscriptions.get(token);
                if (tokenSubs) {
                    tokenSubs.delete(ws.id);
                    if (tokenSubs.size === 0) {
                        this.reverseSubscriptions.delete(token);
                    }
                }
            }
        }

        ws.send(JSON.stringify({
            type: 'subscription',
            status: 'unsubscribed',
            tokens
        }));
    }

    handleDisconnect(ws) {
        // Clean up subscriptions
        const clientSubs = this.subscriptions.get(ws.id);
        if (clientSubs) {
            for (const token of clientSubs) {
                const tokenSubs = this.reverseSubscriptions.get(token);
                if (tokenSubs) {
                    tokenSubs.delete(ws.id);
                    if (tokenSubs.size === 0) {
                        this.reverseSubscriptions.delete(token);
                    }
                }
            }
            this.subscriptions.delete(ws.id);
        }
    }

    async sendSnapshot(ws, data) {
        const { tokens } = data;
        
        if (!Array.isArray(tokens)) {
            throw new Error('tokens must be an array');
        }

        const tokenData = await this.fetchTokenData(tokens);
        
        ws.send(JSON.stringify({
            type: 'snapshot',
            timestamp: Date.now(),
            data: tokenData
        }));
    }

    async startUpdateLoop() {
        setInterval(async () => {
            try {
                // Get all unique tokens being watched
                const watchedTokens = Array.from(this.reverseSubscriptions.keys());
                if (watchedTokens.length === 0) return;

                // Fetch latest data
                const tokenData = await this.fetchTokenData(watchedTokens);

                // Send updates to relevant clients
                for (const token of watchedTokens) {
                    const clients = this.reverseSubscriptions.get(token);
                    if (!clients) continue;

                    const update = {
                        type: 'update',
                        timestamp: Date.now(),
                        data: tokenData.find(t => t.address === token)
                    };

                    for (const clientId of clients) {
                        const client = Array.from(this.wss.clients)
                            .find(c => c.id === clientId);
                        
                        if (client?.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify(update));
                        }
                    }
                }
            } catch (error) {
                logger.error('WebSocket update loop error:', error);
            }
        }, this.updateInterval);
    }

    async fetchTokenData(tokens) {
        try {
            const tokenData = await prisma.token.findMany({
                where: {
                    contractAddress: {
                        in: tokens
                    }
                },
                include: {
                    priceHistory: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                    },
                    priceChanges: true,
                    socials: true,
                }
            });

            return tokenData.map(token => {
                const latestPrice = token.priceHistory[0];
                const priceChanges = token.priceChanges.reduce((acc, change) => {
                    acc[change.period] = Number(change.percentage);
                    return acc;
                }, {});

                // Format data same as REST API
                return {
                    address: token.contractAddress,
                    symbol: token.symbol,
                    name: token.name,
                    price: latestPrice ? latestPrice.price.toString() : '0',
                    market_cap: latestPrice ? latestPrice.marketCap.toString() : undefined,
                    volume: {
                        h24: latestPrice ? latestPrice.volume24h.toString() : undefined,
                        h6: latestPrice?.volume6h?.toString(),
                        h1: latestPrice?.volume1h?.toString(),
                        m5: latestPrice?.volume5m?.toString()
                    },
                    price_change: {
                        h24: priceChanges['24h']?.toString(),
                        h6: priceChanges['6h']?.toString(),
                        h1: priceChanges['1h']?.toString(),
                        m5: priceChanges['5m']?.toString(),
                        d7: priceChanges['7d']?.toString(),
                        d30: priceChanges['30d']?.toString()
                    },
                    metadata: {
                        lastUpdate: latestPrice ? latestPrice.timestamp.getTime() : null
                    }
                };
            });
        } catch (error) {
            logger.error('Error fetching token data:', error);
            throw error;
        }
    }
}

module.exports = TokenDataSocket; 