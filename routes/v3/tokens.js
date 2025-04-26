/**
 * Token v3 routes for DegenDuel
 * Uses the new market database implementation
 */

import express from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import marketDataService from '../../services/market-data/marketDataService.js';

const router = express.Router();

/**
 * @route GET /api/v3/tokens
 * @desc Get all tokens from the market database
 * @access Public
 */
router.get('/', async (req, res) => {
    try {
        const tokens = await marketDataService.getAllTokens();
        
        return res.json({
            status: 'success',
            count: tokens.length,
            data: tokens
        });
    } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[v3/tokens]${fancyColors.RESET} ${fancyColors.RED}Error fetching tokens:${fancyColors.RESET}`, error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch token data',
            error: error.message
        });
    }
});

/**
 * @route GET /api/v3/tokens/:symbol
 * @desc Get token details by symbol
 * @access Public
 */
router.get('/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol;
        
        if (!symbol) {
            return res.status(400).json({
                status: 'error',
                message: 'Token symbol is required'
            });
        }
        
        const token = await marketDataService.getToken(symbol);
        
        if (!token) {
            return res.status(404).json({
                status: 'error',
                message: `Token ${symbol} not found`
            });
        }
        
        return res.json({
            status: 'success',
            data: token
        });
    } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[v3/tokens]${fancyColors.RESET} ${fancyColors.RED}Error fetching token:${fancyColors.RESET}`, error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch token data',
            error: error.message
        });
    }
});

/**
 * @route GET /api/v3/tokens/address/:address
 * @desc Get token details by address
 * @access Public
 */
router.get('/address/:address', async (req, res) => {
    try {
        const address = req.params.address;
        
        if (!address) {
            return res.status(400).json({
                status: 'error',
                message: 'Token address is required'
            });
        }
        
        const token = await marketDataService.getTokenByAddress(address);
        
        if (!token) {
            return res.status(404).json({
                status: 'error',
                message: `Token with address ${address} not found`
            });
        }
        
        return res.json({
            status: 'success',
            data: token
        });
    } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[v3/tokens]${fancyColors.RESET} ${fancyColors.RED}Error fetching token:${fancyColors.RESET}`, error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch token data',
            error: error.message
        });
    }
});

/**
 * @route GET /api/v3/tokens/status
 * @desc Get status of the token data service
 * @access Public
 */
router.get('/status', async (req, res) => {
    try {
        const stats = marketDataService.marketStats;
        
        return res.json({
            status: 'success',
            data: {
                tokens: stats.tokens,
                updates: stats.updates,
                broadcasts: stats.broadcasts,
                performance: stats.performance,
                healthy: !marketDataService.stats?.circuitBreaker?.isOpen,
                circuitBreaker: marketDataService.stats?.circuitBreaker || {}
            }
        });
    } catch (error) {
        logApi.error(`${fancyColors.MAGENTA}[v3/tokens]${fancyColors.RESET} ${fancyColors.RED}Error fetching token service status:${fancyColors.RESET}`, error);
        
        return res.status(500).json({
            status: 'error',
            message: 'Failed to fetch token service status',
            error: error.message
        });
    }
});

export default router;