// /routes/platform.js

import express from "express";
import { logApi } from "../utils/logger-suite/logger.js";

const router = express.Router();

/**
 * @route GET /api/platform
 * @description Platform landing page
 * @access Public
 */
router.get("/", async (req, res) => {
  try {
    // Return platform data
    return res.json({
      name: "DegenDuel Platform",
      status: "online",
      features: [
        "Trading",
        "Contests",
        "Portfolio Analytics"
      ],
      version: "1.0.0"
    });
  } catch (error) {
    logApi.error("Failed to get platform information", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(500).json({ error: "Failed to get platform information" });
  }
});

/**
 * @route GET /api/platform/websocket-guide
 * @description Redirect to WebSocket API Guide
 * @access Public
 */
router.get("/websocket-guide", async (req, res) => {
  return res.redirect('/api/websocket-guide');
});

export default router;