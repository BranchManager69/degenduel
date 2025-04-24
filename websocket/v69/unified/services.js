// websocket/v69/services.js

/**
 * Unified WebSocket Services
 * 
 * This module provides service functions for the unified WebSocket system:
 * - Terminal data fetching
 * - Service event registration
 */

import prisma from '../../config/prisma.js';
import serviceEvents from '../../utils/service-suite/service-events.js';
import marketDataService from '../../services/marketDataService.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { fancyColors, wsColors } from '../../utils/colors.js';
import { TOPICS } from './utils.js';

/**
 * Fetch terminal data from the database
 * @returns {Promise<Object>} Terminal data object
 */
export async function fetchTerminalData() {
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
  const commandsObj = {};
  commands.forEach(cmd => {
    commandsObj[cmd.command] = {
      description: cmd.description,
      usage: cmd.usage || null,
      isAdmin: cmd.is_admin || false
    };
  });

  return {
    platformName: "DegenDuel",
    platformDescription: "High-stakes crypto trading competitions",
    platformStatus: await getSystemOperationalStatus(),
    features: await getPlatformFeatures(),
    systemStatus: await getSystemComponentStatus(),
    stats: {
      currentUsers: stats?.user_count || 0,
      upcomingContests: stats?.upcoming_contests || 0,
      totalPrizePool: `${stats?.total_prize_pool ? String(stats.total_prize_pool) : '0'}`,
      platformTraffic: "High",
      socialGrowth: "+5% this week",
      waitlistUsers: stats?.waitlist_count || 0
    },

    token: tokenConfig ? {
      symbol: tokenConfig.symbol,
      address: tokenConfig.address,
      totalSupply: Number(tokenConfig.total_supply),
      initialCirculating: Number(tokenConfig.initial_circulating),
      communityAllocation: `${tokenConfig.community_allocation_percent}%`,
      teamAllocation: `${tokenConfig.team_allocation_percent}%`,
      treasuryAllocation: `${tokenConfig.treasury_allocation_percent}%`,
      initialPrice: `$${Number(tokenConfig.initial_price).toFixed(2)}`,
      marketCap: `$${(Number(tokenConfig.initial_circulating) * Number(tokenConfig.initial_price)).toLocaleString()}`,
      liquidityLockPeriod: "2 years",
      networkType: "Solana",
      tokenType: "SPL",
      decimals: 9
    } : null,

    launch: tokenConfig ? {
      method: tokenConfig.launch_method,
      platforms: ["Raydium", "Orca"],
      privateSaleStatus: "Completed",
      publicSaleStatus: "Live",
      kycRequired: true,
      minPurchase: "100 USDC",
      maxPurchase: "5000 USDC"
    } : null,

    roadmap: formattedRoadmap,
    commands: commandsObj
  };
}

/**
 * Check overall system operational status
 * @returns {string} System status description
 */
async function getSystemOperationalStatus() {
  try {
    // Check service configurations for overall system health
    const serviceConfigs = await prisma.service_configuration.findMany({
      select: {
        service_name: true,
        enabled: true,
        last_status: true
      }
    });
    
    // Calculate overall system status based on critical services
    const criticalServices = serviceConfigs.filter(svc => 
      ['solanaService', 'marketDataService', 'contestWalletService'].includes(svc.service_name)
    );
    
    const failedCriticalServices = criticalServices.filter(svc => 
      svc.last_status === 'failure' || (svc.enabled && !svc.last_status)
    );
    
    if (failedCriticalServices.length > 0) {
      return "Degraded";
    }
    
    const totalServices = serviceConfigs.length;
    const failedServices = serviceConfigs.filter(svc => svc.last_status === 'failure').length;
    const percentageHealthy = 100 - (failedServices / totalServices * 100);
    
    if (percentageHealthy >= 95) return "Operational";
    if (percentageHealthy >= 80) return "Minor Issues";
    if (percentageHealthy >= 50) return "Degraded";
    return "Major Outage";
  } catch (error) {
    logApi.error(`Error checking system status: ${error.message}`, error);
    return "Operational"; // Default fallback
  }
}

/**
 * Get list of active platform features
 * @returns {Array<string>} List of platform features
 */
async function getPlatformFeatures() {
  try {
    // Try to get features from system_settings
    const featuresSetting = await prisma.system_settings.findUnique({
      where: { key: 'platform_features' }
    });
    
    if (featuresSetting && Array.isArray(featuresSetting.value)) {
      return featuresSetting.value;
    }
    
    // Default features if not found in database
    return ["Real-time trading", "Leaderboards", "Prize pools"];
  } catch (error) {
    logApi.error(`Error fetching platform features: ${error.message}`, error);
    return ["Real-time trading", "Leaderboards", "Prize pools"];
  }
}

/**
 * Get status of system components
 * @returns {Object} Status of each system component
 */
async function getSystemComponentStatus() {
  try {
    // Get service statuses
    const services = await prisma.service_configuration.findMany({
      select: {
        display_name: true,
        last_status: true,
        enabled: true
      }
    });
    
    // Format status for each service
    const componentStatus = {};
    
    // Add main API status
    componentStatus['API'] = "✅ Online";
    
    // Add Database status - check with a simple query
    try {
      await prisma.$queryRaw`SELECT 1`;
      componentStatus['Database'] = "✅ Online";
    } catch (dbError) {
      componentStatus['Database'] = "❌ Offline";
    }
    
    // Add WebSocket status - it's running if this code is executing
    componentStatus['WebSocket'] = "✅ Online";
    
    // Add status for each service
    services.forEach(service => {
      // Skip internal services that users don't need to see
      if (['loggerService', 'maintenanceService'].includes(service.display_name)) {
        return;
      }
      
      // Format the display name
      const displayName = service.display_name.replace('Service', '');
      
      if (!service.enabled) {
        componentStatus[displayName] = "⚠️ Disabled";
      } else if (service.last_status === 'success') {
        componentStatus[displayName] = "✅ Online";
      } else if (service.last_status === 'degraded') {
        componentStatus[displayName] = "⚠️ Degraded";
      } else if (service.last_status === 'failure') {
        componentStatus[displayName] = "❌ Error";
      } else {
        componentStatus[displayName] = "⚠️ Unknown";
      }
    });
    
    return componentStatus;
  } catch (error) {
    logApi.error(`Error getting component status: ${error.message}`, error);
    // Return basic status if error
    return {
      API: "✅ Online",
      Database: "✅ Online",
      WebSocket: "✅ Online"
    };
  }
}

/**
 * Register service event handlers with the unified WebSocket server
 * @param {Object} server - The unified WebSocket server instance
 */
export function registerServiceEvents(server) {
  // Market Data event handlers
  server.registerEventHandler(
    'market:broadcast', 
    (data) => server.broadcastToTopic(TOPICS.MARKET_DATA, {
      type: 'DATA',
      topic: TOPICS.MARKET_DATA,
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // Terminal Data event handlers
  server.registerEventHandler(
    'terminal:broadcast', 
    (data) => server.broadcastToTopic(TOPICS.TERMINAL, {
      type: 'DATA',
      topic: TOPICS.TERMINAL,
      subtype: 'terminal',
      action: 'update',
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // System event handlers
  server.registerEventHandler(
    'system:status',
    (data) => server.broadcastToTopic(TOPICS.SYSTEM, {
      type: 'DATA',
      topic: TOPICS.SYSTEM,
      action: 'status_update',
      data: data,
      timestamp: new Date().toISOString()
    })
  );
  
  // Wallet balance event handlers
  server.registerEventHandler(
    'wallet:balance_update',
    (data) => {
      if (data.walletAddress) {
        server.broadcastToTopic(`${TOPICS.WALLET_BALANCE}:${data.walletAddress}`, {
          type: 'DATA',
          topic: TOPICS.WALLET_BALANCE,
          data: data,
          timestamp: new Date().toISOString()
        });
      }
    }
  );
  
  // Log successful registration
  logApi.info(`${wsColors.tag}[services]${fancyColors.RESET} ${fancyColors.GREEN}Service event handlers registered successfully${fancyColors.RESET}`);
}