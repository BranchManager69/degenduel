// /routes/admin/countdown.js

import express from "express";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { logApi } from "../../utils/logger-suite/logger.js";

const router = express.Router();

/**
 * @swagger
 * /api/admin/countdown:
 *   get:
 *     summary: Get countdown mode status
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Current countdown mode status
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
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const adminName = req.user.nickname || req.user.username || 'Admin';

  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key: "countdown_mode" },
    });

    // If no setting exists, countdown mode is disabled by default
    if (!setting) {
      return res.json({
        enabled: false,
        end_time: null,
        title: "Coming Soon",
        message: "Our platform is launching soon.",
        redirect_url: null
      });
    }

    logApi.info(`Countdown status fetched by ${adminName} (${Date.now() - startTime}ms)`);

    return res.json(setting.value);
  } catch (error) {
    logApi.error(`❌ Countdown check failed: ${error.message}`, {
      error: error instanceof Error ? {
        name: error.name,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      } : error
    });

    return res.status(500).json({
      error: "Failed to get countdown status",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/countdown:
 *   post:
 *     summary: Set countdown mode status
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               title:
 *                 type: string
 *               message:
 *                 type: string
 *               redirect_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Countdown mode updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 updated_by:
 *                   type: string
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const { enabled, end_time, title, message, redirect_url } = req.body;
  const adminName = req.user.nickname || req.user.username || 'Admin';

  logApi.info(`🚀 Countdown mode ${enabled ? 'enabled' : 'disabled'} by ${adminName}`);

  // Validate input
  if (typeof enabled !== "boolean") {
    logApi.warn(`⚠️ Invalid countdown request by ${adminName}`, {
      received_value: enabled
    });
    return res.status(400).json({
      error: "enabled must be a boolean",
    });
  }

  try {
    const timestamp = new Date();
    const value = {
      enabled,
      end_time: end_time || null,
      title: title || "Coming Soon",
      message: message || "Our platform is launching soon.",
      redirect_url: redirect_url || null,
      updated_by: req.user.wallet_address,
    };

    // Update or create the countdown mode setting
    await prisma.system_settings.upsert({
      where: { key: "countdown_mode" },
      update: {
        value,
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
      create: {
        key: "countdown_mode",
        value,
        description: "Controls site-wide countdown mode",
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
    });

    // Log the action with more details
    await prisma.admin_logs.create({
      data: {
        admin_address: req.user.wallet_address,
        action: enabled ? "ENABLE_COUNTDOWN" : "DISABLE_COUNTDOWN",
        details: {
          timestamp: timestamp.toISOString(),
          enabled,
          end_time,
          title,
          message
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info(`✅ Countdown mode updated (${Date.now() - startTime}ms)`);

    return res.json({
      enabled,
      end_time,
      title,
      message,
      redirect_url,
      timestamp: timestamp.toISOString(),
      updated_by: req.user.wallet_address,
    });
  } catch (error) {
    logApi.error(`❌ Failed to update countdown mode: ${error.message}`, {
      error: error instanceof Error ? {
        name: error.name,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      } : error
    });

    return res.status(500).json({
      error: "Failed to set countdown mode",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;