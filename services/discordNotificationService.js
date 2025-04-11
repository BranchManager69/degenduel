// services/discordNotificationService.js
import DiscordWebhook from '../utils/discord-webhook.js';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors } from '../utils/colors.js';

// Create a service-specific logger that writes to the database
const logger = logApi.forService(SERVICE_NAMES.DISCORD_NOTIFICATION);

/**
 * Discord notification service for sending automated notifications to Discord
 */
class DiscordNotificationService extends BaseService {
  constructor() {
    super({ 
      name: SERVICE_NAMES.DISCORD_NOTIFICATION,
      description: 'Discord webhook integration service',
      layer: 'INFRASTRUCTURE',
      criticalLevel: 'low',
      checkIntervalMs: 60000, // Check every minute
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        healthCheckIntervalMs: 30000,
        description: 'Discord notification service'
      }
    });
    
    // Default webhooks - these would come from config or environment variables
    this.webhookUrls = {
      alerts: process.env.DISCORD_WEBHOOK_ALERTS || '',
      contests: process.env.DISCORD_WEBHOOK_CONTESTS || '',
      transactions: process.env.DISCORD_WEBHOOK_TRANSACTIONS || '',
      system: process.env.DISCORD_WEBHOOK_SYSTEM || '',
    };
    
    // Initialize webhook clients
    this.webhooks = {};
    for (const [key, url] of Object.entries(this.webhookUrls)) {
      if (url) {
        this.webhooks[key] = new DiscordWebhook(url);
      }
    }
    
    this.setupEventListeners();
  }

  async init() {
    try {
      const serviceConfig = await prisma.service_configuration.findUnique({
        where: { service_name: this.name }
      });
      
      if (serviceConfig) {
        logger.info(`${fancyColors.brightCyan}[Discord] ${fancyColors.yellow}Loading service configuration`, {
          eventType: 'service_init',
          details: { configFound: true }
        });
      } else {
        logger.info(`${fancyColors.brightCyan}[Discord] ${fancyColors.yellow}No configuration found, using defaults`, {
          eventType: 'service_init',
          details: { configFound: false, usingDefaults: true }
        });
      }
      
      this.initialized = true;
      return true;
    } catch (error) {
      logger.error(`${fancyColors.brightCyan}[Discord] ${fancyColors.red}Initialization error:`, {
        eventType: 'service_init_error',
        error
      });
      return false;
    }
  }

  /**
   * Set up event listeners for system events
   */
  setupEventListeners() {
    // Listen for contest creation events
    this.events.on(SERVICE_EVENTS.CONTEST_CREATED, this.onContestCreated.bind(this));
    
    // Listen for contest activity (joins, etc.)
    this.events.on(SERVICE_EVENTS.CONTEST_ACTIVITY, this.onContestActivity.bind(this));
    
    // Listen for contest completion events
    this.events.on(SERVICE_EVENTS.CONTEST_COMPLETED, this.onContestCompleted.bind(this));
    
    // Listen for user milestone events
    this.events.on(SERVICE_EVENTS.USER_ACHIEVEMENT, this.onUserAchievement.bind(this));
    this.events.on(SERVICE_EVENTS.USER_LEVEL_UP, this.onUserLevelUp.bind(this));
    this.events.on(SERVICE_EVENTS.USER_MILESTONE, this.onUserMilestone.bind(this));
    
    // Listen for major system events
    this.events.on(SERVICE_EVENTS.SYSTEM_ALERT, this.onSystemAlert.bind(this));
    
    // Listen for service status changes
    this.events.on(SERVICE_EVENTS.SERVICE_STATUS_CHANGE, this.onServiceStatusChange.bind(this));
    
    // Listen for significant transactions
    this.events.on(SERVICE_EVENTS.LARGE_TRANSACTION, this.onLargeTransaction.bind(this));
    
    // Listen for token transactions
    this.events.on(SERVICE_EVENTS.TOKEN_PURCHASE, this.onTokenPurchase.bind(this));
    this.events.on(SERVICE_EVENTS.TOKEN_SALE, this.onTokenSale.bind(this));
  }

  /**
   * Required method for BaseService operation
   * This gets called regularly by the BaseService to perform the service's main operation
   * and is used for circuit breaker recovery
   */
  async onPerformOperation() {
    try {
      // For the Discord service, we just need to check if our webhook configs are valid
      // No continuous operation needed - we just respond to events
      
      const startTime = Date.now();
      
      // Check if any webhooks are configured
      const hasWebhooks = Object.values(this.webhooks).some(webhook => webhook !== undefined);
      
      // Count configured webhooks
      const webhookCount = Object.values(this.webhooks).filter(webhook => webhook !== undefined).length;
      
      if (!hasWebhooks) {
        logger.warn(`${fancyColors.brightCyan}[Discord] ${fancyColors.yellow}No webhooks configured`, {
          eventType: 'service_health_check',
          details: {
            hasWebhooks: false,
            webhookCount: 0
          }
        });
      } else {
        logger.debug(`${fancyColors.brightCyan}[Discord] ${fancyColors.green}Webhook check successful`, {
          eventType: 'service_health_check',
          details: {
            hasWebhooks: true,
            webhookCount,
            webhookChannels: Object.keys(this.webhooks).filter(key => this.webhooks[key] !== undefined)
          },
          // Flag to persist debug logs to database
          persistToDb: true
        });
      }
      
      const endTime = Date.now();
      
      // Log performance metrics
      logger.info(`${fancyColors.brightCyan}[Discord] ${fancyColors.green}Service operation completed`, {
        eventType: 'service_heartbeat',
        durationMs: endTime - startTime,
        details: {
          operation: 'webhook_health_check',
          webhookCount,
          circuitBreakerStatus: this.stats.circuitBreaker.isOpen ? 'open' : 'closed'
        }
      });
      
      return true;
    } catch (error) {
      logger.error(`${fancyColors.brightCyan}[Discord] ${fancyColors.red}Perform operation error:`, {
        eventType: 'service_operation_error',
        error,
        details: {
          errorMessage: error.message,
          errorName: error.name,
          errorStack: error.stack
        }
      });
      throw error; // Important: re-throw to trigger circuit breaker
    }
  }

  /**
   * Handle contest creation events
   * @param {Object} contestData - Contest data
   */
  async onContestCreated(contestData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Log the incoming contest data
      logger.info(`${fancyColors.brightCyan}[Discord] ${fancyColors.blue}Received contest creation event`, {
        eventType: 'contest_created',
        relatedEntity: contestData.contest_code,
        details: {
          contestId: contestData.id,
          contestName: contestData.name,
          startTime: contestData.start_time,
          prizePool: contestData.prize_pool
        }
      });
      
      const embed = this.webhooks.contests.createInfoEmbed(
        '🎮 New Contest Created',
        `A new contest **${contestData.name}** has been created!`
      );
      
      // Add fields with contest details
      embed.fields = [
        { name: 'Contest Code', value: contestData.contest_code, inline: true },
        { name: 'Start Time', value: new Date(contestData.start_time).toLocaleString(), inline: true },
        { name: 'Prize Pool', value: `${contestData.prize_pool} SOL`, inline: true },
        { name: 'Entry Fee', value: `${contestData.entry_fee} SOL`, inline: true },
        { name: 'Status', value: contestData.status, inline: true },
      ];
      
      const startTime = Date.now();
      await this.webhooks.contests.sendEmbed(embed);
      const endTime = Date.now();
      
      // Log successful notification with performance metrics
      logger.info(`${fancyColors.brightCyan}[Discord] ${fancyColors.green}Sent contest creation notification`, {
        eventType: 'webhook_sent',
        relatedEntity: contestData.contest_code,
        durationMs: endTime - startTime,
        details: {
          contestId: contestData.id,
          webhookType: 'contests',
          notificationType: 'contest_creation'
        }
      });
    } catch (error) {
      // Log the error with appropriate context
      logger.error(`${fancyColors.brightCyan}[Discord] ${fancyColors.red}Failed to send contest notification:`, {
        eventType: 'webhook_error',
        relatedEntity: contestData.contest_code,
        error,
        details: {
          contestId: contestData.id,
          webhookType: 'contests',
          errorMessage: error.message
        }
      });
    }
  }

  /**
   * Handle system alert events
   * @param {Object} alertData - Alert data
   */
  async onSystemAlert(alertData) {
    if (!this.webhooks.alerts) return;
    
    try {
      const embed = this.webhooks.alerts.createErrorEmbed(
        `⚠️ System Alert: ${alertData.title}`,
        alertData.message
      );
      
      if (alertData.fields) {
        embed.fields = alertData.fields;
      }
      
      await this.webhooks.alerts.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent system alert notification${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send system alert:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle service status change events
   * @param {Object} statusData - Status change data
   */
  async onServiceStatusChange(statusData) {
    if (!this.webhooks.system) return;
    
    try {
      const status = statusData.newStatus;
      const serviceName = statusData.serviceName;
      
      let embed;
      if (status === 'down' || status === 'error') {
        embed = this.webhooks.system.createErrorEmbed(
          `🔴 Service Down: ${serviceName}`,
          `The ${serviceName} service is experiencing issues.`
        );
      } else if (status === 'recovered') {
        embed = this.webhooks.system.createSuccessEmbed(
          `🟢 Service Recovered: ${serviceName}`,
          `The ${serviceName} service has recovered and is now operational.`
        );
      } else {
        embed = this.webhooks.system.createInfoEmbed(
          `🔵 Service Status Change: ${serviceName}`,
          `The ${serviceName} service status changed to: ${status}`
        );
      }
      
      // Add details
      if (statusData.details) {
        embed.fields = [
          { name: 'Details', value: statusData.details }
        ];
      }
      
      await this.webhooks.system.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent service status notification${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send service status notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle contest activity events
   * @param {Object} activityData - Contest activity data
   */
  async onContestActivity(activityData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Handle different types of contest activity
      if (activityData.type === 'user_joined') {
        // Format emoji based on participant counts
        let statusEmoji = '🟢'; // Default green circle
        const { currentParticipants, maxParticipants } = activityData;
        
        // If the contest is filling up, show different emoji
        if (maxParticipants !== 'unlimited') {
          const maxParticipantsNum = parseInt(maxParticipants);
          const fillPercentage = (currentParticipants / maxParticipantsNum) * 100;
          
          if (fillPercentage >= 90) {
            statusEmoji = '🔥'; // Almost full - fire emoji
          } else if (fillPercentage >= 75) {
            statusEmoji = '🟠'; // Filling up
          } else if (fillPercentage >= 50) {
            statusEmoji = '🟡'; // Half full
          }
        }
        
        const embed = this.webhooks.contests.createInfoEmbed(
          `👤 New Participant in ${activityData.contestName}`,
          `${activityData.userDisplayName} has joined the contest!`
        );
        
        // Add contest details
        embed.fields = [
          { name: 'Contest', value: activityData.contestName, inline: true },
          { name: 'Code', value: activityData.contestCode, inline: true },
          { name: 'Prize Pool', value: `${activityData.prizePool} SOL`, inline: true },
          { name: 'Participants', value: `${statusEmoji} ${activityData.currentParticipants}/${activityData.maxParticipants}`, inline: true },
          { name: 'Entry Fee', value: `${activityData.entryFee} SOL`, inline: true },
          { name: 'Starts', value: new Date(activityData.startTime).toLocaleString(), inline: true },
        ];
        
        await this.webhooks.contests.sendEmbed(embed);
        logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent contest join notification${fancyColors.RESET}`);
      }
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send contest activity notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle contest completion events with winner announcements
   * @param {Object} completionData - Contest completion data including winners
   */
  async onContestCompleted(completionData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Get medal emojis for the top 3 places
      const medalEmojis = {
        1: '🥇', // 1st place - gold medal
        2: '🥈', // 2nd place - silver medal
        3: '🥉'  // 3rd place - bronze medal
      };
      
      // Create a rich embed for contest completion
      const embed = {
        title: `🏆 Contest Completed: ${completionData.contest_name}`,
        description: `Contest **${completionData.contest_name}** has ended with **${completionData.participant_count}** participants!`,
        color: 0xFFD700, // Gold color for winners
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'Contest Code', value: completionData.contest_code, inline: true },
          { name: 'Prize Pool', value: `${completionData.prize_pool} SOL`, inline: true },
          { name: 'Participants', value: completionData.participant_count.toString(), inline: true }
        ]
      };
      
      // Add duration field showing how long the contest ran
      if (completionData.start_time && completionData.end_time) {
        const startTime = new Date(completionData.start_time);
        const endTime = new Date(completionData.end_time);
        const durationHours = Math.round((endTime - startTime) / (1000 * 60 * 60) * 10) / 10;
        
        embed.fields.push({ 
          name: 'Duration', 
          value: `${durationHours} hours`, 
          inline: true 
        });
      }
      
      // Add winners section
      if (completionData.winners && completionData.winners.length > 0) {
        embed.fields.push({ 
          name: '🏆 Winners', 
          value: '━━━━━━━━━━━━━━━━━━━━━━━', 
          inline: false 
        });
        
        // Add each winner with their medal emoji and prize
        completionData.winners.forEach(winner => {
          const medal = medalEmojis[winner.place] || `${winner.place}`;
          embed.fields.push({ 
            name: `${medal} ${winner.display_name}`, 
            value: `Prize: ${winner.prize_amount} SOL`, 
            inline: true 
          });
        });
      }
      
      // Send the rich embed to Discord
      await this.webhooks.contests.sendEmbed(embed);
      
      // Log success
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent contest completion notification for contest #${completionData.contest_id}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send contest completion notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle large transaction events
   * @param {Object} txData - Transaction data
   */
  async onLargeTransaction(txData) {
    if (!this.webhooks.transactions) return;
    
    try {
      const embed = this.webhooks.transactions.createInfoEmbed(
        `💰 Large ${txData.type} Transaction`,
        `A large transaction of ${txData.amount} SOL has been processed.`
      );
      
      // Add transaction details
      embed.fields = [
        { name: 'Type', value: txData.type, inline: true },
        { name: 'Amount', value: `${txData.amount} SOL`, inline: true },
        { name: 'Wallet', value: `${txData.wallet_address.substring(0, 6)}...${txData.wallet_address.substring(txData.wallet_address.length - 4)}`, inline: true },
        { name: 'Status', value: txData.status, inline: true },
        { name: 'Timestamp', value: new Date().toLocaleString(), inline: true },
      ];
      
      if (txData.contest_id) {
        embed.fields.push({ name: 'Contest ID', value: txData.contest_id.toString(), inline: true });
      }
      
      await this.webhooks.transactions.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent large transaction notification${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send transaction notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle user achievement events
   * @param {Object} achievementData - Achievement data
   */
  async onUserAchievement(achievementData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Format the achievement notification
      const embed = {
        title: `🏅 Achievement Unlocked: ${achievementData.achievement_name}`,
        description: `**${achievementData.user_name}** has unlocked a new achievement!`,
        color: 0x9932CC, // Purple color for achievements
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'Achievement', value: achievementData.achievement_name, inline: true },
          { name: 'Description', value: achievementData.description, inline: true },
          { name: 'XP Awarded', value: `+${achievementData.xp_awarded || 0} XP`, inline: true }
        ]
      };
      
      // Add custom thumbnail if provided
      if (achievementData.icon_url) {
        embed.thumbnail = { url: achievementData.icon_url };
      }
      
      // Send the notification
      await this.webhooks.contests.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent achievement notification for user ${achievementData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send achievement notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle user level up events
   * @param {Object} levelData - Level up data
   */
  async onUserLevelUp(levelData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Get an appropriate level up emoji based on level
      let levelEmoji = '⭐';
      if (levelData.new_level >= 50) {
        levelEmoji = '👑'; // Crown for high levels
      } else if (levelData.new_level >= 30) {
        levelEmoji = '💎'; // Diamond for level 30+
      } else if (levelData.new_level >= 20) {
        levelEmoji = '🔥'; // Fire for level 20+
      } else if (levelData.new_level >= 10) {
        levelEmoji = '🌟'; // Star for level 10+
      }
      
      // Format the level up notification
      const embed = {
        title: `${levelEmoji} Level Up! ${levelData.user_name} is now Level ${levelData.new_level}`,
        description: `**${levelData.user_name}** has reached level **${levelData.new_level}**! ${getRandomCongratulation()}`,
        color: 0x00BFFF, // Deep sky blue color for level ups
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'Previous Level', value: `${levelData.previous_level}`, inline: true },
          { name: 'New Level', value: `${levelData.new_level}`, inline: true },
          { name: 'Total XP', value: `${levelData.total_xp || 0} XP`, inline: true }
        ]
      };
      
      // Add any unlocked perks if provided
      if (levelData.unlocked_perks && levelData.unlocked_perks.length > 0) {
        embed.fields.push({
          name: '🔓 Unlocked Perks',
          value: levelData.unlocked_perks.map(perk => `• ${perk}`).join('\\n'),
          inline: false
        });
      }
      
      // Send the notification
      await this.webhooks.contests.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent level up notification for user ${levelData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send level up notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle general user milestone events
   * @param {Object} milestoneData - Milestone data
   */
  async onUserMilestone(milestoneData) {
    if (!this.webhooks.contests) return;
    
    try {
      // Format the milestone notification
      const embed = {
        title: `🎯 Milestone Reached: ${milestoneData.title}`,
        description: milestoneData.description || `**${milestoneData.user_name}** has reached a milestone!`,
        color: 0xFF8C00, // Dark orange color for milestones
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'User', value: milestoneData.user_name, inline: true },
          { name: 'Milestone', value: milestoneData.title, inline: true }
        ]
      };
      
      // Add any additional fields
      if (milestoneData.fields && Array.isArray(milestoneData.fields)) {
        milestoneData.fields.forEach(field => {
          embed.fields.push(field);
        });
      }
      
      // Send the notification
      await this.webhooks.contests.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent milestone notification for user ${milestoneData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send milestone notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle token purchase events
   * @param {Object} tokenData - Token purchase data
   */
  async onTokenPurchase(tokenData) {
    // Use a special channel for token activity if available, otherwise use transactions channel
    const webhook = this.webhooks.tokens || this.webhooks.transactions;
    if (!webhook) return;
    
    try {
      // Format token amount with proper precision
      const formattedAmount = this.formatTokenAmount(tokenData.amount, tokenData.decimals || 9);
      
      // Calculate USD value if available
      let usdValue = '';
      if (tokenData.price_usd && tokenData.amount) {
        const usdTotal = (parseFloat(tokenData.price_usd) * parseFloat(tokenData.amount)).toFixed(2);
        usdValue = ` ($${usdTotal})`;
      }
      
      // Create the notification embed with green color for buys
      const embed = {
        title: `🟢 Token Purchase: ${tokenData.token_symbol || tokenData.token_name || 'Unknown Token'}`,
        description: `Someone just bought **${formattedAmount} ${tokenData.token_symbol || ''}**${usdValue}!`,
        color: 0x00C851, // Green for purchases
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'Token', value: tokenData.token_name || tokenData.token_address.substring(0, 10) + '...', inline: true },
          { name: 'Amount', value: formattedAmount, inline: true },
        ]
      };
      
      // Add price if available
      if (tokenData.price_usd) {
        embed.fields.push({ 
          name: 'Price', 
          value: `$${parseFloat(tokenData.price_usd).toFixed(tokenData.price_usd < 0.01 ? 8 : 4)}`, 
          inline: true 
        });
      }
      
      // Add more transaction details if available
      if (tokenData.buyer_address) {
        const shortenedAddress = tokenData.buyer_address.substring(0, 6) + '...' + 
                               tokenData.buyer_address.substring(tokenData.buyer_address.length - 4);
        embed.fields.push({ 
          name: 'Buyer', 
          value: shortenedAddress, 
          inline: true 
        });
      }
      
      if (tokenData.tx_signature) {
        embed.fields.push({ 
          name: 'Transaction', 
          value: `[View on Explorer](https://solscan.io/tx/${tokenData.tx_signature})`, 
          inline: true 
        });
      }
      
      // Send the notification
      await webhook.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent token purchase notification for ${tokenData.token_symbol || tokenData.token_address}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send token purchase notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle token sale events
   * @param {Object} tokenData - Token sale data
   */
  async onTokenSale(tokenData) {
    // Use a special channel for token activity if available, otherwise use transactions channel
    const webhook = this.webhooks.tokens || this.webhooks.transactions;
    if (!webhook) return;
    
    try {
      // Format token amount with proper precision
      const formattedAmount = this.formatTokenAmount(tokenData.amount, tokenData.decimals || 9);
      
      // Calculate USD value if available
      let usdValue = '';
      if (tokenData.price_usd && tokenData.amount) {
        const usdTotal = (parseFloat(tokenData.price_usd) * parseFloat(tokenData.amount)).toFixed(2);
        usdValue = ` ($${usdTotal})`;
      }
      
      // Create the notification embed with red color for sells
      const embed = {
        title: `🔴 Token Sale: ${tokenData.token_symbol || tokenData.token_name || 'Unknown Token'}`,
        description: `Someone just sold **${formattedAmount} ${tokenData.token_symbol || ''}**${usdValue}!`,
        color: 0xFF4444, // Red for sales
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform'
        },
        fields: [
          { name: 'Token', value: tokenData.token_name || tokenData.token_address.substring(0, 10) + '...', inline: true },
          { name: 'Amount', value: formattedAmount, inline: true },
        ]
      };
      
      // Add price if available
      if (tokenData.price_usd) {
        embed.fields.push({ 
          name: 'Price', 
          value: `$${parseFloat(tokenData.price_usd).toFixed(tokenData.price_usd < 0.01 ? 8 : 4)}`, 
          inline: true 
        });
      }
      
      // Add more transaction details if available
      if (tokenData.seller_address) {
        const shortenedAddress = tokenData.seller_address.substring(0, 6) + '...' + 
                               tokenData.seller_address.substring(tokenData.seller_address.length - 4);
        embed.fields.push({ 
          name: 'Seller', 
          value: shortenedAddress, 
          inline: true 
        });
      }
      
      if (tokenData.tx_signature) {
        embed.fields.push({ 
          name: 'Transaction', 
          value: `[View on Explorer](https://solscan.io/tx/${tokenData.tx_signature})`, 
          inline: true 
        });
      }
      
      // Send the notification
      await webhook.sendEmbed(embed);
      logApi.info(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.green}Sent token sale notification for ${tokenData.token_symbol || tokenData.token_address}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.brightCyan}[Discord]${fancyColors.RESET} ${fancyColors.red}Failed to send token sale notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Send a test notification to verify webhook configuration
   * @param {string} channel - The webhook channel to test
   * @param {string} message - Optional test message
   */
  async sendTestNotification(channel, message = 'This is a test notification from DegenDuel platform.') {
    if (!this.webhooks[channel]) {
      throw new Error(`No webhook configured for channel: ${channel}`);
    }
    
    const embed = this.webhooks[channel].createInfoEmbed(
      '🧪 Test Notification',
      message
    );
    
    embed.fields = [
      { name: 'Environment', value: config.getEnvironment(), inline: true },
      { name: 'Timestamp', value: new Date().toLocaleString(), inline: true },
    ];
    
    const result = await this.webhooks[channel].sendEmbed(embed);
    return result;
  }
  
  /**
   * Format token amount with appropriate precision
   * @param {string|number} amount - The raw token amount
   * @param {number} decimals - The token decimals (default: 9)
   * @returns {string} Formatted token amount
   */
  formatTokenAmount(amount, decimals = 9) {
    if (!amount) return '0';
    
    try {
      // Convert to number
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      
      // Handle different decimal precision based on size
      if (numAmount >= 1000000) {
        // For large numbers, use M/B suffix
        return (numAmount / 1000000).toFixed(2) + 'M';
      } else if (numAmount >= 1000) {
        // For medium numbers, use K suffix
        return (numAmount / 1000).toFixed(2) + 'K';
      } else if (numAmount < 0.001) {
        // For very small amounts, show more decimals
        return numAmount.toFixed(Math.min(8, decimals));
      } else {
        // For regular amounts, show 2-4 decimals
        return numAmount.toFixed(Math.min(4, decimals));
      }
    } catch (error) {
      logApi.error(`Error formatting token amount: ${error.message}`);
      return amount.toString();
    }
  }
}

/**
 * Helper function to get a random congratulation message
 * @returns {string} A random congratulation message
 */
function getRandomCongratulation() {
  const congratulations = [
    "Way to go! 🎉",
    "Amazing progress! 🚀",
    "Keep crushing it! 💪",
    "You're on fire! 🔥",
    "Leveling up like a boss! 😎",
    "To the moon! 🌙",
    "Keep stacking those gains! 📈",
    "The grind pays off! 💯",
    "What a legend! 🏆",
    "Unstoppable! ⚡"
  ];
  
  return congratulations[Math.floor(Math.random() * congratulations.length)];
}

export default new DiscordNotificationService();