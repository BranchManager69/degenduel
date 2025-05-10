// /routes/admin/maintenance.js

import express from "express";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { logApi } from "../../utils/logger-suite/logger.js";
import serviceEvents, { SERVICE_EVENTS } from "../../utils/service-suite/service-events.js";

const VERBOSE_MAINTENANCE = false;

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
  const adminName = req.user.nickname || req.user.username || 'Admin';

  if (VERBOSE_MAINTENANCE) {
    logApi.info(`🔧 ${fancyColors.BLUE}Maintenance Mode check by admin${fancyColors.RESET} \n\t${fancyColors.BLUE}${fancyColors.BOLD}${adminName}${fancyColors.RESET}`);
  }

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

    if (VERBOSE_MAINTENANCE) {
      logApi.info(`✅ \t${fancyColors.GREEN}Maintenance status fetched by${fancyColors.RESET} ${fancyColors.BLUE}${fancyColors.BOLD}${adminName}${fancyColors.RESET} \n\t${fancyColors.BLUE}${Date.now() - startTime}ms${fancyColors.RESET}`);
    }

    return res.json(setting.value);
  } catch (error) {
    logApi.error(`❌ Maintenance check failed: ${error.message}`, {
      error: error instanceof Error ? {
        name: error.name,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      } : error
    });

    return res.status(500).json({
      error: "Failed to get maintenance status",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
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
 *                 description: |
 *                   Duration in seconds before retry.
 *                   Default: 300
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
  const startTime = Date.now();
  const { enabled, duration = 300 } = req.body;
  const adminName = req.user.nickname || req.user.username || 'Admin';

  logApi.info(`🔧 Maintenance mode ${enabled ? 'enabled' : 'disabled'} by ${adminName}`);

  // Validate input
  if (typeof enabled !== "boolean") {
    logApi.warn(`⚠️ Invalid maintenance request by ${adminName}`, {
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
      duration,
      // Keep track of last enabled/disabled times - might be useful?
      // Note: This logic slightly differs from original; ensures only relevant timestamp is updated
      ...(enabled ? { last_enabled: timestamp } : { last_disabled: timestamp }), 
      updated_by: req.user.wallet_address,
    };

    // Fetch the previous value to include in the event if needed
    const previousSetting = await prisma.system_settings.findUnique({
      where: { key: "maintenance_mode" },
      select: { value: true }
    });

    // Update or create the maintenance mode setting
    const updatedSetting = await prisma.system_settings.upsert({
      where: { key: "maintenance_mode" },
      update: {
        value: { // Ensure we update only the fields within the JSON value
          ...previousSetting?.value, // Preserve existing fields
          ...value // Overwrite with new values
        },
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
      create: {
        key: "maintenance_mode",
        value: value, // Use the full value object for creation
        description: "Controls system-wide maintenance mode",
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
    });

    // --- Emit the event after successful update --- 
    serviceEvents.emit(SERVICE_EVENTS.MAINTENANCE_MODE_UPDATED, { enabled });
    logApi.info(`📢 Emitted ${SERVICE_EVENTS.MAINTENANCE_MODE_UPDATED} event: enabled=${enabled}`);
    // ---------------------------------------------

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

    logApi.info(`✅ Maintenance mode updated (${Date.now() - startTime}ms)`);

    // Return the updated setting value from the upsert operation
    return res.json({
      enabled: updatedSetting.value.enabled,
      duration: updatedSetting.value.duration,
      timestamp: updatedSetting.updated_at.toISOString(),
      updated_by: updatedSetting.updated_by,
    });
  } catch (error) {
    logApi.error(`❌ Failed to update maintenance mode: ${error.message}`, {
      error: error instanceof Error ? {
        name: error.name,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      } : error
    });

    return res.status(500).json({
      error: "Failed to set maintenance mode",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
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
