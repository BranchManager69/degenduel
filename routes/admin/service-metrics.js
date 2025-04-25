// /routes/admin/service-metrics.js

import express from "express";
import v8 from "v8";
import { exec } from "child_process";
import prisma from "../../config/prisma.js";
import { requireAdmin, requireAuth, requireSuperAdmin } from "../../middleware/auth.js";
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

// Get latest RPC benchmark results
router.get(
  "/rpc-benchmarks/latest",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      // Get the latest test run ID
      const latestRun = await prisma.rpc_benchmark_results.findFirst({
        orderBy: {
          timestamp: 'desc'
        },
        select: {
          test_run_id: true,
          timestamp: true
        }
      });
      
      if (!latestRun) {
        return res.status(404).json({
          success: false,
          message: 'No benchmark data found'
        });
      }
      
      // Get all results from the latest run
      const results = await prisma.rpc_benchmark_results.findMany({
        where: {
          test_run_id: latestRun.test_run_id
        },
        orderBy: [
          { method: 'asc' },
          { median_latency: 'asc' }
        ]
      });
      
      // Group by method
      const methodResults = {};
      for (const result of results) {
        if (!methodResults[result.method]) {
          methodResults[result.method] = [];
        }
        methodResults[result.method].push(result);
      }
      
      // Format results
      const formattedResults = {};
      const methods = Object.keys(methodResults);
      
      // Get provider rankings for each method
      for (const method of methods) {
        formattedResults[method] = {
          providers: methodResults[method].map(result => ({
            provider: result.provider,
            median_latency: result.median_latency,
            avg_latency: result.avg_latency,
            min_latency: result.min_latency,
            max_latency: result.max_latency,
            success_count: result.success_count,
            failure_count: result.failure_count
          }))
        };
        
        // Add percentage comparisons
        if (formattedResults[method].providers.length > 1) {
          const fastestLatency = formattedResults[method].providers[0].median_latency;
          
          for (let i = 1; i < formattedResults[method].providers.length; i++) {
            const provider = formattedResults[method].providers[i];
            const percentSlower = ((provider.median_latency - fastestLatency) / fastestLatency) * 100;
            provider.percent_slower = percentSlower;
          }
        }
      }
      
      // Get fastest provider overall
      let overallFastestProvider = null;
      const providerWins = {};
      
      for (const method of methods) {
        const fastestProvider = methodResults[method][0].provider;
        providerWins[fastestProvider] = (providerWins[fastestProvider] || 0) + 1;
      }
      
      let maxWins = 0;
      for (const [provider, wins] of Object.entries(providerWins)) {
        if (wins > maxWins) {
          maxWins = wins;
          overallFastestProvider = provider;
        }
      }
      
      // Construct performance advantage summary
      const performanceAdvantage = [];
      
      if (overallFastestProvider) {
        for (const method of methods) {
          const results = methodResults[method];
          const providers = results.map(r => r.provider);
          
          if (providers[0] === overallFastestProvider && providers.length > 1) {
            const bestLatency = results[0].median_latency;
            const secondLatency = results[1].median_latency;
            const improvementVsSecond = ((secondLatency - bestLatency) / bestLatency) * 100;
            
            let thirdPlaceAdvantage = null;
            if (providers.length >= 3) {
              const thirdLatency = results[2].median_latency;
              const improvementVsThird = ((thirdLatency - bestLatency) / bestLatency) * 100;
              thirdPlaceAdvantage = improvementVsThird;
            }
            
            performanceAdvantage.push({
              method,
              vs_second_place: improvementVsSecond,
              vs_third_place: thirdPlaceAdvantage,
              second_place_provider: providers[1],
              third_place_provider: providers.length >= 3 ? providers[2] : null
            });
          }
        }
      }
      
      // Return the results
      return res.json({
        success: true,
        test_run_id: latestRun.test_run_id,
        timestamp: latestRun.timestamp,
        methods: formattedResults,
        overall_fastest_provider: overallFastestProvider,
        performance_advantage: performanceAdvantage
      });
    } catch (error) {
      metricsLogger.error('Error getting RPC benchmark results:', { error });
      
      return res.status(500).json({
        success: false,
        message: 'Error retrieving RPC benchmark results',
        error: error.message
      });
    }
  }
);

// Trigger a new RPC benchmark test
router.post(
  "/rpc-benchmarks/trigger",
  requireAuth,
  requireSuperAdmin,
  async (req, res) => {
    try {
      // Trigger a benchmark test (this will run asynchronously)
      exec('cd /home/websites/degenduel && npm run benchmark:run-and-import', (error, stdout, stderr) => {
        if (error) {
          metricsLogger.error(`Error running benchmark: ${error.message}`);
          return;
        }
        if (stderr) {
          metricsLogger.warn(`Benchmark stderr: ${stderr}`);
        }
        metricsLogger.info(`Benchmark triggered successfully: ${stdout}`);
      });
      
      return res.json({
        success: true,
        message: 'RPC benchmark test triggered successfully. Results will be available shortly.'
      });
    } catch (error) {
      metricsLogger.error('Error triggering RPC benchmark:', { error });
      
      return res.status(500).json({
        success: false,
        message: 'Error triggering RPC benchmark',
        error: error.message
      });
    }
  }
);

export default router;
