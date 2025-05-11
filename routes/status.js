// /routes/status.js

/** 
 * Launch Countdown Status:
 * 
 * @description This route handles the countdown mode for the launch of the platform.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-05-09
 * @updated 2025-05-09 
 */

import express from "express";
import prisma from "../config/prisma.js";
import { logApi } from "../utils/logger-suite/logger.js";
import tokenPriceWs from '../services/market-data/token-price-ws.js';
import { jupiterClient } from '../services/solana-engine/jupiter-client.js';
import tokenActivationService from '../services/token-activation/token-activation-service.js';

const router = express.Router();

/**
 * Parse maintenance mode value safely
 * @param {any} value The value to parse
 * @returns {{enabled: boolean}} Parsed maintenance mode object
 */
function parseMaintenanceMode(value) {
  try {
    // If it's already an object with enabled property, return it
    if (value && typeof value === 'object' && 'enabled' in value) {
      return { enabled: Boolean(value.enabled) };
    }

    // If it's a string, try to parse it
    if (typeof value === 'string') {
      // Handle the [object Object] case
      if (value === '[object Object]') {
        return { enabled: false };
      }
      
      try {
        const parsed = JSON.parse(value);
        return { enabled: Boolean(parsed?.enabled) };
      } catch (e) {
        // If parsing fails, assume it's not enabled
        return { enabled: false };
      }
    }

    // Default case
    return { enabled: false };
  } catch (error) {
    logApi.error("Failed to parse maintenance mode value", { value, error });
    return { enabled: false };
  }
}

/**
 * @route GET /api/status
 * @description Public endpoint to check system operational status (maintenance mode)
 * @access Public
 */
router.get("/", async (req, res) => {
  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key: "maintenance_mode" },
    });

    // Safely parse the maintenance mode value
    const maintenanceMode = parseMaintenanceMode(setting?.value);
    
    if (maintenanceMode.enabled) {
      return res.status(503).json({
        maintenance: true,
        message: "System is under maintenance",
      });
    }

    // Check for degraded services
    const serviceHealth = await prisma.system_settings.findMany({
      where: {
        key: "service_health",
        updated_at: {
          gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
        },
      },
    });

    const degradedServices = serviceHealth
      .map((record) => {
        try {
          const data = typeof record.value === 'string' 
            ? JSON.parse(record.value)
            : record.value;
            
          return {
            name: data.service_name,
            status: data.status,
          };
        } catch (error) {
          logApi.warn("Failed to parse service health record", { record, error });
          return null;
        }
      })
      .filter(Boolean) // Remove null entries
      .filter(
        (service) =>
          service.status === "degraded" || service.status === "failed"
      )
      .map((service) => service.name);

    return res.status(200).json({
      maintenance: false,
      degraded_services: degradedServices,
    });
  } catch (error) {
    // Log the error with full details
    logApi.error("Failed to check maintenance status", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    // Return a 500 error instead of falsely claiming maintenance mode
    return res.status(500).json({
      error: "Internal server error",
      message: "Unable to determine system status",
    });
  }
});

/**
 * @swagger
 * /api/status/maintenance:
 *   get:
 *     summary: Get public maintenance status and settings
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Current maintenance settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 start_time:
 *                   type: string
 *                   format: date-time
 *                 estimated_duration:
 *                   type: number
 *                 updated_at:
 *                   type: string
 *                   format: date-time
 */
router.get("/maintenance", async (req, res) => {
  try {
    const maintenanceMode = await prisma.system_settings.findUnique({
      where: { key: "maintenance_mode" },
    });

    const startTime = await prisma.system_settings.findUnique({
      where: { key: "maintenance_start_time" },
    });

    const duration = await prisma.system_settings.findUnique({
      where: { key: "maintenance_estimated_duration" },
    });

    res.json({
      start_time: startTime?.value || new Date().toISOString(),
      estimated_duration: duration?.value ? parseInt(duration.value) : 15,
      updated_at: maintenanceMode?.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    logApi.error("Failed to get public maintenance status", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    res.status(500).json({ error: "Failed to get maintenance status" });
  }
});

/**
 * @swagger
 * /api/status/countdown:
 *   get:
 *     summary: Get countdown mode status for public display
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Current countdown mode settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 end_time:
 *                   type: string
 *                   format: date-time
 *                 title:
 *                   type: string
 *                 message:
 *                   type: string
 *                 redirect_url:
 *                   type: string
 */
router.get("/countdown", async (req, res) => {
  try {
    const countdown = await prisma.system_settings.findUnique({
      where: { key: "countdown_mode" },
    });

    if (!countdown || !countdown.value || !countdown.value.enabled) {
      return res.json({
        enabled: false
      });
    }

    // Get token contract address from token_config (just get the first row)
    const tokenConfig = await prisma.token_config.findFirst();

    // Get token price information if available
    let tokenInfo = null;
    if (tokenConfig?.address) {
      const token = await prisma.tokens.findUnique({
        where: { address: tokenConfig.address },
        select: {
          id: true,
          address: true,
          symbol: true,
          name: true,
          decimals: true,
          raw_supply: true
        }
      });

      if (token) {
        // Get token price info
        const tokenPrice = await prisma.token_prices.findUnique({
          where: { token_id: token.id },
          select: {
            price: true,
            market_cap: true,
            volume_24h: true,
            fdv: true,
            liquidity: true,
            change_24h: true
          }
        });

        // Calculate market cap if not provided but we have price and raw_supply
        let calculatedMarketCap = null;
        if (tokenPrice?.price && token.raw_supply && token.decimals) {
          try {
            const price = parseFloat(tokenPrice.price);
            const adjustedSupply = token.raw_supply / Math.pow(10, token.decimals);
            calculatedMarketCap = Math.round(price * adjustedSupply);
          } catch (e) {
            logApi.warn("Failed to calculate market cap:", e);
          }
        }

        tokenInfo = {
          ...token,
          price: tokenPrice?.price || null,
          market_cap: tokenPrice?.market_cap || calculatedMarketCap,
          volume_24h: tokenPrice?.volume_24h || null,
          fdv: tokenPrice?.fdv || null,
          liquidity: tokenPrice?.liquidity || null,
          change_24h: tokenPrice?.change_24h || null
        };
      }
    }

    // Calculate countdown information
    const now = new Date();
    const endTimeStr = countdown.value.end_time;
    let countdownInfo = null;

    if (endTimeStr) {
      try {
        const endTime = new Date(endTimeStr);
        const timeRemaining = endTime - now;

        if (timeRemaining > 0) {
          const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
          const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);

          countdownInfo = {
            days,
            hours,
            minutes,
            seconds,
            total_seconds: Math.floor(timeRemaining / 1000)
          };
        } else {
          countdownInfo = {
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
            total_seconds: 0,
            expired: true
          };
        }
      } catch (e) {
        logApi.warn("Failed to parse countdown end time:", e);
      }
    }

    // Get token configuration info - simplified
    const tokenConfigInfo = tokenConfig ? {
      symbol: tokenConfig.symbol,
      address: tokenConfig.address
    } : null;

    // Return countdown data if it's enabled
    return res.json({
      enabled: true,
      end_time: countdown.value.end_time,
      title: countdown.value.title || "Coming Soon",
      message: countdown.value.message || "Our platform is launching soon.",
      redirect_url: countdown.value.redirect_url,
      token_address: tokenConfig?.address || null,
      token_info: tokenInfo,
      token_config: tokenConfigInfo,
      countdown: countdownInfo
    });
  } catch (error) {
    logApi.error("Failed to get countdown status", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(500).json({ error: "Failed to get countdown status" });
  }
});

/**
 * @swagger
 * /api/status/token-price-ws:
 *   get:
 *     summary: Get real-time stats from the TokenPriceWebSocketService
 *     tags: [Status, Metrics]
 *     responses:
 *       200:
 *         description: Successfully retrieved stats from TokenPriceWebSocketService.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 serviceName:
 *                   type: string
 *                   example: TokenPriceWebSocketService
 *                 currentServerTime:
 *                   type: string
 *                   format: date-time
 *                 statusSummary:
 *                   type: string
 *                   example: "Connected, monitoring X pools for Y tokens."
 *                 connected:
 *                   type: boolean
 *                 lastConnectionTime:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 reconnections:
 *                   type: number
 *                 tokenCount:
 *                   type: number
 *                   description: "Number of unique tokens being targeted for price monitoring."
 *                 monitoredTokenDetails:
 *                   type: array
 *                   description: "Details of tokens being monitored (address, symbol)."
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       symbol:
 *                         type: string
 *                 poolCount:
 *                   type: number
 *                   description: "Number of distinct liquidity pools actively being monitored via WebSocket."
 *                 monitoredPoolAddresses:
 *                   type: array
 *                   description: "Addresses of liquidity pools being monitored."
 *                   items:
 *                     type: string
 *                     example: "abcdef1234567890..."
 *                 priceUpdates:
 *                   type: number
 *                 lastActivity:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 errors:
 *                   type: number
 *                 minimumPriorityScore:
 *                   type: number
 *                 now:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Server error while trying to retrieve stats.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                 details:
 *                   type: string
 */
router.get("/token-price-ws", async (req, res) => {
  try {
    if (!tokenPriceWs || typeof tokenPriceWs.getStats !== 'function') {
      logApi.error("[API /status/token-price-ws] TokenPriceWs service or getStats method is not available.");
      return res.status(500).json({ error: "TokenPriceWs service is currently unavailable." });
    }

    const stats = tokenPriceWs.getStats();
    
    const responsePayload = {
      serviceName: "TokenPriceWebSocketService",
      currentServerTime: new Date().toISOString(),
      statusSummary: stats.connected ? `Connected, monitoring ${stats.poolCount} pools for ${stats.tokenCount} tokens.` : "Not connected",
      ...stats 
    };

    res.json(responsePayload);

  } catch (error) {
    logApi.error("[API /status/token-price-ws] Failed to get TokenPriceWs stats:", { 
        errorMessage: error.message,
        // errorStack: process.env.NODE_ENV === "development" ? error.stack : undefined, // Optional: include stack in dev
    });
    res.status(500).json({ 
        error: "Failed to retrieve TokenPriceWs stats.",
        details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/status/token-data-pipeline:
 *   get:
 *     summary: Get a comprehensive overview of the DegenDuel Token Data Pipeline.
 *     tags: [Status, Metrics, Pipeline]
 *     description: |
 *       Provides aggregated status and metrics from key services involved in token data discovery, 
 *       enrichment, activation, and real-time monitoring. This includes:
 *       - JupiterClient: For new token discovery and list synchronization.
 *       - TokenActivationService: For metadata enrichment (DexScreener, Helius) and setting `is_active` status.
 *       - TokenPriceWebSocketService: For real-time price/pool monitoring (Helius WebSockets).
 *       - Overall database counts for tokens.
 *     responses:
 *       200:
 *         description: Successfully retrieved the comprehensive pipeline status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 overview:
 *                   type: object
 *                   properties:
 *                     lastRefreshed:
 *                       type: string
 *                       format: date-time
 *                     description:
 *                       type: string
 *                       example: "Aggregated status of the DegenDuel Token Data Pipeline."
 *                 databaseCounts:
 *                   type: object
 *                   properties:
 *                     totalTokensInDB:
 *                       type: integer
 *                     activeTokensInDB:
 *                       type: integer
 *                     tokensWithPriceData:
 *                       type: integer
 *                 jupiterClient:
 *                   type: object
 *                   description: "Status and metrics from JupiterClient."
 *                 tokenActivationService:
 *                   type: object
 *                   description: "Status and metrics from TokenActivationService."
 *                 tokenPriceWebSocketService:
 *                   type: object
 *                   description: "Status and metrics from TokenPriceWebSocketService."
 *       500:
 *         description: Server error while trying to retrieve pipeline status.
 */
router.get("/token-data-pipeline", async (req, res) => {
  const fullReport = {
    overview: {
      lastRefreshed: new Date().toISOString(),
      description: "Aggregated status of the DegenDuel Token Data Pipeline."
    },
    databaseCounts: { error: "Failed to fetch database counts" },
    jupiterClient: { status: "unavailable", error: "Service instance or getServiceStatus method not found." },
    tokenActivationService: { status: "unavailable", error: "Service instance or getServiceStatus method not found." },
    tokenPriceWebSocketService: { status: "unavailable", error: "Service instance or getStats method not found." },
  };

  try {
    // 1. Database Counts
    try {
      const [totalTokens, activeTokens, tokensWithPrices] = await prisma.$transaction([
        prisma.tokens.count(),
        prisma.tokens.count({ where: { is_active: true } }),
        prisma.token_prices.count({ where: { price: { not: null } } })
      ]);
      fullReport.databaseCounts = {
        totalTokensInDB: totalTokens,
        activeTokensInDB: activeTokens,
        tokensWithPriceData: tokensWithPrices,
      };
    } catch (dbError) {
      logApi.error("[API /token-data-pipeline] Error fetching DB counts:", dbError);
      fullReport.databaseCounts = { error: dbError.message || "Unknown DB error" };
    }

    // 2. JupiterClient Status
    if (jupiterClient && typeof jupiterClient.getServiceStatus === 'function') {
      try {
        fullReport.jupiterClient = jupiterClient.getServiceStatus();
      } catch (e) {
        logApi.error("[API /token-data-pipeline] Error getting JupiterClient status:", e);
        fullReport.jupiterClient = { status: "error_fetching", error: e.message };
      }
    } else {
      logApi.warn("[API /token-data-pipeline] JupiterClient or its getServiceStatus is not available.");
    }

    // 3. TokenActivationService Status
    if (tokenActivationService && typeof tokenActivationService.getServiceStatus === 'function') {
      try {
        fullReport.tokenActivationService = tokenActivationService.getServiceStatus();
      } catch (e) {
        logApi.error("[API /token-data-pipeline] Error getting TokenActivationService status:", e);
        fullReport.tokenActivationService = { status: "error_fetching", error: e.message };
      }
    } else {
      logApi.warn("[API /token-data-pipeline] TokenActivationService or its getServiceStatus is not available.");
    }

    // 4. TokenPriceWebSocketService Stats
    if (tokenPriceWs && typeof tokenPriceWs.getStats === 'function') {
      try {
        fullReport.tokenPriceWebSocketService = tokenPriceWs.getStats();
      } catch (e) {
        logApi.error("[API /token-data-pipeline] Error getting TokenPriceWs stats:", e);
        fullReport.tokenPriceWebSocketService = { status: "error_fetching", error: e.message };
      }
    } else {
      logApi.warn("[API /token-data-pipeline] TokenPriceWs or its getStats is not available.");
    }

    res.json(fullReport);

  } catch (error) {
    logApi.error("[API /token-data-pipeline] Critical error constructing pipeline status:", { errorMessage: error.message, stack: error.stack });
    res.status(500).json({ 
        error: "Failed to retrieve complete token data pipeline status.",
        details: error.message 
    });
  }
});

export default router;
