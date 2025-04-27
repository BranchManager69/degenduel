// services/discord/discord-interactive-service.js

/**
 * @file services/discord/discord-interactive-service.js
 * @description Interactive Discord bot for rich notifications
 * @author DegenDuel
 * @version 1.9.0
 * @since 2025-04-26
 */

import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { logApi } from '../../utils/logger-suite/logger.js';
import { BaseService } from '../../utils/service-suite/base-service.js';
//import { SERVICE_LAYERS } from '../../utils/service-suite/service-constants.js'; // currently unused but really should be used
import { SERVICE_NAMES } from '../../utils/service-suite/service-constants.js'; 
import serviceEvents from '../../utils/service-suite/service-events.js';
import prisma from '../../config/prisma.js';

// Config
// [bandaid fix for now:]
import dotenv from 'dotenv';
dotenv.config();
////import config from '../../config/config.js';

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

    this.channelIds = {
      contests: process.env.DISCORD_CONTESTS_CHANNEL_ID,
      trades: process.env.DISCORD_TRADES_CHANNEL_ID,
      announcements: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID
    };

    // Track active contests for interaction state
    this.activeContests = new Map();

    // Set up event listeners
    this.setupEventListeners();
  }

  async initialize() {
    try {
      // Initialize Discord client
      await this.client.login(process.env.DISCORD_BOT_TOKEN);

      // Set up interaction handling
      this.setupInteractionHandlers();

      logApi.info(`Discord Interactive Bot connected as ${this.client.user.tag}`);
      this.isInitialized = true;
      return true;
    } catch (error) {
      logApi.error('Discord Interactive Bot initialization failed:', error);
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
    if (!this.channelIds.contests) return;

    try {
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
      logApi.error('Failed to send contest creation notification:', error);
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