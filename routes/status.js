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

export default router;
