import express from 'express';
import prisma from '../config/prisma.js';
import { config } from '../config/config.js';
import broadcaster from '../utils/websocket-suite/ws-broadcaster.js';
import { logApi } from '../utils/logger-suite/logger.js';
import serviceEvents from '../utils/service-suite/service-events.js';

const router = express.Router();

router.get('/terminal-data', async (req, res) => {
  try {
    // Use shared function to fetch terminal data, with broadcast enabled
    // This ensures every time the data is fetched via API, it's also broadcast to websocket clients
    const terminalData = await fetchTerminalData(true);

    return res.json({
      success: true,
      terminalData
    });
  } catch (error) {
    logApi.error('Error fetching terminal data:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch terminal data'
    });
  }
});

/**
 * Get WebSocket subscription info
 */
router.get('/terminal-data/subscribe', async (req, res) => {
  try {
    return res.json({
      success: true,
      subscription: {
        topic: config.websocket.topics.TERMINAL,
        messageType: 'TERMINAL_DATA',
        websocketEndpoint: config.websocket.config.path
      },
      message: 'Use the WebSocket endpoint to subscribe to real-time terminal data updates'
    });
  } catch (error) {
    logApi.error('Error getting subscription info:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get subscription info'
    });
  }
});

/**
 * Update terminal data (admin only route)
 */
router.post('/terminal-data', async (req, res) => {
  try {
    // Check authentication (would use a middleware in production)
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Admin access required'
      });
    }
    
    const { section, data } = req.body;
    
    if (!section || !data) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: section, data'
      });
    }
    
    let updated = false;
    
    // Update the relevant section
    switch (section) {
      case 'token':
        if (data.id) {
          // Update existing token config
          await prisma.token_config.update({
            where: { id: data.id },
            data: {
              symbol: data.symbol,
              address: data.address,
              total_supply: data.totalSupply,
              initial_circulating: data.initialCirculating,
              community_allocation_percent: parseInt(data.communityAllocation),
              team_allocation_percent: parseInt(data.teamAllocation),
              treasury_allocation_percent: parseInt(data.treasuryAllocation),
              initial_price: parseFloat(data.initialPrice),
              launch_method: data.launchMethod
            }
          });
        } else {
          // Create new token config
          await prisma.token_config.create({
            data: {
              symbol: data.symbol,
              address: data.address,
              total_supply: data.totalSupply,
              initial_circulating: data.initialCirculating,
              community_allocation_percent: parseInt(data.communityAllocation),
              team_allocation_percent: parseInt(data.teamAllocation),
              treasury_allocation_percent: parseInt(data.treasuryAllocation),
              initial_price: parseFloat(data.initialPrice),
              launch_method: data.launchMethod
            }
          });
        }
        updated = true;
        break;
        
      case 'roadmap':
        if (data.phaseId) {
          // Update existing roadmap phase
          await prisma.roadmap_phases.update({
            where: { id: data.phaseId },
            data: {
              quarter_number: parseInt(data.quarter),
              year: parseInt(data.year),
              title: data.title
            }
          });
          
          // Update tasks if provided
          if (data.tasks && Array.isArray(data.tasks)) {
            // First delete existing tasks
            await prisma.roadmap_tasks.deleteMany({
              where: { phase_id: data.phaseId }
            });
            
            // Then create new tasks
            for (const task of data.tasks) {
              await prisma.roadmap_tasks.create({
                data: {
                  phase_id: data.phaseId,
                  description: task
                }
              });
            }
          }
        } else {
          // Create new roadmap phase
          const phase = await prisma.roadmap_phases.create({
            data: {
              quarter_number: parseInt(data.quarter),
              year: parseInt(data.year),
              title: data.title
            }
          });
          
          // Create tasks if provided
          if (data.tasks && Array.isArray(data.tasks)) {
            for (const task of data.tasks) {
              await prisma.roadmap_tasks.create({
                data: {
                  phase_id: phase.id,
                  description: task
                }
              });
            }
          }
        }
        updated = true;
        break;
        
      case 'stats':
        // Get the existing stats record or create if it doesn't exist
        const existingStats = await prisma.platform_stats.findFirst();
        
        if (existingStats) {
          await prisma.platform_stats.update({
            where: { id: existingStats.id },
            data: {
              user_count: parseInt(data.userCount || existingStats.user_count),
              upcoming_contests: parseInt(data.upcomingContests || existingStats.upcoming_contests),
              total_prize_pool: parseFloat(data.totalPrizePool || existingStats.total_prize_pool),
              waitlist_count: parseInt(data.waitlistCount || existingStats.waitlist_count)
            }
          });
        } else {
          await prisma.platform_stats.create({
            data: {
              user_count: parseInt(data.userCount || 0),
              upcoming_contests: parseInt(data.upcomingContests || 0),
              total_prize_pool: parseFloat(data.totalPrizePool || 0),
              waitlist_count: parseInt(data.waitlistCount || 0)
            }
          });
        }
        updated = true;
        break;
        
      case 'commands':
        if (!data.commands || !Array.isArray(data.commands)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid commands data: expected array'
          });
        }
        
        // Process each command
        for (const cmd of data.commands) {
          if (cmd.id) {
            // Update existing command
            await prisma.terminal_commands.update({
              where: { id: cmd.id },
              data: {
                command_name: cmd.name,
                command_response: cmd.response
              }
            });
          } else if (cmd.name && cmd.response) {
            // Create new command
            await prisma.terminal_commands.create({
              data: {
                command_name: cmd.name,
                command_response: cmd.response
              }
            });
          }
        }
        updated = true;
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: `Unknown section: ${section}`
        });
    }
    
    if (updated) {
      // Fetch updated terminal data
      const updatedData = await fetchTerminalData();
      
      // Broadcast the updated data to all subscribers using both methods
      
      // APPROACH 1: Broadcast via service events - best for service decoupling
      // This will be picked up by the unified WebSocket server via event listeners
      serviceEvents.emit('terminal:broadcast', updatedData);
      
      // APPROACH 2: Use WSBroadcaster for advanced features like persistence
      // This utility provides role targeting, user targeting, and message persistence
      await broadcaster.broadcastToTopic(
        config.websocket.topics.TERMINAL,
        'terminal',
        'update',
        updatedData
      );
      
      return res.json({
        success: true,
        message: `Successfully updated ${section} data`,
        data: updatedData
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to update terminal data'
      });
    }
  } catch (error) {
    logApi.error('Error updating terminal data:', error);
    return res.status(500).json({
      success: false,
      message: `Failed to update terminal data: ${error.message}`
    });
  }
});

/**
 * Extract fetch terminal data function to be used by multiple routes
 * @param {boolean} [broadcast=false] - Whether to broadcast the data after fetching
 * @returns {Promise<Object>} Terminal data object
 */
async function fetchTerminalData(broadcast = false) {
  try {
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
    const terminalData = {
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
        initialPrice: `${tokenConfig.initial_price.toFixed(8)}`,
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
    
    // Optionally broadcast the data after fetching it
    if (broadcast) {
      // APPROACH 1: Broadcast via service events - best for service decoupling
      // This will be picked up by the unified WebSocket server via event listeners
      serviceEvents.emit('terminal:broadcast', terminalData);
      
      // APPROACH 2: Use WSBroadcaster for advanced features like persistence
      // This utility provides role targeting, user targeting, and message persistence
      await broadcaster.broadcastToTopic(
        config.websocket.topics.TERMINAL,
        'terminal',
        'update',
        terminalData
      );
      
      logApi.info('Terminal data fetched and broadcast to all subscribers using both methods');
    }
    
    return terminalData;
  } catch (error) {
    logApi.error('Error fetching terminal data:', error);
    throw error;
  }
}

export default router;