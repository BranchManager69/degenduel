// /routes/admin/maintenance.js

import express from "express";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { logApi } from "../../utils/logger-suite/logger.js";

const router = express.Router();

/**
 * @swagger
 * /api/admin/maintenance:
 *   get:
 *     summary: Get maintenance mode status
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Current maintenance mode status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *                 last_enabled:
 *                   type: string
 *                   format: date-time
 *                 last_disabled:
 *                   type: string
 *                   format: date-time
 *                 updated_by:
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

  logApi.info("Fetching maintenance mode status", {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key: "maintenance_mode" },
    });

    // If no setting exists, maintenance mode is disabled by default
    if (!setting) {
      return res.json({
        enabled: false,
        last_enabled: null,
        last_disabled: null,
        updated_by: null,
      });
    }

    logApi.info("Successfully fetched maintenance mode status", {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json(setting.value);
  } catch (error) {
    logApi.error("Failed to fetch maintenance mode status", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to get maintenance status",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/maintenance:
 *   post:
 *     summary: Set maintenance mode status
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
 *               duration:
 *                 type: number
 *                 description: Duration in seconds before retry (default: 300)
 *     responses:
 *       200:
 *         description: Maintenance mode updated successfully
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
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const { enabled, duration = 300 } = req.body;

  logApi.info("Attempting to update maintenance mode", {
    requestId,
    admin_address: req.user.wallet_address,
    enabled,
    duration,
  });

  // Validate input
  if (typeof enabled !== "boolean") {
    logApi.warn("Invalid maintenance mode update request", {
      requestId,
      admin_address: req.user.wallet_address,
      received_value: enabled,
    });
    return res.status(400).json({
      error: "enabled must be a boolean",
    });
  }

  try {
    const timestamp = new Date();
    const value = {
      enabled,
      duration,
      last_enabled: enabled ? timestamp : null,
      last_disabled: !enabled ? timestamp : null,
      updated_by: req.user.wallet_address,
    };

    // Update or create the maintenance mode setting
    await prisma.system_settings.upsert({
      where: { key: "maintenance_mode" },
      update: {
        value,
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
      create: {
        key: "maintenance_mode",
        value,
        description: "Controls system-wide maintenance mode",
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
    });

    // Log the action with more details
    await prisma.admin_logs.create({
      data: {
        admin_address: req.user.wallet_address,
        action: enabled ? "ENABLE_MAINTENANCE" : "DISABLE_MAINTENANCE",
        details: {
          timestamp: timestamp.toISOString(),
          enabled,
          duration,
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info("Successfully updated maintenance mode", {
      requestId,
      admin_address: req.user.wallet_address,
      enabled,
      duration,
      duration: Date.now() - startTime,
    });

    return res.json({
      enabled,
      duration,
      timestamp: timestamp.toISOString(),
      updated_by: req.user.wallet_address,
    });
  } catch (error) {
    logApi.error("Failed to update maintenance mode", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      admin_address: req.user.wallet_address,
      enabled,
      duration,
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to set maintenance mode",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/maintenance/settings:
 *   get:
 *     summary: Get system settings
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Current system settings
 */
router.get("/settings", requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  logApi.info("Fetching system settings", {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    const settings = await prisma.system_settings.findMany({
      where: {
        OR: [
          { key: "maintenance_mode" },
          { key: "maintenance_start_time" },
          { key: "maintenance_estimated_duration" },
        ],
      },
    });

    logApi.info("Successfully fetched system settings", {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json(settings);
  } catch (error) {
    logApi.error("Failed to fetch system settings", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to get system settings",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/maintenance/settings:
 *   post:
 *     summary: Update system settings
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required:
 *                 - key
 *                 - value
 *               properties:
 *                 key:
 *                   type: string
 *                 value:
 *                   type: string
 *                 description:
 *                   type: string
 */
router.post("/settings", requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const settings = Array.isArray(req.body) ? req.body : [req.body];

  logApi.info("Updating system settings", {
    requestId,
    admin_address: req.user.wallet_address,
    settings: settings.map((s) => s.key),
  });

  try {
    const timestamp = new Date();
    const results = await Promise.all(
      settings.map((setting) =>
        prisma.system_settings.upsert({
          where: { key: setting.key },
          update: {
            value: setting.value,
            updated_at: timestamp,
            updated_by: req.user.wallet_address,
          },
          create: {
            key: setting.key,
            value: setting.value,
            description:
              setting.description || `System setting: ${setting.key}`,
            updated_at: timestamp,
            updated_by: req.user.wallet_address,
          },
        })
      )
    );

    // Log the action
    await prisma.admin_logs.create({
      data: {
        admin_address: req.user.wallet_address,
        action: "UPDATE_SYSTEM_SETTINGS",
        details: {
          timestamp: timestamp.toISOString(),
          settings: settings.map((s) => s.key),
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info("Successfully updated system settings", {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json(results);
  } catch (error) {
    logApi.error("Failed to update system settings", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to update system settings",
      message:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/maintenance/status:
 *   get:
 *     summary: Get maintenance mode status (lightweight)
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Current maintenance mode enabled state
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 enabled:
 *                   type: boolean
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.get("/status", requireAuth, requireAdmin, async (req, res) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key: "maintenance_mode" },
      select: { value: true }, // Only select the value field for efficiency
    });

    // If no setting exists, maintenance mode is disabled by default
    const enabled = setting ? setting.value.enabled : false;

    logApi.debug("Maintenance status check", {
      requestId,
      enabled,
      duration: Date.now() - startTime,
      admin_address: req.user.wallet_address,
    });

    return res.json({ enabled });
  } catch (error) {
    logApi.error("Failed to check maintenance status", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
      admin_address: req.user.wallet_address,
    });

    return res.status(500).json({
      error: "Failed to check maintenance status",
    });
  }
});

export default router;
