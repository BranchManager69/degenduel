// /routes/admin/system-settings.js

import express from "express";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { logApi } from "../../utils/logger-suite/logger.js";
import crypto from 'crypto';

const router = express.Router();

/**
 * @swagger
 * /api/admin/system-settings:
 *   get:
 *     summary: Get all system settings
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: All system settings
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

  logApi.info("Fetching all system settings", {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    const settings = await prisma.system_settings.findMany();

    logApi.info("Successfully fetched all system settings", {
      requestId,
      count: settings.length,
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
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/system-settings/{key}:
 *   get:
 *     summary: Get system setting by key
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The system setting key
 *     responses:
 *       200:
 *         description: System setting
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Setting not found
 *       500:
 *         description: Server error
 */
router.get("/:key", requireAuth, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  logApi.info(`Fetching system setting: ${key}`, {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    const setting = await prisma.system_settings.findUnique({
      where: { key },
    });

    if (!setting) {
      logApi.warn(`System setting not found: ${key}`, {
        requestId,
        admin_address: req.user.wallet_address,
      });
      return res.status(404).json({
        error: "System setting not found",
      });
    }

    logApi.info(`Successfully fetched system setting: ${key}`, {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json(setting);
  } catch (error) {
    logApi.error(`Failed to fetch system setting: ${key}`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to get system setting",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/system-settings/{key}:
 *   post:
 *     summary: Create or update system setting
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The system setting key
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: object
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: System setting updated successfully
 *       400:
 *         description: Invalid request body
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
router.post("/:key", requireAuth, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const { value, description } = req.body;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  // Validate input
  if (!value) {
    return res.status(400).json({
      error: "value is required",
    });
  }

  logApi.info(`Updating system setting: ${key}`, {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    const timestamp = new Date();
    const updatedSetting = await prisma.system_settings.upsert({
      where: { key },
      update: {
        value,
        description: description || undefined,
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
      create: {
        key,
        value,
        description: description || `System setting: ${key}`,
        updated_at: timestamp,
        updated_by: req.user.wallet_address,
      },
    });

    // Log the action
    await prisma.admin_logs.create({
      data: {
        admin_address: req.user.wallet_address,
        action: "UPDATE_SYSTEM_SETTING",
        details: {
          key,
          timestamp: timestamp.toISOString(),
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info(`Successfully updated system setting: ${key}`, {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json(updatedSetting);
  } catch (error) {
    logApi.error(`Failed to update system setting: ${key}`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to update system setting",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/system-settings:
 *   post:
 *     summary: Batch create or update system settings
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
 *                   type: object
 *                 description:
 *                   type: string
 *     responses:
 *       200:
 *         description: System settings updated successfully
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
  const settings = Array.isArray(req.body) ? req.body : [req.body];

  // Validate input
  if (!settings.length) {
    return res.status(400).json({
      error: "At least one setting is required",
    });
  }

  for (const setting of settings) {
    if (!setting.key || !setting.value) {
      return res.status(400).json({
        error: "Each setting must have a key and value",
      });
    }
  }

  logApi.info("Batch updating system settings", {
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
            description: setting.description || undefined,
            updated_at: timestamp,
            updated_by: req.user.wallet_address,
          },
          create: {
            key: setting.key,
            value: setting.value,
            description: setting.description || `System setting: ${setting.key}`,
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
        action: "BATCH_UPDATE_SYSTEM_SETTINGS",
        details: {
          keys: settings.map((s) => s.key),
          timestamp: timestamp.toISOString(),
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info("Successfully batch updated system settings", {
      requestId,
      count: results.length,
      duration: Date.now() - startTime,
    });

    return res.json(results);
  } catch (error) {
    logApi.error("Failed to batch update system settings", {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to batch update system settings",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @swagger
 * /api/admin/system-settings/{key}:
 *   delete:
 *     summary: Delete system setting
 *     tags: [Admin]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: The system setting key
 *     responses:
 *       200:
 *         description: System setting deleted successfully
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not authorized
 *       404:
 *         description: Setting not found
 *       500:
 *         description: Server error
 */
router.delete("/:key", requireAuth, requireAdmin, async (req, res) => {
  const { key } = req.params;
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  logApi.info(`Deleting system setting: ${key}`, {
    requestId,
    admin_address: req.user.wallet_address,
  });

  try {
    // Check if setting exists
    const setting = await prisma.system_settings.findUnique({
      where: { key },
    });

    if (!setting) {
      logApi.warn(`System setting not found for deletion: ${key}`, {
        requestId,
        admin_address: req.user.wallet_address,
      });
      return res.status(404).json({
        error: "System setting not found",
      });
    }

    // Delete the setting
    await prisma.system_settings.delete({
      where: { key },
    });

    // Log the action
    await prisma.admin_logs.create({
      data: {
        admin_address: req.user.wallet_address,
        action: "DELETE_SYSTEM_SETTING",
        details: {
          key,
          timestamp: new Date().toISOString(),
        },
        ip_address: req.ip,
        user_agent: req.get("user-agent"),
      },
    });

    logApi.info(`Successfully deleted system setting: ${key}`, {
      requestId,
      duration: Date.now() - startTime,
    });

    return res.json({
      success: true,
      message: `System setting ${key} deleted successfully`,
    });
  } catch (error) {
    logApi.error(`Failed to delete system setting: ${key}`, {
      requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      duration: Date.now() - startTime,
    });

    return res.status(500).json({
      error: "Failed to delete system setting",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;