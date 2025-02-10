// /routes/status.js

import express from "express";
import prisma from "../config/prisma.js";

const router = express.Router();

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

    if (setting?.value?.enabled) {
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
        const data = JSON.parse(record.value);
        return {
          name: data.service_name,
          status: data.status,
        };
      })
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
    // If we can't check maintenance status, assume system is not operational
    return res.status(503).json({
      maintenance: true,
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
    logApi.error("Failed to get public maintenance status", { error });
    res.status(500).json({ error: "Failed to get maintenance status" });
  }
});

export default router;
