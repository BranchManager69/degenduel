/**
 * AI WebSocket Transition Example
 * 
 * This example demonstrates how to migrate from terminal-data-ws.js
 * to the new unified WebSocket system with the 'ai' topic.
 */

import express from 'express';
import http from 'http';
import { UnifiedWebSocketServer } from '../unified/index.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import serviceEvents from '../../../utils/service-suite/service-events.js';
import config from '../../../config/config.js';

// Import AI service handlers
import aiService from '../../../services/ai-service/ai-service.js';

class AIWsTransitionExample {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Create the unified WebSocket server
    this.unifiedWs = new UnifiedWebSocketServer(this.server, {
      maxPayload: 5 * 1024 * 1024, // 5MB
    });
    
    // Set up HTTP routes
    this.setupRoutes();
    
    // Handle WebSocket upgrades
    this.setupWebSocketHandler();
    
    // Register AI-specific message handlers
    this.registerAIHandlers();
  }
  
  /**
   * Set up HTTP routes
   */
  setupRoutes() {
    this.app.get('/', (req, res) => {
      res.send('AI WebSocket Transition Example');
    });
    
    // AI response endpoint
    this.app.post('/api/ai/response', express.json(), async (req, res) => {
      try {
        const { messages, conversationId, context } = req.body;
        
        // Get AI response
        const response = await aiService.generateTokenAIResponse(messages, {
          conversationId,
          context: context || 'terminal'
        });
        
        // Strip usage property before returning
        const { usage, ...result } = response;
        
        res.json(result);
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error generating AI response:${fancyColors.RESET}`, error);
        res.status(500).json({ error: 'Error generating AI response' });
      }
    });
    
    // AI streaming endpoint
    this.app.post('/api/ai/stream', express.json(), async (req, res) => {
      try {
        const { messages, conversationId, context } = req.body;
        
        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Get streaming response
        const { stream } = await aiService.generateAIResponse(messages, {
          conversationId,
          context: context || 'terminal'
        });
        
        // Pipe stream to response
        stream.on('data', (chunk) => {
          // Filter out usage data
          try {
            const data = JSON.parse(chunk.toString().replace(/^data: /, ''));
            if (data.choices && data.choices[0] && data.choices[0].delta) {
              const content = data.choices[0].delta.content || '';
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            res.write(`data: ${chunk.toString()}\n\n`);
          }
        });
        
        // Handle end of stream
        stream.on('end', () => {
          res.write(`data: ${JSON.stringify({ isComplete: true })}\n\n`);
          res.end();
        });
        
        // Handle errors
        stream.on('error', (error) => {
          logApi.error(`${fancyColors.RED}Streaming error:${fancyColors.RESET}`, error);
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        });
        
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error setting up AI stream:${fancyColors.RESET}`, error);
        res.status(500).json({ error: 'Error setting up AI stream' });
      }
    });
    
    // Token data endpoint
    this.app.get('/api/ai/data/:addressOrSymbol', async (req, res) => {
      try {
        const { addressOrSymbol } = req.params;
        
        // Import handler
        const { handleFunctionCall } = await import('../../../services/ai-service/utils/terminal-function-handler.js');
        
        // Create function call
        const functionCall = {
          function: {
            name: 'getTokenPrice',
            arguments: { tokenAddressOrSymbol: addressOrSymbol }
          }
        };
        
        // Get token data
        const tokenData = await handleFunctionCall(functionCall);
        
        if (tokenData.error) {
          return res.status(404).json({
            error: 'Token not found',
            details: tokenData.error
          });
        }
        
        res.json(tokenData);
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error fetching token data:${fancyColors.RESET}`, error);
        res.status(500).json({ error: 'Error fetching token data' });
      }
    });
  }
  
  /**
   * Set up WebSocket handling
   */
  setupWebSocketHandler() {
    this.server.on('upgrade', (req, socket, head) => {
      const { pathname } = new URL(req.url, `http://${req.headers.host}`);
      
      // Let our unified WebSocket server handle the upgrade for v69 endpoint
      if (pathname === '/api/v69/ws') {
        this.unifiedWs.handleUpgrade(req, socket, head);
      } else {
        // Close the connection for any other paths
        socket.destroy();
      }
    });
  }
  
  /**
   * Register AI-specific message handlers
   */
  registerAIHandlers() {
    // Register AI query handler
    this.unifiedWs.registerRequestHandler('ai', 'query', async (client, { data }) => {
      try {
        // Extract data from request
        const { messages, conversationId, context } = data || {};
        
        if (!messages || !Array.isArray(messages)) {
          return {
            error: 'Invalid request: messages array is required',
            type: 'invalid_request'
          };
        }
        
        // Get AI response
        const response = await aiService.generateTokenAIResponse(messages, {
          conversationId,
          context: context || 'terminal',
          userId: client.userId,
          userRole: client.userRole
        });
        
        // Strip usage property before returning
        const { usage, ...result } = response;
        
        return result;
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error handling AI query:${fancyColors.RESET}`, error);
        return {
          error: error.message || 'Error generating AI response',
          type: 'server'
        };
      }
    });
    
    // Register AI streaming handler
    this.unifiedWs.registerRequestHandler('ai', 'stream', async (client, { data, requestId }) => {
      try {
        // Extract data from request
        const { messages, conversationId, context } = data || {};
        
        if (!messages || !Array.isArray(messages)) {
          return {
            error: 'Invalid request: messages array is required',
            type: 'invalid_request'
          };
        }
        
        // Get streaming response
        const { stream } = await aiService.generateAIResponse(messages, {
          conversationId,
          context: context || 'terminal',
          userId: client.userId,
          userRole: client.userRole
        });
        
        // Create accumulated content
        let fullContent = '';
        
        // Handle stream data
        stream.on('data', (chunk) => {
          try {
            const data = JSON.parse(chunk.toString().replace(/^data: /, ''));
            if (data.choices && data.choices[0] && data.choices[0].delta) {
              const content = data.choices[0].delta.content || '';
              fullContent += content;
              
              // Send chunk to client
              this.unifiedWs.sendToClient(client, {
                type: 'DATA',
                topic: 'ai',
                subtype: 'response',
                action: 'stream-chunk',
                requestId,
                data: { content },
                timestamp: new Date().toISOString()
              });
            }
          } catch (e) {
            // Ignore parse errors
          }
        });
        
        // Handle end of stream
        stream.on('end', () => {
          // Send complete message
          this.unifiedWs.sendToClient(client, {
            type: 'DATA',
            topic: 'ai',
            subtype: 'response',
            action: 'stream-complete',
            requestId,
            data: { 
              content: fullContent,
              isComplete: true 
            },
            timestamp: new Date().toISOString()
          });
        });
        
        // Handle errors
        stream.on('error', (error) => {
          logApi.error(`${fancyColors.RED}Streaming error:${fancyColors.RESET}`, error);
          this.unifiedWs.sendToClient(client, {
            type: 'ERROR',
            topic: 'ai',
            requestId,
            error: error.message || 'Error in AI stream',
            timestamp: new Date().toISOString()
          });
        });
        
        // Return streaming started notification
        return {
          streaming: true,
          message: 'AI streaming response started'
        };
      } catch (error) {
        logApi.error(`${fancyColors.RED}Error setting up AI stream:${fancyColors.RESET}`, error);
        return {
          error: error.message || 'Error setting up AI stream',
          type: 'server'
        };
      }
    });
    
    // Listen for service events
    serviceEvents.on('ai:broadcast', (data) => {
      this.unifiedWs.broadcast('ai', {
        type: 'DATA',
        topic: 'ai',
        subtype: 'broadcast',
        data,
        timestamp: new Date().toISOString()
      });
    });
  }
  
  /**
   * Start the server
   */
  start(port = 3000) {
    this.server.listen(port, () => {
      logApi.info(`${fancyColors.GREEN}AI WebSocket transition example running on port ${port}${fancyColors.RESET}`);
      logApi.info(`${fancyColors.GREEN}WebSocket endpoint: ws://localhost:${port}/api/v69/ws${fancyColors.RESET}`);
    });
  }
  
  /**
   * Graceful shutdown
   */
  shutdown() {
    logApi.info(`${fancyColors.YELLOW}Shutting down server...${fancyColors.RESET}`);
    
    // Shutdown WebSocket server gracefully
    this.unifiedWs.shutdown();
    
    // Close HTTP server
    this.server.close(() => {
      logApi.info(`${fancyColors.YELLOW}HTTP server closed${fancyColors.RESET}`);
    });
  }
}

// Client-side transition example (for reference)
const clientExample = `
// ----------------------------------------------------------------------------------
// OLD WAY: Terminal Data WebSocket (dedicated connection)
// ----------------------------------------------------------------------------------
const oldTerminalWs = new WebSocket('wss://api.example.com/api/v69/ws/terminal-data');

oldTerminalWs.onopen = () => {
  console.log('Connected to terminal data WebSocket');
};

oldTerminalWs.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received terminal data:', data);
};

// ----------------------------------------------------------------------------------
// NEW WAY: Unified WebSocket with AI Topic Subscriptions
// ----------------------------------------------------------------------------------
const newUnifiedWs = new WebSocket('wss://api.example.com/api/v69/ws');

newUnifiedWs.onopen = () => {
  console.log('Connected to unified WebSocket');
  
  // Subscribe to AI topic
  newUnifiedWs.send(JSON.stringify({
    type: '${config.websocket.messageTypes.SUBSCRIBE}',
    topic: 'ai'
  }));
  
  // Send AI query
  newUnifiedWs.send(JSON.stringify({
    type: '${config.websocket.messageTypes.REQUEST}',
    topic: 'ai',
    action: 'query',
    requestId: crypto.randomUUID(),
    data: {
      messages: [{ role: 'user', content: 'What is the current price of Solana?' }],
      context: 'terminal'
    }
  }));
};

newUnifiedWs.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  // Handle AI messages
  if (message.topic === 'ai') {
    if (message.subtype === 'response') {
      console.log('Received AI response:', message.data);
    } else if (message.action === 'stream-chunk') {
      // Append streaming chunk to display
      console.log('Received AI stream chunk:', message.data.content);
    }
  }
};
`;

// Export the example class
export default new AIWsTransitionExample();

// If this file is run directly
if (import.meta.url === import.meta.main) {
  const port = process.env.PORT || 3000;
  const app = new AIWsTransitionExample();
  app.start(port);
  
  // Handle graceful shutdown
  ['SIGINT', 'SIGTERM'].forEach(signal => {
    process.on(signal, () => {
      app.shutdown();
      process.exit(0);
    });
  });
}