// websocket/v69/terminal-data-ws.js

/**
 * TerminalDataWebSocket (v69)
 * 
 * Handles real-time terminal data broadcasting with:
 * - Immediate data delivery on connection
 * - Command responses
 * - Real-time updates
 */

import { BaseWebSocketServer } from './base-websocket.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors } from '../../utils/colors.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import prisma from '../../config/prisma.js';
import config from '../../config/config.js';

// Configuration
const WSS_PATH = `/api/v69/ws/terminal-data`;
const WSS_REQUIRE_AUTH = false; // Terminal data is public
const WSS_PUBLIC_ENDPOINTS = ['/api/v69/ws/terminal-data']; 
const WSS_MAX_PAYLOAD = 512 * 1024; // 512KB
const WSS_RATE_LIMIT = 30; // 30 messages per minute

/**
 * Fetch terminal data from the database
 * @returns {Promise<Object>} Terminal data object
 */
async function fetchTerminalData() {
  // Fetch all data in parallel
  const [tokenConfig, roadmap, stats, commands] = await Promise.all([
    prisma.token_config.findFirst(),
    prisma.roadmap_phases.findMany({
      include: { tasks: true },
      orderBy: [
        { year: 'asc' },
        { quarter_number: 'asc' }
      ]
    }),
    prisma.platform_stats.findFirst(),
    prisma.terminal_commands.findMany()
  ]);

  // Format roadmap data
  const formattedRoadmap = roadmap.map(phase => ({
    quarter: `Q${phase.quarter_number}`,
    year: phase.year.toString(),
    title: phase.title,
    details: phase.tasks.map(task => task.description)
  }));

  // Format commands into object
  const commandsObj = commands.reduce((acc, cmd) => {
    acc[cmd.command_name] = cmd.command_response;
    return acc;
  }, {});

  // Construct terminal data
  return {
    platformName: "DegenDuel",
    platformDescription: "High-stakes crypto trading competitions",
    platformStatus: "Ready for launch on scheduled date",

    stats: {
      currentUsers: stats?.user_count || 0,
      upcomingContests: stats?.upcoming_contests || 0,
      totalPrizePool: `${stats?.total_prize_pool.toLocaleString() || '0'}`,
      platformTraffic: "Increasing 35% week over week",
      socialGrowth: "Twitter +3.2K followers this week",
      waitlistUsers: stats?.waitlist_count || 0
    },

    token: tokenConfig ? {
      symbol: tokenConfig.symbol,
      address: tokenConfig.address,
      totalSupply: Number(tokenConfig.total_supply).toString(),
      initialCirculating: Number(tokenConfig.initial_circulating).toString(),
      communityAllocation: `${tokenConfig.community_allocation_percent}%`,
      teamAllocation: `${tokenConfig.team_allocation_percent}%`,
      treasuryAllocation: `${tokenConfig.treasury_allocation_percent}%`,
      initialPrice: `${Number(tokenConfig.initial_price).toFixed(8)}`,
      marketCap: `${(Number(tokenConfig.initial_circulating) * Number(tokenConfig.initial_price)).toLocaleString()}`,
      networkType: "Solana",
      tokenType: "SPL",
      decimals: 9
    } : null,

    launch: tokenConfig ? {
      method: tokenConfig.launch_method,
      platforms: ["Jupiter", "Raydium"],
      privateSaleStatus: "COMPLETED",
      publicSaleStatus: "COUNTDOWN ACTIVE"
    } : null,

    roadmap: formattedRoadmap,
    commands: commandsObj
  };
}

class TerminalDataWebSocket extends BaseWebSocketServer {
  constructor(server) {
    const baseOptions = {
      path: WSS_PATH,
      requireAuth: WSS_REQUIRE_AUTH,
      publicEndpoints: WSS_PUBLIC_ENDPOINTS,
      maxPayload: WSS_MAX_PAYLOAD,
      rateLimit: WSS_RATE_LIMIT,
      heartbeatInterval: 30000,
      perMessageDeflate: false,
      authMode: 'auto'
    };
    
    super(server, baseOptions);
    
    // Initialize terminal-specific state
    this.lastTerminalData = null;
    this.dataFetchTime = null;
    
    // Set up broadcast listener
    this.terminalDataListener = this.handleTerminalDataBroadcast.bind(this);
    
    logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.BOLD}${fancyColors.WHITE} TERMINAL WS ${fancyColors.RESET} ${fancyColors.CYAN}${fancyColors.BOLD}TerminalDataWebSocket initialized${fancyColors.RESET}`);
  }

  async onInitialize() {
    try {
      // Fetch initial terminal data at startup
      this.lastTerminalData = await fetchTerminalData();
      this.dataFetchTime = new Date();
      
      // Set up terminal data service listener
      serviceEvents.on('terminal:broadcast', this.terminalDataListener);
      
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.WHITE}${fancyColors.BOLD} TERMINAL INIT ${fancyColors.RESET} ${fancyColors.CYAN}Terminal Data WebSocket initialized${fancyColors.RESET}`);
      return true;
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} TERMINAL INIT-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error initializing Terminal Data WebSocket: ${error.message}${fancyColors.RESET}`, error);
      return false;
    }
  }

  /**
   * Handle terminal data broadcast event
   * @param {Object} data - Terminal data to broadcast
   */
  async handleTerminalDataBroadcast(data) {
    try {
      if (!data) return;
      
      // Update our cached data
      this.lastTerminalData = data;
      this.dataFetchTime = new Date();
      
      // Broadcast to all clients
      this.broadcast({
        type: 'DATA',
        topic: config.websocket.topics.TERMINAL,
        subtype: 'terminal',
        action: 'update',
        data: data,
        timestamp: new Date().toISOString()
      });
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} TERMINAL-WS ${fancyColors.RESET} Broadcasted terminal data to ${this.clients.size} clients`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} TERMINAL-WS-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error broadcasting terminal data: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Send the latest terminal data to a client
   * @param {WebSocket} client - The client to send to
   */
  async sendLatestTerminalData(client) {
    try {
      // If we have no data or data is older than 5 minutes, fetch fresh data
      const now = new Date();
      const dataAge = now - (this.dataFetchTime || 0);
      
      if (!this.lastTerminalData || dataAge > 5 * 60 * 1000) {
        this.lastTerminalData = await fetchTerminalData();
        this.dataFetchTime = now;
      }
      
      // Send the latest data to the client
      this.sendToClient(client, {
        type: 'DATA',
        topic: config.websocket.topics.TERMINAL,
        subtype: 'terminal',
        action: 'initial',
        data: this.lastTerminalData,
        timestamp: new Date().toISOString()
      });
      
      logApi.debug(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} TERMINAL-WS ${fancyColors.RESET} Sent initial terminal data to client`);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.BLACK} TERMINAL-WS-ERROR ${fancyColors.RESET} ${fancyColors.RED}Error sending latest terminal data: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle client connection
   * @param {WebSocket} ws - The WebSocket connection
   * @param {http.IncomingMessage} req - The HTTP request
   */
  async onConnection(ws, req) {
    try {
      logApi.info(`${fancyColors.BG_DARK_CYAN}${fancyColors.GREEN} TERMINAL CLIENT CONNECTED ${fancyColors.RESET} ${fancyColors.GREEN}Client connected to terminal data WebSocket${fancyColors.RESET}`);
      
      // Send the latest terminal data immediately on connection
      await this.sendLatestTerminalData(ws);
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} TERMINAL CONNECTION ERROR ${fancyColors.RESET} ${fancyColors.RED}Error handling connection: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle client message
   * @param {WebSocket} ws - The WebSocket connection
   * @param {Object} message - The parsed message object
   */
  async onMessage(ws, message) {
    try {
      // If the client requests a refresh of terminal data
      if (message && message.action === 'get_terminal_data') {
        await this.sendLatestTerminalData(ws);
        return;
      }
      
      // If the client sends a command to process
      if (message && message.action === 'command') {
        // Process command (if we want to implement command processing)
        // For now, just respond with a standard message
        this.sendToClient(ws, {
          type: 'DATA',
          topic: config.websocket.topics.TERMINAL,
          subtype: 'terminal',
          action: 'command_response',
          data: {
            command: message.command,
            response: 'Command processing not implemented yet'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }
    } catch (error) {
      logApi.error(`${fancyColors.BG_DARK_CYAN}${fancyColors.RED} TERMINAL MESSAGE ERROR ${fancyColors.RESET} ${fancyColors.RED}Error handling message: ${error.message}${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle cleanup when the server is shutting down
   */
  async onCleanup() {
    // Remove event listeners
    serviceEvents.removeListener('terminal:broadcast', this.terminalDataListener);
    
    // Clear cached data
    this.lastTerminalData = null;
    this.dataFetchTime = null;
  }
}

export default TerminalDataWebSocket;