// /routes/status.js

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

export default router;
