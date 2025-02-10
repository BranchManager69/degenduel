// /routes/admin/service-metrics.js

import express from "express";
import v8 from "v8";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth } from "../../middleware/auth.js";
import { logApi } from "../../utils/logger-suite/logger.js";

const router = express.Router();
const metricsLogger = logApi.forService("METRICS");

// Get service analytics
router.get(
  "/service-analytics",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      // Get service health from system_settings
      const serviceHealthRecords = await prisma.system_settings.findMany({
        where: {
          key: "service_health",
          updated_at: {
            gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
          },
        },
      });

      // Transform records into service analytics
      const services = serviceHealthRecords.map((record) => {
        const data = JSON.parse(record.value);
        return {
          name: data.service_name,
          status: data.status,
          lastCheck: new Date(data.last_check).getTime(),
          failureRate: data.failure_rate || 0,
        };
      });

      res.json({ services });
    } catch (error) {
      metricsLogger.error("Failed to get service analytics", { error });
      res.status(500).json({ error: "Failed to get service analytics" });
    }
  }
);

// Get performance metrics
router.get("/performance", requireAuth, requireAdmin, async (req, res) => {
  try {
    // Get performance data from system_settings
    const performanceData = await prisma.system_settings.findFirst({
      where: {
        key: "performance_metrics",
      },
    });

    if (!performanceData) {
      // Return default metrics if no data exists
      return res.json({
        total_requests: 0,
        avg_response_time: 0,
        max_response_time: 0,
        routes: {},
      });
    }

    const metrics = JSON.parse(performanceData.value);
    res.json(metrics);
  } catch (error) {
    metricsLogger.error("Failed to get performance metrics", { error });
    res.status(500).json({ error: "Failed to get performance metrics" });
  }
});

// Get memory stats
router.get("/memory", requireAuth, requireAdmin, async (req, res) => {
  try {
    const heapStats = v8.getHeapStatistics();
    const memoryUsage = process.memoryUsage();

    const stats = {
      heap_used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(heapStats.total_heap_size / 1024 / 1024),
      rss_mb: Math.round(memoryUsage.rss / 1024 / 1024),
      external_mb: Math.round(memoryUsage.external / 1024 / 1024),
      array_buffers_mb: Math.round(memoryUsage.arrayBuffers / 1024 / 1024),
      uptime_hours: process.uptime() / 3600,
    };

    res.json(stats);
  } catch (error) {
    metricsLogger.error("Failed to get memory stats", { error });
    res.status(500).json({ error: "Failed to get memory stats" });
  }
});

// Get service capacities
router.get(
  "/service-capacities",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const capacitySettings = await prisma.system_settings.findFirst({
        where: {
          key: "service_capacities",
        },
      });

      if (!capacitySettings) {
        // Initialize default capacities in database if not exists
        const defaultCapacities = {
          "dd-serv": 300,
          contests: 200,
          users: 150,
          stats: 100,
        };

        await prisma.system_settings.create({
          data: {
            key: "service_capacities",
            value: JSON.stringify(defaultCapacities),
            updated_at: new Date(),
          },
        });

        return res.json(defaultCapacities);
      }

      res.json(JSON.parse(capacitySettings.value));
    } catch (error) {
      metricsLogger.error("Failed to get service capacities", { error });
      res.status(500).json({ error: "Failed to get service capacities" });
    }
  }
);

// Update service capacity
router.put(
  "/service-capacities",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const { service, capacity } = req.body;

      if (!service || typeof capacity !== "number" || capacity < 1) {
        return res.status(400).json({ error: "Invalid service or capacity" });
      }

      // Get current capacities
      const currentSettings = await prisma.system_settings.findFirst({
        where: {
          key: "service_capacities",
        },
      });

      const capacities = currentSettings
        ? JSON.parse(currentSettings.value)
        : {};
      capacities[service] = capacity;

      // Update or create the settings
      await prisma.system_settings.upsert({
        where: {
          key: "service_capacities",
        },
        update: {
          value: JSON.stringify(capacities),
          updated_at: new Date(),
        },
        create: {
          key: "service_capacities",
          value: JSON.stringify(capacities),
          updated_at: new Date(),
        },
      });

      metricsLogger.info("Service capacity updated in database", {
        service,
        capacity,
      });
      res.json({ success: true, capacities });
    } catch (error) {
      metricsLogger.error("Failed to update service capacity", { error });
      res.status(500).json({ error: "Failed to update service capacity" });
    }
  }
);

export default router;
