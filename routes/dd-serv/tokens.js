// /routes/dd-serv/tokens.js

// ...

import express from 'express';
import prisma from '../../config/prisma.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import redisManager from '../../utils/redis-suite/redis-manager.js';

const router = express.Router();
const TOKENS_CACHE_KEY = 'dd_serv:tokens';
const CACHE_TTL = 30; // 30 seconds

/**
 * @swagger
 * tags:
 *   name: DD-Serv
 *   description: API endpoints for accessing token and market data from the DegenDuel Data Server
 */

// Configuration
const DD_SERV_CONFIG = {
    timeout_ms: 10000,
    max_retries: 3,
    retry_delay_ms: 5000,
    alert_threshold_failures: 3
};

// Stats tracking
const ddServStats = {
    operations: {
        total: 0,
        successful: 0,
        failed: 0
    },
    endpoints: {},
    performance: {
        average_response_time_ms: 0
    },
    last_successful_fetch: null
};

// Utility function for monitored fetch with retries
async function monitoredFetch(url, options = {}, endpointName = 'unknown') {
    const retryCycleId = Math.random().toString(36).substring(2, 8);
    const startTime = Date.now();

    // Initialize endpoint stats if not exists
    if (!ddServStats.endpoints[endpointName]) {
        ddServStats.endpoints[endpointName] = {
            total: 0,
            successful: 0,
            failed: 0,
            average_response_time_ms: 0,
            last_error: null,
            last_success: null
        };
    }

    let lastError = null;
    
    for (let attempt = 1; attempt <= DD_SERV_CONFIG.max_retries; attempt++) {
        try {
            // Log attempt start
            logApi.info(`[dd-serv] 🔄 Request cycle ${retryCycleId} - Attempt ${attempt}/${DD_SERV_CONFIG.max_retries}\n` +
                `Endpoint: ${endpointName}\n` +
                `URL: ${url}`);

            // Setup timeout
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), DD_SERV_CONFIG.timeout_ms);
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            // Update stats
            const duration = Date.now() - startTime;
            ddServStats.operations.total++;
            ddServStats.endpoints[endpointName].total++;
            
            if (response.ok) {
                // Log success
                logApi.info(`[dd-serv] 😅 Request cycle ${retryCycleId} succeeded on attempt ${attempt}`);
                
                // Success handling
                ddServStats.operations.successful++;
                ddServStats.endpoints[endpointName].successful++;
                ddServStats.last_successful_fetch = new Date().toISOString();
                ddServStats.endpoints[endpointName].last_success = new Date().toISOString();
                
                // Update performance metrics
                const endpointStats = ddServStats.endpoints[endpointName];
                endpointStats.average_response_time_ms = 
                    (endpointStats.average_response_time_ms * (endpointStats.total - 1) + duration) / endpointStats.total;
                
                return response;
            }
            
            // Non-200 response
            const text = await response.text();
            logApi.warn(`[dd-serv] ❌ Request cycle ${retryCycleId} failed (Attempt ${attempt}/${DD_SERV_CONFIG.max_retries})\n` +
                `Status: ${response.status}\n` +
                `Endpoint: ${endpointName}\n` +
                `URL: ${url}\n` +
                `Response: ${text}`);
            throw new Error(`HTTP ${response.status}: ${text}`);
            
        } catch (err) {
            lastError = err;
            
            // Update failure stats
            ddServStats.operations.failed++;
            ddServStats.endpoints[endpointName].failed++;
            ddServStats.endpoints[endpointName].last_error = {
                message: err.message,
                timestamp: new Date().toISOString()
            };

            // Log failure
            logApi.error(`[dd-serv] ⚠️ Request cycle ${retryCycleId} error:`, {
                attempt,
                error: err.message,
                endpoint: endpointName
            });

            // If this was our last attempt, throw the error
            if (attempt === DD_SERV_CONFIG.max_retries) {
                throw err;
            }

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, DD_SERV_CONFIG.retry_delay_ms));
        }
    }
}

// Reset stats endpoint
router.post('/reset-stats', async (req, res) => {
    try {
        Object.assign(ddServStats, {
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            },
            endpoints: {},
            performance: {
                average_response_time_ms: 0
            },
            last_successful_fetch: null
        });

        res.json({ message: 'Stats reset successfully', stats: ddServStats });
    } catch (error) {
        logApi.error('Failed to reset stats:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get OFFICIAL DD-Serv list of tokens
//   example: GET https://degenduel.me/api/dd-serv/tokens
/**
 * @swagger
 * /api/dd-serv/tokens:
 *   get:
 *     summary: Get a list of all tokens from the DD-Serv (data.degenduel.me)
 *     tags: [DD-Serv]
 */ 
router.get('/tokens', async (req, res) => {
    try {
        // Try to get cached data first
        const cachedData = await redisManager.get(TOKENS_CACHE_KEY);
        if (cachedData) {
            return res.json({
                ...cachedData,
                _cached: true,
                _cachedAt: new Date(cachedData.timestamp).toISOString()
            });
        }

        // If no cache, fetch fresh data
        const response = await monitoredFetch(
            'https://data.degenduel.me/api/tokens',
            {},
            'tokens'
        );
        
        const tokenDataJson = await response.json();
        await redisManager.set(TOKENS_CACHE_KEY, tokenDataJson, CACHE_TTL);

        res.json(tokenDataJson);
    } catch (err) {
        // Try to get stale cache as fallback
        try {
            const staleCache = await redisManager.get(TOKENS_CACHE_KEY);
            if (staleCache) {
                return res.json({
                    ...staleCache,
                    _cached: true,
                    _stale: true,
                    _cachedAt: new Date(staleCache.timestamp).toISOString()
                });
            }
        } catch (redisErr) {
            logApi.error('[dd-serv] Redis error:', redisErr);
        }
        
        res.status(503).json({ 
            error: err.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * @swagger
 * /api/dd-serv/tokens/list:
 *   get:
 *     summary: Get a list of tokens with configurable detail level
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: query
 *         name: detail
 *         schema:
 *           type: string
 *           enum: [simple, full]
 *         description: Level of detail to return
 *         default: simple
 */
router.get('/tokens/list', async (req, res) => {
    try {
        const { detail = 'simple' } = req.query;
        
        // Try to get cached data first
        const cachedData = await redisManager.get(TOKENS_CACHE_KEY);
        if (cachedData) {
            logApi.info('[dd-serv] Using cached token data for tokens/list endpoint');
            
            // Process cached data according to detail level
            if (!cachedData || !cachedData.data || !Array.isArray(cachedData.data)) {
                throw new Error('Invalid cached data format');
            }
            
            if (detail === 'simple') {
                const simpleTokens = cachedData.data.map(token => ({
                    contractAddress: token.contractAddress || null,
                    name: token.name || 'Unknown',
                    symbol: token.symbol || 'UNKNOWN'
                }));
                return res.json(simpleTokens);
            }
            
            // Return full flattened token data with null checks
            const flattenedTokens = cachedData.data.map(token => ({
                timestamp: cachedData.timestamp || new Date().toISOString(),
                id: token.id,
                symbol: token.symbol || 'UNKNOWN',
                name: token.name || 'Unknown',
                contractAddress: token.contractAddress,
                chain: token.chain,
                createdAt: token.createdAt,
                updatedAt: token.updatedAt,
                marketCap: token.marketCap || 0,
                price: token.price || 0,
                volume24h: token.volume24h || 0,
                change_h1: token.changesJson?.h1 || 0,
                change_h6: token.changesJson?.h6 || 0,
                change_m5: token.changesJson?.m5 || 0,
                change_h24: token.changesJson?.h24 || 0,
                imageUrl: token.imageUrl || null,
                liquidity_usd: token.liquidity?.usd || 0,
                liquidity_base: token.liquidity?.base || 0,
                liquidity_quote: token.liquidity?.quote || 0,
                pairUrl: token.pairUrl || null,
                transactions_h1_buys: token.transactionsJson?.h1?.buys || 0,
                transactions_h1_sells: token.transactionsJson?.h1?.sells || 0,
                transactions_h6_buys: token.transactionsJson?.h6?.buys || 0,
                transactions_h6_sells: token.transactionsJson?.h6?.sells || 0,
                transactions_m5_buys: token.transactionsJson?.m5?.buys || 0,
                transactions_m5_sells: token.transactionsJson?.m5?.sells || 0,
                transactions_h24_buys: token.transactionsJson?.h24?.buys || 0,
                transactions_h24_sells: token.transactionsJson?.h24?.sells || 0,
                baseToken_name: token.baseToken?.name || null,
                baseToken_symbol: token.baseToken?.symbol || null,
                baseToken_address: token.baseToken?.address || null,
                headerImage: token.headerImage || null,
                openGraphImage: token.openGraphImage || null,
                quoteToken_name: token.quoteToken?.name || null,
                quoteToken_symbol: token.quoteToken?.symbol || null,
                quoteToken_address: token.quoteToken?.address || null,
                websites: token.websites || [],
                coingeckoId: token.coingeckoId || null,
                priceChanges: token.priceChanges || {},
                socials: token.socials || {}
            }));
            
            return res.json(flattenedTokens);
        }
        
        // If no cache, try to get data from external API
        try {
            logApi.info('[dd-serv] Fetching fresh token data for tokens/list endpoint');
            const response = await monitoredFetch(
                'https://data.degenduel.me/api/tokens',
                {},
                'tokens_list'
            );
            
            const tokenDataJson = await response.json();
            
            // Cache the new data
            await redisManager.set(TOKENS_CACHE_KEY, tokenDataJson, CACHE_TTL);
            
            // Validate response structure
            if (!tokenDataJson || !tokenDataJson.data || !Array.isArray(tokenDataJson.data)) {
                throw new Error('Invalid response format from data service');
            }
            
            if (detail === 'simple') {
                const simpleTokens = tokenDataJson.data.map(token => ({
                    contractAddress: token.contractAddress || null,
                    name: token.name || 'Unknown',
                    symbol: token.symbol || 'UNKNOWN'
                }));
                return res.json(simpleTokens);
            }
            
            // Return full flattened token data with null checks
            const flattenedTokens = tokenDataJson.data.map(token => ({
                timestamp: tokenDataJson.timestamp || new Date().toISOString(),
                id: token.id,
                symbol: token.symbol || 'UNKNOWN',
                name: token.name || 'Unknown',
                contractAddress: token.contractAddress,
                chain: token.chain,
                createdAt: token.createdAt,
                updatedAt: token.updatedAt,
                marketCap: token.marketCap || 0,
                price: token.price || 0,
                volume24h: token.volume24h || 0,
                change_h1: token.changesJson?.h1 || 0,
                change_h6: token.changesJson?.h6 || 0,
                change_m5: token.changesJson?.m5 || 0,
                change_h24: token.changesJson?.h24 || 0,
                imageUrl: token.imageUrl || null,
                liquidity_usd: token.liquidity?.usd || 0,
                liquidity_base: token.liquidity?.base || 0,
                liquidity_quote: token.liquidity?.quote || 0,
                pairUrl: token.pairUrl || null,
                transactions_h1_buys: token.transactionsJson?.h1?.buys || 0,
                transactions_h1_sells: token.transactionsJson?.h1?.sells || 0,
                transactions_h6_buys: token.transactionsJson?.h6?.buys || 0,
                transactions_h6_sells: token.transactionsJson?.h6?.sells || 0,
                transactions_m5_buys: token.transactionsJson?.m5?.buys || 0,
                transactions_m5_sells: token.transactionsJson?.m5?.sells || 0,
                transactions_h24_buys: token.transactionsJson?.h24?.buys || 0,
                transactions_h24_sells: token.transactionsJson?.h24?.sells || 0,
                baseToken_name: token.baseToken?.name || null,
                baseToken_symbol: token.baseToken?.symbol || null,
                baseToken_address: token.baseToken?.address || null,
                headerImage: token.headerImage || null,
                openGraphImage: token.openGraphImage || null,
                quoteToken_name: token.quoteToken?.name || null,
                quoteToken_symbol: token.quoteToken?.symbol || null,
                quoteToken_address: token.quoteToken?.address || null,
                websites: token.websites || [],
                coingeckoId: token.coingeckoId || null,
                priceChanges: token.priceChanges || {},
                socials: token.socials || {}
            }));
            
            return res.json(flattenedTokens);
        } catch (fetchErr) {
            logApi.warn(`[dd-serv] External API fetch failed: ${fetchErr.message}`);
            // Continue to fallback mechanisms
        }
        
        // No cache and external API failed, use database as direct source
        logApi.info('[dd-serv] Using database as direct source for tokens/list');
        const dbTokens = await prisma.tokens.findMany({
            where: { is_active: true },
            include: { token_prices: true }
        });
        
        if (!dbTokens || dbTokens.length === 0) {
            throw new Error('No tokens found in database');
        }
        
        if (detail === 'simple') {
            const simpleTokens = dbTokens.map(token => ({
                contractAddress: token.address,
                name: token.name,
                symbol: token.symbol
            }));
            return res.json(simpleTokens);
        }
        
        const flattenedTokens = dbTokens.map(token => ({
            id: token.id,
            symbol: token.symbol,
            name: token.name,
            contractAddress: token.address,
            chain: "solana",
            createdAt: token.created_at,
            updatedAt: token.updated_at,
            marketCap: token.market_cap || 0,
            price: token.token_prices?.price || 0,
            volume24h: token.volume_24h || 0,
            change_h24: token.change_24h || 0,
            imageUrl: token.image_url,
            changesJson: { h24: token.change_24h || 0 },
            // Default values for required properties
            baseToken: { name: null, symbol: null, address: null },
            quoteToken: { name: null, symbol: null, address: null },
            websites: [token.website_url].filter(Boolean),
            socials: {
                twitter: token.twitter_url,
                telegram: token.telegram_url,
                discord: token.discord_url
            }
        }));
        
        return res.json(flattenedTokens);
    } catch (err) {
        // All sources failed, return a minimal response with error info
        logApi.error('[dd-serv] All token data sources failed:', err.message);
        res.status(503).json({
            error: "Token data service unavailable",
            message: "Unable to retrieve token data from any source",
            timestamp: new Date().toISOString(),
            details: err.message
        });
    }
});

/**
 * @swagger
 * /api/dd-serv/tokens/{tokenAddress}/price-history:
 *   get:
 *     summary: Get price history of a token
 *     tags: [DD-Serv]
 *     parameters:
 *       - in: path
 *         name: tokenAddress
 *         required: true
 *         description: The address of the token
 */
router.get('/tokens/:tokenAddress/price-history', async (req, res) => {
    const { tokenAddress } = req.params;
    let currentPrice = null;
    
    try {
        // First try to get the current price from the database
        const token = await prisma.tokens.findUnique({
            where: { address: tokenAddress },
            select: { 
                id: true,
                token_prices: true
            }
        });
        
        if (!token) {
            return res.status(404).json({
                success: false,
                error: 'Token not found'
            });
        }
        
        // Get current price if available
        if (token.token_prices) {
            currentPrice = {
                token_address: tokenAddress,
                price: token.token_prices.price,
                timestamp: token.token_prices.updated_at
            };
        }

        // Try DD-serve with timeout for historical data
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await monitoredFetch(
            `https://data.degenduel.me/api/tokens/${tokenAddress}/price-history`,
            { signal: controller.signal },
            'price_history'
        );

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`DD-serve returned ${response.status}`);
        }

        const priceHistory = await response.json();

        // Update the current price in the database if we got new data
        if (priceHistory.data?.length > 0) {
            const latestPrice = priceHistory.data[0];
            
            // Update the token_prices record (upsert since there's only one record per token)
            await prisma.token_prices.upsert({
                where: { 
                    token_id: token.id 
                },
                update: {
                    price: latestPrice.price,
                    updated_at: new Date(latestPrice.timestamp)
                },
                create: {
                    token_id: token.id,
                    price: latestPrice.price,
                    updated_at: new Date(latestPrice.timestamp)
                }
            });
        }

        res.json({
            success: true,
            data: priceHistory.data,
            source: 'dd-serve'
        });
    } catch (err) {
        // If DD-serve failed, return current price with warning if available
        if (currentPrice) {
            return res.json({
                success: true,
                data: [currentPrice],
                source: 'cache',
                warning: 'Using cached data due to DD-serve error'
            });
        }

        logApi.error('DD-serve price history error:', {
            error: err.message,
            token: tokenAddress
        });
        res.status(503).json({ 
            success: false,
            error: 'Price service temporarily unavailable',
            retryAfter: 5
        });
    }
});

/**
 * @swagger
 * /api/dd-serv/tokens/bulk-price-history:
 *   post:
 *     summary: Get price history for multiple tokens
 *     tags: [DD-Serv]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 */
router.post('/tokens/bulk-price-history', async (req, res) => {
    const { addresses } = req.body;
    
    if (!Array.isArray(addresses)) {
        return res.status(400).json({ error: 'addresses must be an array of strings' });
    }

    try {
        // First get current prices from database for all tokens
        const tokens = await prisma.tokens.findMany({
            where: {
                address: {
                    in: addresses
                }
            },
            select: {
                id: true,
                address: true,
                token_prices: true
            }
        });
        
        // Create a map of address to current price
        const currentPrices = {};
        tokens.forEach(token => {
            if (token.token_prices) {
                currentPrices[token.address] = {
                    token_address: token.address,
                    price: token.token_prices.price,
                    timestamp: token.token_prices.updated_at
                };
            }
        });
        
        // Create a map of address to token_id for updating prices later
        const tokenIdMap = {};
        tokens.forEach(token => {
            tokenIdMap[token.address] = token.id;
        });

        // Fetch price histories in parallel
        const priceHistories = await Promise.all(
            addresses.map(async (address) => {
                try {
                    const response = await monitoredFetch(
                        `https://data.degenduel.me/api/tokens/${address}/price-history`,
                        {},
                        'bulk_price_history'
                    );
                    const data = await response.json();
                    
                    // Update current price in database if we have new data
                    if (data.data?.length > 0 && tokenIdMap[address]) {
                        const latestPrice = data.data[0];
                        
                        // Update the token_prices record
                        await prisma.token_prices.upsert({
                            where: { 
                                token_id: tokenIdMap[address]
                            },
                            update: {
                                price: latestPrice.price,
                                updated_at: new Date(latestPrice.timestamp)
                            },
                            create: {
                                token_id: tokenIdMap[address],
                                price: latestPrice.price,
                                updated_at: new Date(latestPrice.timestamp)
                            }
                        });
                    }
                    
                    return { [address]: data };
                } catch (err) {
                    // If external service fails, use current price from database if available
                    if (currentPrices[address]) {
                        return { 
                            [address]: {
                                success: true,
                                data: [currentPrices[address]],
                                source: 'cache',
                                warning: 'Using cached data due to DD-serve error'
                            }
                        };
                    }
                    
                    return { [address]: { error: err.message } };
                }
            })
        );

        // Combine results
        const result = {};
        priceHistories.forEach(history => {
            Object.assign(result, history);
        });

        res.json(result);
    } catch (err) {
        logApi.error('Bulk price history error:', err);
        res.status(500).json({ error: 'Failed to fetch bulk price history' });
    }
});

export default router;