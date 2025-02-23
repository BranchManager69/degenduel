// /websocket/market-ws.js

// THIS IS THE MARKET DATA WEBSOCKET SERVER

import { BaseWebSocketServer } from '../utils/websocket-suite/base-websocket.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import marketDataService from '../services/marketDataService.js';

class MarketDataWebSocketServer extends BaseWebSocketServer {
    constructor(httpServer) {
        super(httpServer, {
            path: '/api/v2/ws/market',
            maxPayload: 1024 * 16, // 16KB max payload
            requireAuth: true,
            rateLimit: 600 // 10 updates/second as per requirements
        });

        this.symbolSubscriptions = new Map(); // clientId -> Set<symbol>
        this.marketDataService = new MarketDataService();
        this.startMarketDataStreams();
    }

    async handleClientMessage(ws, message, clientInfo) {
        try {
            const { type, symbols } = message;

            switch (type) {
                case 'SUBSCRIBE_SYMBOLS':
                    await this.handleSymbolSubscription(ws, clientInfo, symbols);
                    break;
                case 'UNSUBSCRIBE_SYMBOLS':
                    await this.handleSymbolUnsubscription(ws, clientInfo, symbols);
                    break;
                default:
                    this.sendError(ws, 'Unknown message type', 4004);
            }
        } catch (error) {
            logApi.error('Error handling market data message:', error);
            this.sendError(ws, 'Failed to process market data request', 5001);
        }
    }

    async handleSymbolSubscription(ws, clientInfo, symbols) {
        try {
            // Validate symbols
            const validSymbols = await prisma.tokens.findMany({
                where: {
                    symbol: {
                        in: symbols
                    },
                    is_active: true
                },
                select: {
                    symbol: true
                }
            });

            if (validSymbols.length === 0) {
                this.sendError(ws, 'No valid symbols provided', 4004);
                return;
            }

            // Add to subscriptions
            if (!this.symbolSubscriptions.has(clientInfo.userId)) {
                this.symbolSubscriptions.set(clientInfo.userId, new Set());
            }
            const userSubs = this.symbolSubscriptions.get(clientInfo.userId);
            validSymbols.forEach(({ symbol }) => userSubs.add(symbol));

            // Send initial state for each symbol
            for (const { symbol } of validSymbols) {
                await this.sendMarketData(ws, symbol);
            }

        } catch (error) {
            logApi.error('Error in symbol subscription:', error);
            this.sendError(ws, 'Failed to subscribe to market data', 5002);
        }
    }

    async handleSymbolUnsubscription(ws, clientInfo, symbols) {
        const userSubs = this.symbolSubscriptions.get(clientInfo.userId);
        if (userSubs) {
            symbols.forEach(symbol => userSubs.delete(symbol));
        }
    }

    async sendMarketData(ws, symbol) {
        try {
            const [price, volume, sentiment] = await Promise.all([
                this.marketDataService.getPrice(symbol),
                this.marketDataService.getVolume(symbol),
                this.marketDataService.getSentiment(symbol)
            ]);

            // Send price data
            if (price) {
                this.sendToClient(ws, {
                    type: 'MARKET_PRICE',
                    data: {
                        symbol,
                        price: price.current,
                        change_24h: price.change_24h,
                        volume_24h: price.volume_24h,
                        high_24h: price.high_24h,
                        low_24h: price.low_24h,
                        timestamp: new Date().toISOString()
                    }
                });
            }

            // Send volume data
            if (volume) {
                this.sendToClient(ws, {
                    type: 'MARKET_VOLUME',
                    data: {
                        symbol,
                        volume: volume.total,
                        trades_count: volume.trades_count,
                        buy_volume: volume.buy_volume,
                        sell_volume: volume.sell_volume,
                        interval: volume.interval,
                        timestamp: new Date().toISOString()
                    }
                });
            }

            // Send sentiment data
            if (sentiment) {
                this.sendToClient(ws, {
                    type: 'MARKET_SENTIMENT',
                    data: {
                        symbol,
                        sentiment_score: sentiment.score,
                        buy_pressure: sentiment.buy_pressure,
                        sell_pressure: sentiment.sell_pressure,
                        volume_trend: sentiment.volume_trend,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        } catch (error) {
            logApi.error('Error sending market data:', error);
        }
    }

    startMarketDataStreams() {
        // Update market data every 100ms (10 updates/second as per requirements)
        setInterval(async () => {
            const allSymbols = new Set();
            this.symbolSubscriptions.forEach(symbols => {
                symbols.forEach(symbol => allSymbols.add(symbol));
            });

            for (const symbol of allSymbols) {
                const clients = this._getConnectedClients()
                    .filter(client => {
                        const clientInfo = this._getClientInfo(client);
                        return clientInfo && this.symbolSubscriptions.get(clientInfo.userId)?.has(symbol);
                    });

                for (const client of clients) {
                    await this.sendMarketData(client, symbol);
                }
            }
        }, 100);
    }

    cleanup() {
        this.symbolSubscriptions.clear();
        super.cleanup();
    }
}

export function createMarketDataWebSocket(httpServer) {
    return new MarketDataWebSocketServer(httpServer);
}

export default MarketDataWebSocketServer; 