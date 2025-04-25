// /routes/websocket-api-guide.js

import express from "express";
import { logApi } from "../utils/logger-suite/logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

/**
 * @route GET /api/websocket-guide
 * @description WebSocket API Guide and interactive demo
 * @access Public
 */
router.get("/", async (req, res) => {
  try {
    // Get the path to the JSX file
    const jsxFilePath = path.resolve(__dirname, "../_WEBSOCKET_API_GUIDE.jsx");
    
    // Read the JSX file content
    const jsxContent = fs.readFileSync(jsxFilePath, "utf-8");
    
    // Extract the WebSocketAPIGuide component content
    const componentMatch = jsxContent.match(/const WebSocketAPIGuide = \(\) => \{[\s\S]*return \(([\s\S]*?)\);[\s\S]*?\};/);
    
    // Extract the styles from the JSX
    const stylesMatch = jsxContent.match(/<style jsx>\{`([\s\S]*?)`\}<\/style>/);
    
    // Create HTML wrapper
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DegenDuel WebSocket API Guide</title>
    <style>
        ${stylesMatch ? stylesMatch[1] : ''}
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .header {
            background-color: #2c3e50;
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .header h1 {
            margin: 0;
        }
        .header p {
            margin: 10px 0 0;
            opacity: 0.8;
        }
        .navigation {
            margin-bottom: 20px;
        }
        .navigation a {
            display: inline-block;
            margin-right: 10px;
            padding: 8px 16px;
            background-color: #3498db;
            color: white;
            text-decoration: none;
            border-radius: 4px;
            transition: background-color 0.2s;
        }
        .navigation a:hover {
            background-color: #2980b9;
        }
        pre {
            background-color: #f0f0f0;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: Consolas, Monaco, 'Andale Mono', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>DegenDuel WebSocket API Guide</h1>
            <p>Comprehensive documentation for the WebSocket API</p>
        </div>
        
        <div class="navigation">
            <a href="/">Home</a>
            <a href="/api-docs">API Docs</a>
            <a href="/api/admin/websocket-test">WebSocket Tests</a>
            <a href="/api/websocket-guide">Interactive Demo</a>
            <a href="/api/websocket-guide/json">API JSON</a>
        </div>
        
        <div class="content">
            <h2>WebSocket API Documentation</h2>
            
            <h3>Connection Information</h3>
            <p><strong>Endpoint:</strong> /api/v69/ws</p>
            <p>This WebSocket API provides real-time data from the DegenDuel platform through a unified WebSocket implementation with topic-based subscriptions.</p>
            
            <h3>Available Topics</h3>
            <ul>
                <li><strong>market-data</strong> - Real-time market data including token prices and stats</li>
                <li><strong>portfolio</strong> - User's portfolio updates and performance</li>
                <li><strong>system</strong> - System status, announcements and heartbeats</li>
                <li><strong>contest</strong> - Contest updates, entries and results</li>
                <li><strong>user</strong> - User-specific notifications and data</li>
                <li><strong>admin</strong> - Administrative information</li>
                <li><strong>wallet</strong> - Wallet updates and transaction information</li>
                <li><strong>wallet-balance</strong> - Real-time balance updates</li>
                <li><strong>skyduel</strong> - Game-specific information</li>
                <li><strong>terminal</strong> - Terminal data for command-line interface</li>
            </ul>
            
            <h3>Message Structure</h3>
            <pre><code>{
  type: 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'DATA' | 'ERROR' | 'SYSTEM' | 'ACKNOWLEDGMENT' | 'COMMAND' | 'REQUEST',
  topic?: string,
  subtype?: string,
  action?: string,
  data?: any,
  requestId?: string,
  timestamp: string
}</code></pre>

            <h3>Server-Side Broadcasting Approaches</h3>
            <p>For DegenDuel developers, we support two complementary approaches for sending WebSocket messages:</p>
            
            <h4>1. Service Events (For Service-to-WebSocket Communication)</h4>
            <pre><code>import serviceEvents from '../utils/service-suite/service-events.js';

// Broadcasting through the service events system
serviceEvents.emit('topic:broadcast', {
  type: 'DATA',
  subtype: 'category',
  action: 'action',
  data: payload
});</code></pre>
            <p><strong>When to use:</strong> For service broadcasts, simple topic-based messages, loose coupling, and non-persistent messages.</p>
            
            <h4>2. WSBroadcaster (For Advanced Features)</h4>
            <pre><code>import broadcaster from '../utils/websocket-suite/ws-broadcaster.js';

// Broadcasting with the dedicated utility
await broadcaster.broadcastToTopic(
  'topic',
  'category',
  'action',
  payload
);

// Or target specific roles/users
await broadcaster.broadcastToRole('ADMIN', 'category', 'action', payload);
await broadcaster.broadcastToUsers(['wallet1'], 'category', 'action', payload, 
  { persist: true });</code></pre>
            <p><strong>When to use:</strong> For message persistence, role-based targeting, delivery tracking, and database storage.</p>
            
            <p>For the full documentation and interactive examples, please check our WebSocket React component.</p>
            
            <h3>Documentation Resources</h3>
            <p>The full API documentation is available in our Markdown guide: <a href="/_WEBSOCKET_API_GUIDE.md">WebSocket API Guide</a></p>
            
            <h3>Client Library Usage</h3>
            <p>We provide a JavaScript client library to simplify WebSocket integration:</p>
            <pre><code>// Include the client library
&lt;script src="/ws-client-wrapper.js"&gt;&lt;/script&gt;

// Create a WebSocket client
const client = new DegenDuelWS({
  url: '/api/v69/ws',
  debug: true,
  autoConnect: true,
  onOpen: () => console.log('Connected!'),
  onMessage: (msg) => console.log('Message:', msg)
});

// Subscribe to topics
client.subscribe(['market-data', 'system'])
  .then(() => console.log('Subscribed!'));

// Send a request
client.request('market-data', 'getAllTokens')
  .then(response => console.log('Got tokens:', response));</code></pre>
        </div>
    </div>
</body>
</html>
    `;
    
    // Send the HTML response
    res.setHeader("Content-Type", "text/html");
    res.send(html);
    
  } catch (error) {
    logApi.error("Failed to serve WebSocket API Guide", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(500).json({ error: "Failed to serve WebSocket API Guide" });
  }
});

/**
 * @route GET /api/websocket-guide/json
 * @description Get WebSocket API documentation as JSON
 * @access Public
 */
router.get("/json", async (req, res) => {
  try {
    // Return WebSocket API documentation as JSON
    return res.json({
      name: "DegenDuel WebSocket API",
      version: "1.0.0",
      endpoint: "/api/v69/ws",
      topics: [
        {
          name: "market-data",
          description: "Real-time market data including token prices and stats",
          authRequired: false,
          events: ["token.update", "market.update", "volume.update"]
        },
        {
          name: "portfolio",
          description: "User's portfolio updates and performance",
          authRequired: true,
          events: ["portfolio.update", "trade.executed", "balance.change"]
        },
        {
          name: "system",
          description: "System status, announcements and heartbeats",
          authRequired: false,
          events: ["system.status", "maintenance.alert", "heartbeat"]
        },
        {
          name: "contest",
          description: "Contest updates, entries and results",
          authRequired: "partial",
          events: ["contest.created", "contest.updated", "leaderboard.updated"]
        },
        {
          name: "user",
          description: "User-specific notifications and data",
          authRequired: true,
          events: ["notification.new", "profile.updated", "achievement.unlocked"]
        },
        {
          name: "admin",
          description: "Administrative information",
          authRequired: true,
          adminRole: true,
          events: ["admin.alert", "system.error", "user.flagged"]
        },
        {
          name: "wallet",
          description: "Wallet updates and transaction information",
          authRequired: true,
          events: ["transaction.initiated", "transaction.confirmed", "transaction.failed"]
        },
        {
          name: "wallet-balance",
          description: "Real-time balance updates",
          authRequired: true,
          events: ["balance.updated", "token.received", "token.sent"]
        },
        {
          name: "skyduel",
          description: "Game-specific information",
          authRequired: "partial",
          events: ["game.created", "game.updated", "game.ended"]
        },
        {
          name: "terminal",
          description: "Terminal data for command-line interface",
          authRequired: false,
          events: ["terminal.update", "command.response", "platform.stats"]
        }
      ],
      messageTypes: [
        "SUBSCRIBE", "UNSUBSCRIBE", "DATA", "ERROR", "SYSTEM", "ACKNOWLEDGMENT", "COMMAND", "REQUEST"
      ],
      authentication: {
        methods: ["cookie", "token", "biometric"],
        restrictedTopics: ["portfolio", "user", "admin", "wallet", "wallet-balance"]
      }
    });
  } catch (error) {
    logApi.error("Failed to get WebSocket API documentation", {
      error: {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(500).json({ error: "Failed to get WebSocket API documentation" });
  }
});

export default router;