// services/discordNotificationService.js

/**
 * =============================================================================
 * IMPORTANT: Service Responsibilities Overview
 * -----------------------------------------------------------------------------
 * This service focuses SOLELY on sending outgoing messages to Discord channels
 * via pre-configured Webhooks. It does NOT log in as a bot and cannot manage
 * roles, send DMs, or handle user interactions.
 * For a detailed breakdown of responsibilities between this service and the
 * interactive bot service, please see:
 * ./DISCORD_SERVICES_OVERVIEW.md
 * =============================================================================
 */

/**
 * Discord Notification Service (webhooks)
 * 
 * @description This service is responsible for sending notifications to Discord.
 * It is used to send notifications to the Discord server for various events.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-04-27
 * @updated 2025-05-10
 */

// Service Suite
import { BaseService } from '../../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js';
import { SERVICE_EVENTS } from '../../utils/service-suite/service-events.js';
import DiscordWebhook from '../../utils/discord-webhook.js';
// Database
import prisma from '../../config/prisma.js';

// Config
import { discordConfig } from './discordConfig.js'; // Use the dedicated Discord config

// Import fancyColors from colors.js utility
import { fancyColors } from '../../utils/colors.js';

// This is a service-specific logger that writes to the database
//   TODO: Why do we only do this for the Discord Notification Service? 
//         Seems like a big missed opportunity to have our existing SINGLE logger (logApi).
import { logApi } from '../../utils/logger-suite/logger.js';
const logger = logApi.forService(SERVICE_NAMES.DISCORD_NOTIFICATION);

/**
 * Discord notification service for sending automated notifications to the DegenDuel Discord server via webhooks.
 * @extends BaseService
 */
class DiscordNotificationService extends BaseService {
  constructor() {
    // Check for webhook health every N seconds
    const checkIntervalSeconds = 60;

    // Initialize the service
    super({ 
      name: SERVICE_NAMES.DISCORD_NOTIFICATION,
      description: 'Discord webhook integration service',
      layer: 'INFRASTRUCTURE',
      criticalLevel: 'low',
      checkIntervalMs: checkIntervalSeconds * 1000, // Check for webhook health on a configurable interval
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        healthCheckIntervalMs: 30000,
        description: 'Discord notification service'
      }
    });
    
    // Use webhook URLs from the dedicated discordConfig
    this.webhookUrls = discordConfig.webhooks;
    
    // Initialize webhook clients
    this.webhooks = {};
    for (const [key, url] of Object.entries(this.webhookUrls)) {
      if (url) {
        this.webhooks[key] = new DiscordWebhook(url);
      }
    }
    
    // Set up event listeners
    this.setupEventListeners();
  }

  /**
   * Initialize the service
   * @returns {Promise<boolean>} - True if initialization was successful, false otherwise
   */
  async init() {
    try {
      // Get the service configuration from the database
      const serviceConfig = await prisma.service_configuration.findUnique({
        where: { service_name: this.name }
      });
      
      // Log the service configuration
      if (serviceConfig) {
        logger.info(`${fancyColors.CYAN}[Discord] ${fancyColors.YELLOW}Loading service configuration`, {
          eventType: 'service_init',
          details: { configFound: true }
        });
      } else {
        logger.info(`${fancyColors.CYAN}[Discord] ${fancyColors.YELLOW}No configuration found, using defaults`, {
          eventType: 'service_init',
          details: { configFound: false, usingDefaults: true }
        });
      }
      
      // Set the service as initialized
      this.initialized = true;
      return true;
    } catch (error) {
      // Log the initialization error
      logger.error(`${fancyColors.CYAN}[Discord] ${fancyColors.RED}Initialization error:`, {
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
    
    // Listen for system startup/shutdown events
    process.on('SIGTERM', () => this.sendServerShutdownNotification());
    process.on('SIGINT', () => this.sendServerShutdownNotification());

    //
    // (add more / better event listeners here)
    //

  }
  
  /**
   * Send server startup notification
   * This should be called during application initialization
   */
  async sendServerStartupNotification() {
    // Check if the system webhook is configured
    if (!this.webhooks.system) return;
    
    try { 
      // Create a success embed
      const embed = this.webhooks.system.createSuccessEmbed(
        '🚀 Server Started',
        'DegenDuel server has successfully started.'
      );
      
      // Add fields with system information
      embed.fields = [
        { name: 'Environment', value: process.env.NODE_ENV || 'development', inline: true },
        { name: 'Version', value: process.env.APP_VERSION || '1.0.0', inline: true },
        { name: 'Time', value: new Date().toLocaleString(), inline: true },
      ];
      
      // Send the embed to the system webhook
      await this.webhooks.system.sendEmbed(embed);
      logApi.info(`\x1b[96m[Discord]\x1b[0m \x1b[32mSent server startup notification\x1b[0m`);
    } catch (error) {
      // Log the error
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send server startup notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Send server shutdown notification
   * This is automatically called on SIGTERM and SIGINT signals
   */
  async sendServerShutdownNotification() {
    // Check if the system webhook is configured
    if (!this.webhooks.system) return;
    
    try {
      // Create an info embed
      const embed = this.webhooks.system.createInfoEmbed(
        '🔌 Server Shutting Down',
        'DegenDuel server is shutting down.'
      );
      
      // Add fields with system information
      embed.fields = [
        { name: 'Environment', value: process.env.NODE_ENV || 'development', inline: true },
        { name: 'Uptime', value: this.formatUptime(process.uptime()), inline: true },
        { name: 'Time', value: new Date().toLocaleString(), inline: true },
      ];
      
      // Send the embed to the system webhook
      await this.webhooks.system.sendEmbed(embed);
      logApi.info(`\x1b[96m[Discord]\x1b[0m \x1b[32mSent server shutdown notification\x1b[0m`);
    } catch (error) {
      // Log the error
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send server shutdown notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Required method for BaseService operation
   * This gets called regularly by the BaseService to perform the service's main operation
   * and is used for circuit breaker recovery
   */
  async onPerformOperation() {
    // For the Discord service, we just need to check if our webhook configs are valid
    // No continuous operation needed - we just respond to events
    
    // Check if any webhooks are configured
    const hasWebhooks = Object.values(this.webhooks).some(webhook => webhook !== undefined);
    // Count configured webhooks
    const webhookCount = Object.values(this.webhooks).filter(webhook => webhook !== undefined).length;
    
    try {      
      // Log the start time
      const startTime = Date.now();
      
      // (moved before try block for now)
      // Check if any webhooks are configured
      //const hasWebhooks = Object.values(this.webhooks).some(webhook => webhook !== undefined);
      // Count configured webhooks
      //const webhookCount = Object.values(this.webhooks).filter(webhook => webhook !== undefined).length;
      
      // Create formatted log tag for Discord service
      const formatLog = {
        tag: () => `${fancyColors.CYAN}[Discord]${fancyColors.RESET}`,
        success: (text) => `${fancyColors.GREEN}${text}${fancyColors.RESET}`,
        warning: (text) => `${fancyColors.YELLOW}${text}${fancyColors.RESET}`,
        error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
      };
      
      // Check if any webhooks are configured
      if (!hasWebhooks) {
        // Log the warning that no websockets are configured
        logger.warn(`${formatLog.tag()} ${formatLog.warning('No webhooks configured')}`, {
          eventType: 'service_health_check',
          details: {
            hasWebhooks: false,
            webhookCount: 0
          }
        });
      } else {
        // Log the successful webhook check
        logger.debug(`${formatLog.tag()} ${formatLog.success('Webhook check successful')}`, {
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
      
      // Log the end time
      const endTime = Date.now();
      
      // Log performance metrics with proper formatting
      logger.info(`${formatLog.tag()} ${formatLog.success('Service operation completed')}`, {
        eventType: 'service_heartbeat',
        durationMs: endTime - startTime,
        details: {
          operation: 'webhook_health_check',
          webhookCount,
          circuitBreakerStatus: this.stats.circuitBreaker.isOpen ? 'open' : 'closed'
        }
      });
      
      // Return true to indicate success
      return true;
    } catch (error) {
      // Log the error
      const formatLog = {
        tag: () => `${fancyColors.CYAN}[Discord]${fancyColors.RESET}`,
        error: (text) => `${fancyColors.RED}${text}${fancyColors.RESET}`,
      };
      
      // Log the error
      logger.error(`${formatLog.tag()} ${formatLog.error('Perform operation error:')}`, {
        eventType: 'service_operation_error',
        error,
        details: {
          errorMessage: error.message,
          errorName: error.name,
          errorStack: error.stack
        }
      });
      
      // Re-throw to trigger circuit breaker
      throw error;
    }
  }

  /**
   * Handle contest creation events
   * @param {Object} contestData - Contest data
   */
  async onContestCreated(contestData) {
    // Use the 'duels' webhook for contest creation
    if (!this.webhooks.duels) return;
    
    try {
      // Log the incoming contest data
      logger.info(`${fancyColors.CYAN}[Discord] ${fancyColors.BLUE}Received contest creation event`, {
        eventType: 'contest_created',
        relatedEntity: contestData.contest_code,
        details: {
          contestId: contestData.id,
          contestName: contestData.name,
          startTime: contestData.start_time,
          prizePool: contestData.prize_pool,
          status: contestData.status
        }
      });
      
      // Calculate time until contest starts for better messaging
      const now = new Date();
      const startTime = new Date(contestData.start_time);
      const timeUntilStart = startTime - now;
      const hoursUntilStart = Math.max(0, Math.round(timeUntilStart / (1000 * 60 * 60) * 10) / 10);
      
      // Set variables based on contest state
      let title, actionMessage, embedColor, statusEmoji;
      
      // Configure notification based on contest state
      switch (contestData.status) {

        // 1. PENDING
        //   - Contest is pending, meaning it's waiting to start
        //   - This is the initial state when the contest is created
        //   - Users may still join the contest before it starts
        case 'pending':
          // Set the title and embed color
          title = `🎮 NEW: ${contestData.name}`;
          embedColor = 0x00bfff; // Deep Sky Blue for pending
          statusEmoji = '⏳';
          
          // Time-based messaging for pending contests
          if (hoursUntilStart <= 1) {
            actionMessage = `**Starting soon!** Join now to secure your spot in this exciting contest!`;
          } else if (hoursUntilStart <= 24) {
            actionMessage = `**Starting in ${hoursUntilStart} hours!** Join now to compete and win rewards!`;
          } else {
            actionMessage = `Join now to compete and win rewards! Contest starts on ${startTime.toLocaleDateString()}.`;
          }
          break;
          
        // 2. ACTIVE
        //   - Contest changes from 'pending' to 'active' when it starts
        //   - This is the state when the contest is UNDERWAY! Entrants are competing; non-entrants are spectating
        //   - At this point, it is too late for new entrants to join the contest
        case 'active':
          // Set the title and embed color
          title = `🟢 STARTING NOW: ${contestData.name}`;
          actionMessage = `**Contest is LIVE!** If you entered, you may now take your seat and start making moves. \n\nSpectators are welcome to watch the action.`;
          embedColor = 0x00ff00; // Green for active
          statusEmoji = '🟢';
          break;
        
        // 3. COMPLETED
        //   - Contest changes from 'active' to 'completed' when it ends and winners have been determined
        //   - This is the state when the contest is OVER! It started, entrants competed to the bitter end, and now the results are final
        //   - Final portfolio ranks are now frozen and the contest results are final. Payouts are to be distributed to winners within minutes
        case 'completed':
          // Set the title and embed color
          title = `🏁 FINISHED: ${contestData.name}`;
          actionMessage = `**Contest has ended!** View the results and winners.`;
          embedColor = 0xffd700; // Gold for completed
          statusEmoji = '🏁';
          break;
          
        // 4. CANCELLED
        //   - Contest changes from 'active' to 'cancelled' when it is cancelled before it starts
        //   - This is the state when the contest is cancelled before it starts
        //   - Entry fees are to be refunded to entrants of cancelled contests within minutes
        //   --  The most common reason for cancellations is the contest minimum entrant count not being met by the scheduled contest start time (very slight leeway is quietly given; ~90 seconds)
        case 'cancelled':
          // Set the title and embed color
          title = `❌ CANCELLED: ${contestData.name}`;
          actionMessage = `**Bad news:** This contest was just cancelled. Darn! \n\n**Good news:** All entrants will be automatically refunded within a few minutes.`;
          embedColor = 0xff0000; // Red for cancelled
          statusEmoji = '❌';
          break;
          
        // 5. UNKNOWN
        //   - This is the default state when the contest status is not known
        //   - This is the state when the contest is unknown or not yet started
        //default:
        //  title = `🎮 UPDATE: ${contestData.name}`;
        //  actionMessage = `Contest status update.`;
        //  embedColor = 0x808080; // Gray for unknown
        //  statusEmoji = '❓';
      
      }
      
      // Create a rich embed with enhanced visual appeal
      const embed = {
        title: title,
        description: `Crypto trading contest with a prize pool of **${contestData.prize_pool} SOL**!\n\n${actionMessage}`,
        color: embedColor,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'DegenDuel Platform',
          icon_url: 'https://degenduel.me/assets/images/logo.png'
        },
        fields: [
          { name: 'Contest Code', value: contestData.contest_code, inline: true }, // (not super important, tbh...)
          { name: 'Start Time', value: startTime.toLocaleString(), inline: true }, // Very important, but where is duration?
          { name: 'Prize Pool', value: `${contestData.prize_pool} SOL`, inline: true }, // Very important, but where is max participants?
          { name: 'Entry Fee', value: `${contestData.entry_fee} SOL`, inline: true } // Very important
        ]
      };
      
      // Add status field with appropriate emoji
      embed.fields.push({ 
        name: 'Status', 
        value: `${statusEmoji} ${contestData.status.charAt(0).toUpperCase() + contestData.status.slice(1)}`, 
        inline: true 
      });
      
      // Add contest image

      // Ideally, get the image from the contest data
      if (contestData.image_url) {
        // Ensure the imageUrl is an absolute URL
        const baseUrl = process.env.BASE_URL || 'https://degenduel.me';
        const fullImageUrl = contestData.image_url.startsWith('http') 
          ? contestData.image_url 
          : `${baseUrl}${contestData.image_url}`;
        
        // Use the image field for larger images
        embed.image = {
          url: fullImageUrl
        };
      // If no image is available, use a placeholder image
      } else {
        // Use some default placeholder image
        embed.thumbnail = {
          url: 'https://degenduel.me/assets/images/logo.png'
        };
      }
      
      // Create action buttons based on contest state
      const contestUrl = `https://degenduel.me/contests/${contestData.id}`;
      
      // Create button components appropriate for the contest state
      const components = [
        {
          type: 1, // Action Row
          components: [
            {
              type: 2, // Button
              style: 5, // Link style
              label: 'Duel Details',
              url: contestUrl
            }
          ]
        }
      ];
      
      // Add state-specific buttons
      switch (contestData.status) {
        case 'pending':
          // For pending contests, add entry and calendar buttons
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Enter Duel',
            url: `${contestUrl}?action=join`
          });
          
          // Add a button to add the contest to the user's calendar
          // (do we eveN have such an endpoint? eh, whatever)
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Add to Calendar',
            url: `https://degenduel.me/contests/${contestData.id}/calendar`
          });
          break;
          
        case 'active':
          // For active contests, add leaderboard button
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Leaderboard',
            url: `${contestUrl}?tab=leaderboard`
          });
          
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Duel Now',
            url: `${contestUrl}?tab=trading`
          });
          break;
          
        case 'completed':
          // For completed contests, add results and history buttons
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Duel Results',
            url: `${contestUrl}?tab=results`
          });
          
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Trade History',
            url: `${contestUrl}?tab=history`
          });
          break;
          
        case 'cancelled':
          // For cancelled contests, add refund status button
          components[0].components.push({
            type: 2, // Button
            style: 5, // Link style
            label: 'Refund Status',
            url: `${contestUrl}?tab=refunds`
          });
          break;
      }
      
      // Send the embed and components to the contests webhook
      const requestStartTime = Date.now();
      await this.webhooks.duels.sendEmbed(embed, components);
      const requestEndTime = Date.now();
      
      // Log successful notification with performance metrics
      logger.info(`${fancyColors.CYAN}[Discord] ${fancyColors.GREEN}Sent enhanced contest notification`, {
        eventType: 'webhook_sent',
        relatedEntity: contestData.contest_code,
        durationMs: requestEndTime - requestStartTime,
        details: {
          contestId: contestData.id,
          contestStatus: contestData.status,
          webhookType: 'duels',
          notificationType: 'contest_creation',
          hasImage: !!contestData.image_url,
          hasButtons: true
        }
      });
    } catch (error) {
      // Log the error with appropriate context
      logger.error(`${fancyColors.CYAN}[Discord] ${fancyColors.RED}Failed to send contest notification:`, {
        eventType: 'webhook_error',
        relatedEntity: contestData.contest_code,
        error,
        details: {
          contestId: contestData.id,
          webhookType: 'duels',
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
    
    // Create a rich embed with enhanced visual appeal
    //   (I just made half of these up, tbh)
    const embed = {
      title: `⚠️ System Alert: ${alertData.title}`,
      description: alertData.message,
      color: 0xFF0000, // Red color for error
      timestamp: new Date().toISOString(),
      thumbnail: {
        url: 'https://degenduel.me/assets/images/logo.png'
      },
      image: {
        url: 'https://degenduel.me/assets/images/logo.png'
      },
      footer: {
        text: 'DegenDuel',
        icon_url: 'https://degenduel.me/assets/images/logo.png'
      },
      fields: []
    };
    
    // Add details to the embed if available
    if (alertData.fields) {
      embed.fields = alertData.fields;
    }
    
    // Send the embed to the alerts webhook
    await this.webhooks.alerts.sendEmbed(embed);
    // Log the success
    logApi.info(`\x1b[96m[Discord]\x1b[0m \x1b[32mSent system alert notification\x1b[0m`);
  } catch (error) {
    // Log the error
    logApi.error(`\x1b[96m[Discord]\x1b[0m \x1b[31mFailed to send system alert: ${error.message}\x1b[0m`);
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
      logApi.info(`\x1b[96m[Discord]\x1b[0m \x1b[32mSent service status notification\x1b[0m`);
    } catch (error) {
      logApi.error(`\x1b[96m[Discord]\x1b[0m \x1b[31mFailed to send service status notification: ${error.message}\x1b[0m`);
    }
  }

  /**
   * Handle contest activity events
   * @param {Object} activityData - Contest activity data
   */
  async onContestActivity(activityData) {
    // Use the 'duels' webhook for contest activity
    if (!this.webhooks.duels) return;
    
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
        
        const embed = this.webhooks.duels.createInfoEmbed(
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
        
        await this.webhooks.duels.sendEmbed(embed);
        logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent contest join notification${fancyColors.RESET}`);
      }
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send contest activity notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle contest completion events with winner announcements
   * @param {Object} completionData - Contest completion data including winners
   */
  async onContestCompleted(completionData) {
    // Use the 'duels' webhook for contest completion
    if (!this.webhooks.duels) return;
    
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
      await this.webhooks.duels.sendEmbed(embed);
      
      // Log success
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent contest completion notification for contest #${completionData.contest_id}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send contest completion notification:${fancyColors.RESET}`, error);
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
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent large transaction notification${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send transaction notification:${fancyColors.RESET}`, error);
    }
  }

  /**
   * Handle user achievement events
   * @param {Object} achievementData - Achievement data
   */
  async onUserAchievement(achievementData) {
    // Send achievements to the main chat?
    if (!this.webhooks.mainChat) return;
    
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
      await this.webhooks.mainChat.sendEmbed(embed);
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent achievement notification for user ${achievementData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send achievement notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle user level up events
   * @param {Object} levelData - Level up data
   */
  async onUserLevelUp(levelData) {
    // Send level ups to the main chat?
    if (!this.webhooks.mainChat) return;
    
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
      await this.webhooks.mainChat.sendEmbed(embed);
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent level up notification for user ${levelData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send level up notification:${fancyColors.RESET}`, error);
    }
  }
  
  /**
   * Handle general user milestone events
   * @param {Object} milestoneData - Milestone data
   */
  async onUserMilestone(milestoneData) {
    // Send milestones to the main chat?
    if (!this.webhooks.mainChat) return;
    
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
      await this.webhooks.mainChat.sendEmbed(embed);
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent milestone notification for user ${milestoneData.user_name}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send milestone notification:${fancyColors.RESET}`, error);
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
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent token purchase notification for ${tokenData.token_symbol || tokenData.token_address}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send token purchase notification:${fancyColors.RESET}`, error);
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
      logApi.info(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.GREEN}Sent token sale notification for ${tokenData.token_symbol || tokenData.token_address}${fancyColors.RESET}`);
    } catch (error) {
      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send token sale notification:${fancyColors.RESET}`, error);
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
  
  /**
   * Format uptime in seconds to a human-readable string
   * @param {number} uptimeSeconds - Uptime in seconds
   * @returns {string} Formatted uptime string (e.g., "2d 5h 30m 10s")
   */
  formatUptime(uptimeSeconds) {
    if (!uptimeSeconds || isNaN(uptimeSeconds)) return 'Unknown';
    
    try {
      const days = Math.floor(uptimeSeconds / 86400);
      const hours = Math.floor((uptimeSeconds % 86400) / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = Math.floor(uptimeSeconds % 60);
      
      const parts = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0) parts.push(`${minutes}m`);
      if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
      
      return parts.join(' ');
    } catch (error) {
      logApi.error(`Error formatting uptime: ${error.message}`);
      return `${Math.floor(uptimeSeconds)}s`;
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

// Export the Discord Notification Service as a singleton
export default new DiscordNotificationService();
