// services/discord/discord-interactive-service.js

/**
 * =============================================================================
 * IMPORTANT: Service Responsibilities Overview
 * -----------------------------------------------------------------------------
 * This service acts as the primary Discord Bot, handling user interactions,
 * role management, DMs, and orchestrating certain event-driven notifications.
 * For a detailed breakdown of responsibilities between this service and the
 * webhook-based notification service, please see:
 * ./DISCORD_SERVICES_OVERVIEW.md
 * =============================================================================
 */

/**
 * Discord Interactive Service (Discord Bot)
 * 
 * @description This service is responsible for sending interactive notifications to 
 * the Discord server via the DegenDuel AI Discord bot for various events.
 * 
 * @author BranchManager69
 * @version 2.1.0
 * @created 2025-04-26
 * @updated 2025-05-10
 */

import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { BaseService } from '../../utils/service-suite/base-service.js';
//import { SERVICE_LAYERS } from '../../utils/service-suite/service-constants.js'; // currently unused but really should be used
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js'; 
import serviceEvents from '../../utils/service-suite/service-events.js';
import prisma from '../../config/prisma.js';
import { discordConfig } from './discordConfig.js'; // Import the new Discord config
import discordNotificationService from './discordNotificationService.js'; // Import the webhook service

// Config
import config from '../../config/config.js';

/**
 * @class DiscordInteractiveService
 * @extends BaseService
 * @description Interactive Discord bot for rich notifications
 */
class DiscordInteractiveService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAMES.DISCORD_INTERACTIVE,
      description: 'Interactive Discord bot for rich notifications',
      layer: 'INFRASTRUCTURE',
      criticalLevel: 'low',
      checkIntervalMs: 60000
    });

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
      ]
    });

    // Use channel IDs from config
    this.channelIds = {
      contests: config.discord.channel_ids.contests,
      trades: config.discord.channel_ids.trades,
      announcements: config.discord.channel_ids.announcements,
      // Fix quotes in environment variables
      bigNews: config.discord.channel_ids.big_news?.replace(/"/g, ''),
      help: config.discord.channel_ids.help?.replace(/"/g, ''),
      devYap: config.discord.channel_ids.dev_yap?.replace(/"/g, '')
    };

    // Track active contests for interaction state
    this.activeContests = new Map();

    // Set up event listeners
    this.setupEventListeners();
  }

  async initialize() {
    try {
      const botToken = config.discord.bot.token;
      if (!botToken) {
        logApi.error('No Discord bot token found in configuration!');
        return false;
      }
      
      // Log channel configuration for debugging
      logApi.info(`Discord channel configuration:`, {
        contests: this.channelIds.contests,
        trades: this.channelIds.trades,
        announcements: this.channelIds.announcements
      });
      
      // Initialize Discord client
      await this.client.login(botToken);

      // Set up interaction handling
      this.setupInteractionHandlers();

      logApi.info(`Discord Interactive Bot connected as ${this.client.user.tag}`);
      
      // List servers the bot is in
      const guilds = this.client.guilds.cache;
      logApi.info(`Bot is in ${guilds.size} Discord servers: ${[...guilds.values()].map(g => g.name).join(', ')}`);
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      logApi.error('Discord Interactive Bot initialization failed:', error);
      logApi.error(`Error details: ${error.message}`, {
        code: error.code,
        httpStatus: error.httpStatus
      });
      return false;
    }
  }

  setupEventListeners() {
    // Listen for contest creation
    serviceEvents.on('contest:created', this.handleContestCreated.bind(this));

    // Listen for contest state changes
    serviceEvents.on('contest:started', this.handleContestStarted.bind(this));
    serviceEvents.on('contest:completed', this.handleContestCompleted.bind(this));

    // Listen for token price movements
    serviceEvents.on('token:pump', this.handleTokenPump.bind(this));

    // --- Listen for Privilege Changes ---
    serviceEvents.on('privilege:granted', this.onPrivilegeGranted.bind(this));
    serviceEvents.on('privilege:revoked', this.onPrivilegeRevoked.bind(this));

    // Debug log to confirm subscription
    logApi.info(`[Discord] Set up event listeners including privilege:granted and privilege:revoked events`);
  }

  setupInteractionHandlers() {
    this.client.on('interactionCreate', async interaction => {
      try {
        if (!interaction.isButton()) return;

        const [action, id] = interaction.customId.split(':');

        switch(action) {
          case 'join_contest':
            await this.handleJoinContestButton(interaction, id);
            break;
          case 'view_details':
            await this.handleViewDetailsButton(interaction, id);
            break;
          case 'view_leaderboard':
            await this.handleViewLeaderboardButton(interaction, id);
            break;
          case 'track_token':
            await this.handleTrackTokenButton(interaction, id);
            break;
          default:
            await interaction.reply({
              content: 'This button functionality is not implemented yet.',
              ephemeral: true
            });
        }
      } catch (error) {
        logApi.error('Error handling Discord interaction:', error);

        // Respond to user so they're not left hanging
        try {
          await interaction.reply({
            content: 'Sorry, something went wrong processing this action.',
            ephemeral: true
          });
        } catch (replyError) {
          // Ignore this error, likely from interaction timing out
        }
      }
    });
  }

  async handleContestCreated(contestData) {
    if (!this.channelIds.contests) {
      logApi.error(`No contests channel ID configured. Current config: ${JSON.stringify(this.channelIds)}`);
      return;
    }

    try {
      logApi.info(`Attempting to fetch channel with ID: ${this.channelIds.contests}`);
      console.log(`Bot authenticated as: ${this.client.user.tag}`);
      console.log(`Bot permissions:`, this.client.user.flags?.toArray() || 'No flags');
      
      const channel = await this.client.channels.fetch(this.channelIds.contests);
      
      // Track this contest
      this.activeContests.set(contestData.id.toString(), {
        contestCode: contestData.contest_code,
        name: contestData.name,
        startTime: contestData.start_time,
        prizePool: contestData.prize_pool,
        status: 'created'
      });

      // Create a rich embed
      const embed = new EmbedBuilder()
        .setTitle(`🎮 New Contest: ${contestData.name}`)
        .setDescription(`A new contest has been created with a prize pool of ${contestData.prize_pool} SOL!`)
        .setColor(0x00bfff) // Deep sky blue
        .addFields(
          { name: 'Contest Code', value: contestData.contest_code, inline: true },
          { name: 'Start Time', value: new Date(contestData.start_time).toLocaleString(), inline: true },
          { name: 'Prize Pool', value: `${contestData.prize_pool} SOL`, inline: true },
          { name: 'Entry Fee', value: `${contestData.entry_fee} SOL`, inline: true },
          { name: 'Status', value: 'Accepting Entries', inline: true }
        )
        .setFooter({ text: 'DegenDuel Platform', iconURL: 'https://degenduel.me/assets/images/logo.png' })
        .setTimestamp();

      // Create interactive buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Join Contest')
            .setCustomId(`join_contest:${contestData.id}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('View Details')
            .setCustomId(`view_details:${contestData.id}`)
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setLabel('Open in App')
            .setURL(`https://degenduel.me/contests/${contestData.id}`)
            .setStyle(ButtonStyle.Link)
        );

      await channel.send({ embeds: [embed], components: [row] });
      logApi.info(`Sent interactive contest creation notification for ${contestData.name}`);
    } catch (error) {
      // More detailed error logging
      logApi.error(`Failed to send contest creation notification:`, {
        error: error.message,
        code: error.code,
        status: error.status,
        httpStatus: error.httpStatus,
        channelId: this.channelIds.contests,
        botId: this.client.user?.id,
        requestBody: error.requestBody || {},
        stack: error.stack
      });
      
      // If it's a permissions issue, log more specific info
      if (error.code === 50001) { // Missing Access error
        logApi.error(`Discord bot missing permissions! Please check that the bot has been invited to the channel and has proper permissions.`);
        
        // Attempt to get guild (server) info
        try {
          const guilds = this.client.guilds.cache;
          logApi.info(`Bot is in ${guilds.size} servers: ${[...guilds.values()].map(g => g.name).join(', ')}`);
          
          for (const guild of guilds.values()) {
            const botMember = guild.members.cache.get(this.client.user.id);
            if (botMember) {
              logApi.info(`Bot permissions in ${guild.name}: ${botMember.permissions.toArray().join(', ')}`);
            }
          }
        } catch (guildError) {
          logApi.error(`Could not fetch guild info: ${guildError.message}`);
        }
      }
    }
  }

  async handleContestStarted(contestData) {
    if (!this.channelIds.contests) return;

    try {
      // Update contest tracking
      if (this.activeContests.has(contestData.id.toString())) {
        const contestInfo = this.activeContests.get(contestData.id.toString());
        contestInfo.status = 'in_progress';
        this.activeContests.set(contestData.id.toString(), contestInfo);
      }

      const channel = await this.client.channels.fetch(this.channelIds.contests);

      // Create contest started embed
      const embed = new EmbedBuilder()
        .setTitle(`🚀 Contest Started: ${contestData.name}`)
        .setDescription(`Contest **${contestData.name}** has officially started with ${contestData.participant_count} participants!`)
        .setColor(0x00ff00) // Green
        .addFields(
          { name: 'Participants', value: `${contestData.participant_count}`, inline: true },
          { name: 'Prize Pool', value: `${contestData.prize_pool} SOL`, inline: true },
          { name: 'Duration', value: contestData.duration || 'In Progress', inline: true }
        )
        .setTimestamp();

      // Create interactive buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('View Leaderboard')
            .setCustomId(`view_leaderboard:${contestData.id}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('Open in App')
            .setURL(`https://degenduel.me/contests/${contestData.id}`)
            .setStyle(ButtonStyle.Link)
        );

      await channel.send({ embeds: [embed], components: [row] });
      logApi.info(`Sent interactive contest started notification for ${contestData.name}`);
    } catch (error) {
      logApi.error('Failed to send contest started notification:', error);
    }
  }

  async handleContestCompleted(contestData) {
    if (!this.channelIds.contests) return;

    try {
      // Remove from active contests
      this.activeContests.delete(contestData.id.toString());

      const channel = await this.client.channels.fetch(this.channelIds.contests);

      // Get medal emojis for the top 3 places
      const medalEmojis = {
        1: '🥇', // 1st place - gold medal
        2: '🥈', // 2nd place - silver medal
        3: '🥉'  // 3rd place - bronze medal
      };

      // Create winner fields
      const winnerFields = [];
      if (contestData.winners && contestData.winners.length > 0) {
        contestData.winners.forEach(winner => {
          const medal = medalEmojis[winner.place] || `${winner.place}`;
          winnerFields.push({
            name: `${medal} ${winner.display_name}`,
            value: `Prize: ${winner.prize_amount} SOL`,
            inline: true
          });
        });
      }

      // Create a rich embed
      const embed = new EmbedBuilder()
        .setTitle(`🏆 Contest Completed: ${contestData.contest_name}`)
        .setDescription(`Contest **${contestData.contest_name}** has ended with **${contestData.participant_count}** participants!`)
        .setColor(0xffd700) // Gold
        .addFields(
          { name: 'Contest Code', value: contestData.contest_code, inline: true },
          { name: 'Prize Pool', value: `${contestData.prize_pool} SOL`, inline: true },
          { name: 'Participants', value: contestData.participant_count.toString(), inline: true }
        )
        .setTimestamp();

      // Add duration if available
      if (contestData.start_time && contestData.end_time) {
        const startTime = new Date(contestData.start_time);
        const endTime = new Date(contestData.end_time);
        const durationHours = Math.round((endTime - startTime) / (1000 * 60 * 60) * 10) / 10;

        embed.addFields({
          name: 'Duration',
          value: `${durationHours} hours`,
          inline: true
        });
      }

      // Add winners section header
      if (winnerFields.length > 0) {
        embed.addFields({
          name: '🏆 Winners',
          value: '━━━━━━━━━━━━━━━━━━━━━━━',
          inline: false
        });

        // Add each winner field
        embed.addFields(...winnerFields);
      }

      // Create button to link to the contest
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('View Contest Results')
            .setURL(`https://degenduel.me/contests/${contestData.id}`)
            .setStyle(ButtonStyle.Link)
        );

      await channel.send({ embeds: [embed], components: [row] });
      logApi.info(`Sent interactive contest completion notification for ${contestData.contest_name}`);
    } catch (error) {
      logApi.error('Failed to send contest completion notification:', error);
    }
  }

  async handleTokenPump(tokenData) {
    if (!this.channelIds.trades) return;

    try {
      const channel = await this.client.channels.fetch(this.channelIds.trades);

      // Create token pump notification with progress bar
      const percentIncrease = tokenData.change_24h || 0;
      const progressBar = this.createProgressBar(percentIncrease, 100);

      const embed = new EmbedBuilder()
        .setTitle(`🚀 ${tokenData.symbol} is pumping!`)
        .setDescription(`**${tokenData.name}** has increased by **${percentIncrease.toFixed(2)}%** in the last 24 hours.\n\n${progressBar}`)
        .setColor(0x00ff00) // Green
        .addFields(
          { name: 'Current Price', value: `$${tokenData.price.toFixed(6)}`, inline: true },
          { name: 'Market Cap', value: tokenData.market_cap ? `$${this.formatNumber(tokenData.market_cap)}` : 'Unknown', inline: true },
          { name: 'Volume 24h', value: tokenData.volume_24h ? `$${this.formatNumber(tokenData.volume_24h)}` : 'Unknown', inline: true }
        );

      // Add token image if available
      if (tokenData.image_url) {
        embed.setThumbnail(tokenData.image_url);
      }

      // Add time-based notification about when this pump occurred
      const timestamp = Math.floor(Date.now() / 1000);
      embed.setFooter({
        text: `DegenDuel Market Data`,
        iconURL: 'https://degenduel.me/assets/images/logo.png'
      });
      embed.setTimestamp();

      // Add social info if available
      if (tokenData.socials && Object.keys(tokenData.socials).length > 0) {
        let socialLinks = '';

        if (tokenData.socials.twitter) {
          socialLinks += `[Twitter](${tokenData.socials.twitter}) • `;
        }

        if (tokenData.socials.telegram) {
          socialLinks += `[Telegram](${tokenData.socials.telegram}) • `;
        }

        if (tokenData.socials.website) {
          socialLinks += `[Website](${tokenData.socials.website})`;
        }

        if (socialLinks) {
          embed.addFields({ name: 'Social Links', value: socialLinks, inline: false });
        }
      }

      // Create interactive buttons
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Track Token')
            .setCustomId(`track_token:${tokenData.address}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('View Chart')
            .setURL(`https://birdeye.so/token/${tokenData.address}?chain=solana`)
            .setStyle(ButtonStyle.Link),
          new ButtonBuilder()
            .setLabel('Trade Now')
            .setURL(`https://jup.ag/swap/SOL-${tokenData.address}`)
            .setStyle(ButtonStyle.Link)
        );

      await channel.send({ embeds: [embed], components: [row] });
      logApi.info(`Sent interactive token pump notification for ${tokenData.symbol}`);
    } catch (error) {
      logApi.error('Failed to send token pump notification:', error);
    }
  }

  // Button handler methods
  async handleJoinContestButton(interaction, contestId) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get contest info
      const contest = await prisma.contests.findUnique({
        where: { id: parseInt(contestId) }
      });

      if (!contest) {
        return await interaction.editReply("Contest not found or no longer available.");
      }

      // Create deep link to join contest
      const joinUrl = `https://degenduel.me/contests/${contestId}?action=join`;

      await interaction.editReply({
        content: `To join the "${contest.name}" contest, click the link below:`,
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('Join Contest in App')
                .setURL(joinUrl)
                .setStyle(ButtonStyle.Link)
            )
        ]
      });
    } catch (error) {
      logApi.error('Error handling join contest button:', error);
      await interaction.editReply("Sorry, there was an error processing your request.");
    }
  }

  async handleViewDetailsButton(interaction, contestId) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get contest details with participants
      const contest = await prisma.contests.findUnique({
        where: { id: parseInt(contestId) },
        include: {
          contest_participants: {
            select: {
              id: true,
              user: {
                select: {
                  display_name: true
                }
              }
            }
          }
        }
      });

      if (!contest) {
        return await interaction.editReply("Contest not found or no longer available.");
      }

      // Format start time
      const startTime = new Date(contest.start_time);
      const formattedTime = `<t:${Math.floor(startTime.getTime() / 1000)}:F>`;

      // Format participant list
      const participantCount = contest.contest_participants.length;
      let participantList = '';

      if (participantCount > 0) {
        const participants = contest.contest_participants
          .slice(0, 10)
          .map(p => p.user.display_name || 'Anonymous')
          .join('\n• ');

        participantList = `• ${participants}${participantCount > 10 ? `\n...and ${participantCount - 10} more` : ''}`;
      } else {
        participantList = 'No participants yet';
      }

      // Create detailed embed
      const embed = new EmbedBuilder()
        .setTitle(`Contest Details: ${contest.name}`)
        .setDescription(contest.description || 'No description provided')
        .setColor(0x0099ff) // Blue
        .addFields(
          { name: 'Contest Code', value: contest.contest_code, inline: true },
          { name: 'Start Time', value: formattedTime, inline: true },
          { name: 'Prize Pool', value: `${contest.prize_pool} SOL`, inline: true },
          { name: 'Entry Fee', value: `${contest.entry_fee} SOL`, inline: true },
          { name: 'Participants', value: participantCount.toString(), inline: true },
          { name: 'Status', value: contest.status, inline: true },
          { name: 'Current Participants', value: participantList, inline: false }
        );

      await interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('Open Contest in App')
                .setURL(`https://degenduel.me/contests/${contestId}`)
                .setStyle(ButtonStyle.Link)
            )
        ]
      });
    } catch (error) {
      logApi.error('Error handling view details button:', error);
      await interaction.editReply("Sorry, there was an error fetching contest details.");
    }
  }

  async handleViewLeaderboardButton(interaction, contestId) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get contest with participant scores
      const contest = await prisma.contests.findUnique({
        where: { id: parseInt(contestId) },
        include: {
          contest_participants: {
            select: {
              id: true,
              current_score: true,
              rank: true,
              user: {
                select: {
                  display_name: true
                }
              }
            },
            orderBy: {
              rank: 'asc'
            },
            take: 10
          }
        }
      });

      if (!contest) {
        return await interaction.editReply("Contest not found or no longer available.");
      }

      // Generate markdown table for leaderboard
      let leaderboardTable = "```\n| Rank | Player | Score |\n|------|--------|-------|\n";

      if (contest.contest_participants.length > 0) {
        contest.contest_participants.forEach(participant => {
          const rank = participant.rank || '?';
          const name = (participant.user?.display_name || 'Anonymous').substring(0, 15);
          const score = participant.current_score?.toFixed(2) || '0.00';

          leaderboardTable += `| ${rank.toString().padEnd(4)} | ${name.padEnd(15)} | ${score.padEnd(6)} |\n`;
        });
      } else {
        leaderboardTable += "| - | No participants yet | - |\n";
      }

      leaderboardTable += "```";

      // Create leaderboard embed
      const embed = new EmbedBuilder()
        .setTitle(`Leaderboard: ${contest.name}`)
        .setDescription(`Current standings for contest #${contestId}:\n\n${leaderboardTable}`)
        .setColor(0xffd700) // Gold
        .setFooter({
          text: 'Last updated',
          iconURL: 'https://degenduel.me/assets/images/logo.png'
        })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('View Full Leaderboard')
                .setURL(`https://degenduel.me/contests/${contestId}?tab=leaderboard`)
                .setStyle(ButtonStyle.Link)
            )
        ]
      });
    } catch (error) {
      logApi.error('Error handling view leaderboard button:', error);
      await interaction.editReply("Sorry, there was an error fetching the leaderboard.");
    }
  }

  async handleTrackTokenButton(interaction, tokenAddress) {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Look up token details
      const token = await prisma.tokens.findFirst({
        where: { address: tokenAddress },
        include: {
          token_prices: true
        }
      });

      if (!token) {
        return await interaction.editReply("Token not found in our database.");
      }

      // Create deep link to token in app
      const tokenUrl = `https://degenduel.me/tokens/${tokenAddress}`;

      await interaction.editReply({
        content: `You're now tracking ${token.name} (${token.symbol})!\n\nCurrent price: $${parseFloat(token.token_prices?.price || 0).toFixed(6)}`,
        components: [
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setLabel('View in App')
                .setURL(tokenUrl)
                .setStyle(ButtonStyle.Link),
              new ButtonBuilder()
                .setLabel('Trade Now')
                .setURL(`https://jup.ag/swap/SOL-${tokenAddress}`)
                .setStyle(ButtonStyle.Link)
            )
        ]
      });

      // Could actually track this in database if desired
    } catch (error) {
      logApi.error('Error handling track token button:', error);
      await interaction.editReply("Sorry, there was an error tracking this token.");
    }
  }

  // Utility Methods
  createProgressBar(value, maxValue, size = 10) {
    const percentage = Math.min(100, Math.max(0, (value / maxValue) * 100));
    const filledCount = Math.round((percentage / 100) * size);

    return `${'█'.repeat(filledCount)}${'░'.repeat(size - filledCount)} ${percentage.toFixed(1)}%`;
  }

  formatNumber(num) {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(1) + 'B';
    }
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toFixed(2);
  }
  
  /**
   * Send a message to a specific channel
   * @param {string} channelType - The type of channel (contests, trades, announcements, bigNews, help, devYap)
   * @param {string} message - Text message to send
   * @param {object[]} embeds - Optional array of embeds
   * @param {object[]} components - Optional array of components
   * @returns {Promise<object>} - The sent message
   */
  async sendToChannel(channelType, message, embeds = [], components = []) {
    if (!this.channelIds[channelType]) {
      throw new Error(`Channel type "${channelType}" not configured`);
    }
    
    try {
      const channel = await this.client.channels.fetch(this.channelIds[channelType]);
      
      if (!channel) {
        throw new Error(`Could not find channel for ${channelType}`);
      }
      
      const messageOptions = {};
      
      if (message) {
        messageOptions.content = message;
      }
      
      if (embeds && embeds.length > 0) {
        messageOptions.embeds = embeds;
      }
      
      if (components && components.length > 0) {
        messageOptions.components = components;
      }
      
      const sentMessage = await channel.send(messageOptions);
      
      logApi.info(`Sent message to ${channelType} channel`, {
        channelId: this.channelIds[channelType],
        channelName: channel.name,
        messageId: sentMessage.id
      });
      
      return sentMessage;
    } catch (error) {
      logApi.error(`Failed to send message to ${channelType} channel`, {
        error: error.message,
        stack: error.stack,
        channelId: this.channelIds[channelType]
      });
      throw error;
    }
  }
  
  /**
   * Send an announcement to the big-news channel
   * @param {string} title - The announcement title
   * @param {string} message - The announcement message
   * @param {object} options - Optional parameters
   * @returns {Promise<object>} - The sent message
   */
  async sendBigNews(title, message, options = {}) {
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message)
      .setColor(options.color || 0x00bfff)
      .setTimestamp();
      
    if (options.footer) {
      embed.setFooter({
        text: options.footer.text || 'DegenDuel Platform',
        iconURL: options.footer.iconURL || 'https://degenduel.me/assets/images/logo.png'
      });
    }
    
    if (options.thumbnail) {
      embed.setThumbnail(options.thumbnail);
    }
    
    if (options.image) {
      embed.setImage(options.image);
    }
    
    if (options.fields && Array.isArray(options.fields)) {
      embed.addFields(...options.fields);
    }
    
    const components = [];
    if (options.url) {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel(options.urlLabel || 'View Details')
            .setURL(options.url)
            .setStyle(ButtonStyle.Link)
        );
      components.push(row);
    }
    
    return this.sendToChannel('bigNews', null, [embed], components.length > 0 ? components : null);
  }
  
  /**
   * Send a help message to the help channel
   * @param {string} title - The help topic title
   * @param {string} message - The help content
   * @param {object} options - Optional parameters
   * @returns {Promise<object>} - The sent message
   */
  async sendHelpMessage(title, message, options = {}) {
    const embed = new EmbedBuilder()
      .setTitle(`💡 ${title}`)
      .setDescription(message)
      .setColor(options.color || 0x57F287) // Green
      .setTimestamp();
      
    if (options.footer) {
      embed.setFooter({
        text: options.footer.text || 'DegenDuel Help',
        iconURL: options.footer.iconURL || 'https://degenduel.me/assets/images/logo.png'
      });
    }
    
    if (options.fields && Array.isArray(options.fields)) {
      embed.addFields(...options.fields);
    }
    
    const components = [];
    if (options.url) {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel(options.urlLabel || 'Learn More')
            .setURL(options.url)
            .setStyle(ButtonStyle.Link)
        );
      components.push(row);
    }
    
    return this.sendToChannel('help', null, [embed], components.length > 0 ? components : null);
  }
  
  /**
   * Send a developer update to the dev-yap channel
   * @param {string} title - The dev update title
   * @param {string} message - The dev update content
   * @param {object} options - Optional parameters
   * @returns {Promise<object>} - The sent message
   */
  async sendDevUpdate(title, message, options = {}) {
    const embed = new EmbedBuilder()
      .setTitle(`🔧 ${title}`)
      .setDescription(message)
      .setColor(options.color || 0xEB459E) // Pink
      .setTimestamp();
      
    if (options.footer) {
      embed.setFooter({
        text: options.footer.text || 'DegenDuel Development',
        iconURL: options.footer.iconURL || 'https://degenduel.me/assets/images/logo.png'
      });
    }
    
    if (options.fields && Array.isArray(options.fields)) {
      embed.addFields(...options.fields);
    }
    
    const components = [];
    if (options.url) {
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel(options.urlLabel || 'View Details')
            .setURL(options.url)
            .setStyle(ButtonStyle.Link)
        );
      components.push(row);
    }
    
    return this.sendToChannel('devYap', null, [embed], components.length > 0 ? components : null);
  }

  // --- Role Management --- 

  /**
   * Grants the JUP Liker role to a specific Discord user.
   * @param {string} discordUserId - The Discord User ID.
   */
  async grantJupLikeRole(discordUserId) {
    if (!discordUserId) {
      logApi.warn('[Discord] Attempted to grant role with no Discord User ID.');
      return false;
    }
    if (!this.isInitialized || !this.client) {
      logApi.error('[Discord] Cannot grant role, client not initialized.');
      return false;
    }

    try {
      const guild = await this.client.guilds.fetch(discordConfig.GUILD_ID);
      if (!guild) {
        logApi.error(`[Discord] Could not find Guild with ID ${discordConfig.GUILD_ID}`);
        return false;
      }

      const member = await guild.members.fetch(discordUserId).catch(() => null); // Fetch member, return null if not found
      if (!member) {
        logApi.warn(`[Discord] Could not find member with ID ${discordUserId} in guild ${guild.name}. Cannot grant role.`);
        return false; // User might not be in the server
      }

      const role = await guild.roles.fetch(discordConfig.roles.JUP_LIKER_ROLE_ID).catch(() => null);
      if (!role) {
        logApi.error(`[Discord] Could not find Role with ID ${discordConfig.roles.JUP_LIKER_ROLE_ID} in guild ${guild.name}.`);
        return false;
      }
      
      // Check if member already has the role
      if (member.roles.cache.has(role.id)) {
          logApi.info(`[Discord] Member ${discordUserId} already has role ${role.name}. No action needed.`);
          return true; // Already has role
      }

      await member.roles.add(role);
      logApi.info(`[Discord] Successfully granted role "${role.name}" to user ${discordUserId}.`);
      return true;

    } catch (error) {
      logApi.error(`[Discord] Error granting JUP Liker role to user ${discordUserId}:`, error);
      // Check for specific permissions errors
      if (error.code === 50013) { // Missing Permissions
          logApi.error('[Discord] Bot is missing __Manage Roles__ permission.');
      }
      return false;
    }
  }

  /**
   * Revokes the JUP Liker role from a specific Discord user.
   * @param {string} discordUserId - The Discord User ID.
   */
  async revokeJupLikeRole(discordUserId) {
     if (!discordUserId) {
      logApi.warn('[Discord] Attempted to revoke role with no Discord User ID.');
      return false;
    }
     if (!this.isInitialized || !this.client) {
      logApi.error('[Discord] Cannot revoke role, client not initialized.');
      return false;
    }

    try {
      const guild = await this.client.guilds.fetch(discordConfig.GUILD_ID);
       if (!guild) {
        logApi.error(`[Discord] Could not find Guild with ID ${discordConfig.GUILD_ID}`);
        return false;
      }

      const member = await guild.members.fetch(discordUserId).catch(() => null); // Fetch member, return null if not found
      if (!member) {
        logApi.warn(`[Discord] Could not find member with ID ${discordUserId} in guild ${guild.name}. Cannot revoke role.`);
        return false; // User might not be in the server
      }

      const role = await guild.roles.fetch(discordConfig.roles.JUP_LIKER_ROLE_ID).catch(() => null);
      if (!role) {
        logApi.error(`[Discord] Could not find Role with ID ${discordConfig.roles.JUP_LIKER_ROLE_ID} in guild ${guild.name}.`);
        return false;
      }
      
      // Check if member even has the role to begin with
      if (!member.roles.cache.has(role.id)) {
          logApi.info(`[Discord] Member ${discordUserId} does not have role ${role.name}. No action needed.`);
          return true; // Doesn't have role
      }

      await member.roles.remove(role);
      logApi.info(`[Discord] Successfully revoked role "${role.name}" from user ${discordUserId}.`);
      return true;

    } catch (error) {
      logApi.error(`[Discord] Error revoking JUP Liker role from user ${discordUserId}:`, error);
      // Check for specific permissions errors

      // TODO: This is a bit of a hack, we should probably handle this in a more graceful way
      //       For example, we could try to re-fetch the role and member, or even re-fetch the guild.
      //       We could also try to handle specific errors differently.
      //       For now, we'll just log the error and return false.
      //       We should also probably handle the case where the user doesn't have the role to begin with.      
      if (error.code === 50013) { // Missing Permissions
          logApi.error('[Discord] Bot is missing __Manage Roles__ permission.');
      }
      return false;
    }
  }
  // --- End Role Management ---

  // --- Privilege Event Handlers ---
  async onPrivilegeGranted(payload) {
    if (!payload) {
      logApi.error('[Discord] Received PRIVILEGE_GRANTED event with empty payload');
      return;
    }

    const { walletAddress, privilegeKey, username } = payload;
    logApi.info(`[Discord] Received PRIVILEGE_GRANTED event for ${walletAddress || 'unknown'} (Twitter: ${username || 'unknown'}, Key: ${privilegeKey || 'unknown'})`);

    // We only care about the JUP Like role for now
    if (privilegeKey !== 'JUP_LIKE_DISCORD_ROLE') {
        return;
    }

    try {
        // 1. Find Discord User ID and Nickname
        const userData = await prisma.users.findUnique({
            where: { wallet_address: walletAddress },
            select: {
                nickname: true, // Get the DegenDuel nickname
                social_profiles: {
                    where: { platform: 'discord' },
                    select: { platform_user_id: true }
                }
            }
        });
        
        const nickname = userData?.nickname || walletAddress.substring(0, 6); // Fallback to short wallet if no nickname
        const discordUserId = userData?.social_profiles?.[0]?.platform_user_id;

        // --- Fetch Discord PFP (if Discord ID exists) ---
        let discordPfpUrl = null;
        if (discordUserId) {
            try {
                const discordUser = await this.client.users.fetch(discordUserId);
                discordPfpUrl = discordUser?.displayAvatarURL({ dynamic: true, size: 256 }); // Get dynamic URL (gif support), 256px
                logApi.info(`[Discord] Fetched Discord PFP for ${discordUserId}: ${discordPfpUrl}`);
            } catch (fetchError) {
                logApi.warn(`[Discord] Could not fetch Discord user ${discordUserId} for PFP:`, fetchError.message);
            }
        }
        // --- End Fetch Discord PFP ---
        
        // --- Placeholder for Twitter PFP --- 
        // TODO: Implement logic to fetch Twitter PFP URL using the 'username' (Twitter handle)
        const twitterPfpUrl = null; // Stubbed value
        // --- End Placeholder ---

        // --- Placeholder for Image Generation --- 
        // TODO: Implement image generation service call
        // Example: const generatedImageUrl = await imageGenerationService.createChadBadge({ 
        //     nickname: nickname, 
        //     discordPfpUrl: discordPfpUrl, // Might be null
        //     twitterUsername: username,
        //     twitterPfpUrl: twitterPfpUrl // Will be null for now
        // });
        const generatedImageUrl = null; // Stubbed value - replace with actual generated image URL
        logApi.info(`[Discord] Placeholder: Image generation would happen here for ${nickname}.`);
        // --- End Image Generation Placeholder ---

        // Grant Role & Send Notifications only if Discord ID is linked
        if (!discordUserId) {
            logApi.info(`[Discord] User ${walletAddress} has no linked Discord account. Cannot grant role or announce.`);
             // Still log to admin channel even if no Discord ID found
            const adminLogMessage = `✅ Privilege Granted (No Discord Link): 
  - Wallet: ${walletAddress}
  - Twitter: ${username}
  - Action: Privilege recorded in DB, but Discord actions skipped.`;
            await this.sendGrantToAdminLog(adminLogMessage);
            return; // Stop processing for this user
        }

        // 2. Grant Discord Role
        const roleGranted = await this.grantJupLikeRole(discordUserId);

        // 3. Send Notifications (Admin Log and Public Announcement)
        if (roleGranted) { // roleGranted returns true if successful or if user already had it
            
            // Send details to Admin Log channel
            const adminLogMessage = `✅ Privilege Granted: 
  - Wallet: ${walletAddress}
  - Twitter: ${username}
  - Discord: <@${discordUserId}> (${discordUserId})
  - Action: "Chad" role granted (or user already had it).`;
            await this.sendGrantToAdminLog(adminLogMessage);
            
            // Send Public Announcement via Webhook
            const publicWebhook = discordNotificationService.webhooks.mainChat; 
            if (publicWebhook) {
                const message = `🎉 <@${discordUserId}> just proved their loyalty and earned the **Chad** role for liking our token on Jupiter! 💪`;
                try { 
                    // Send message WITH the generated image if available
                    await publicWebhook.send({ content: message, embeds: generatedImageUrl ? [{ image: { url: generatedImageUrl } }] : [] });
                    logApi.info(`[Discord] Sent public grant announcement for ${discordUserId} to mainChat channel ${generatedImageUrl ? 'with image' : 'without image'}.`);
                } catch (webhookError) {
                    logApi.error(`[Discord] Failed to send public grant announcement to mainChat webhook:`, webhookError);
                }
            } else {
                 logApi.warn(`[Discord] Main chat webhook not configured, cannot send public grant announcement.`);
            }
        }

    } catch (error) {
        logApi.error(`[Discord] Error processing PRIVILEGE_GRANTED for ${walletAddress}:`, error);
    }
  }

  async onPrivilegeRevoked(payload) {
      if (!payload) {
        logApi.error('[Discord] Received PRIVILEGE_REVOKED event with empty payload');
        return;
      }

      const { walletAddress, privilegeKey, username } = payload;
      logApi.info(`[Discord] Received PRIVILEGE_REVOKED event for ${walletAddress || 'unknown'} (Twitter: ${username || 'unknown'}, Key: ${privilegeKey || 'unknown'})`);

      // We only care about the JUP Like role for now
      if (privilegeKey !== 'JUP_LIKE_DISCORD_ROLE') {
          return;
      }

      try {
          // 1. Find Discord User ID
          const discordProfile = await prisma.user_social_profiles.findFirst({
              where: { wallet_address: walletAddress, platform: 'discord' },
              select: { platform_user_id: true }
          });
          const discordUserId = discordProfile?.platform_user_id;

          if (!discordUserId) {
              logApi.info(`[Discord] User ${walletAddress} has no linked Discord account. Cannot revoke role or send DM/admin log.`);
               // Still send admin log even if no Discord ID found?
              this.sendRevokeToAdminLog(`User ${walletAddress} (Twitter: ${username}) unliked, but no Discord ID found.`);
              return;
          }

          // 2. Revoke Discord Role
          const roleRevoked = await this.revokeJupLikeRole(discordUserId);

          // 3. Send DM to User (if role revoke seemed successful or user didn't have it)
          if (roleRevoked) { // roleRevoked returns true if successful or if user didn't have role
              try {
                  const dmMessage = `Hi <@${discordUserId}>, we noticed you unliked the token on Jupiter. As a result, the "Chad" role has been removed from your profile. Thanks for your past support!`;
                  await this.client.users.send(discordUserId, dmMessage);
                  logApi.info(`[Discord] Sent revocation DM to ${discordUserId}.`);
              } catch (dmError) {
                  if (dmError.code === 50007) { // Cannot send messages to this user
                      logApi.warn(`[Discord] Could not send DM to ${discordUserId} (User may have DMs disabled or blocked the bot).`);
                  } else {
                      logApi.error(`[Discord] Error sending revocation DM to ${discordUserId}:`, dmError);
                  }
              }
          }
          
          // 4. Send Admin Log via Webhook
          const adminLogMessage = `👎 User Unliked: 
  - Wallet: ${walletAddress}
  - Twitter: ${username}
  - Discord: <@${discordUserId}> (${discordUserId})
  - Action: "Chad" role revoked (or user didn't have it).`;
          await this.sendRevokeToAdminLog(adminLogMessage);

      } catch (error) {
          logApi.error(`[Discord] Error processing PRIVILEGE_REVOKED for ${walletAddress}:`, error);
      }
  }

  // Helper to send to admin log webhook
  async sendRevokeToAdminLog(message) {
      const adminWebhook = discordNotificationService.webhooks.adminLogs;
      if (adminWebhook) {
          try {
              // Use createErrorEmbed for visibility
              const embed = adminWebhook.createErrorEmbed('Privilege Revoked: JUP Like', message);
              await adminWebhook.sendEmbed(embed);
              logApi.info(`[Discord] Sent revocation details to admin log channel.`);
          } catch (webhookError) {
               logApi.error(`[Discord] Failed to send revocation details to admin log webhook:`, webhookError);
          }
      } else {
          logApi.warn(`[Discord] Admin Logs webhook not configured, cannot send revocation log.`);
      }
  }

  // Helper to send to admin log webhook for privilege grants
  async sendGrantToAdminLog(message) {
      const adminWebhook = discordNotificationService.webhooks.adminLogs;
      if (adminWebhook) {
          try {
              // Use success embed for privilege grants
              const embed = adminWebhook.createSuccessEmbed('Privilege Granted: JUP Like', message);
              await adminWebhook.sendEmbed(embed);
              logApi.info(`[Discord] Sent grant details to admin log channel.`);
          } catch (webhookError) {
              logApi.error(`[Discord] Failed to send grant details to admin log webhook:`, webhookError);
          }
      } else {
          logApi.warn(`[Discord] Admin Logs webhook not configured, cannot send grant log.`);
      }
  }

  // --- End Privilege Event Handlers ---

  async performOperation() {
    // Just check Discord client connection
    if (!this.client || !this.client.user) {
      throw new Error('Discord client not connected');
    }

    return true;
  }

  async stop() {
    await super.stop();

    // Disconnect Discord client
    if (this.client) {
      this.client.destroy();
    }

    return true;
  }
}

// Export the service
export default new DiscordInteractiveService();