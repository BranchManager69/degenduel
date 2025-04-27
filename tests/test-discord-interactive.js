// tests/test-discord-interactive.js
/**
 * @file Discord OAuth Authentication Test
 * @description Test tool for Discord OAuth integration with DegenDuel
 * @author Claude
 * @version 1.0.0
 */

import axios from 'axios';
import express from 'express';
import http from 'http';
import { logApi } from '../utils/logger-suite/logger.js';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';

const logger = {
  ...logApi.forService('DISCORD-OAUTH-TEST'),
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args)
};

// Test configuration - modify as needed
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3004';
const TEST_PORT = process.env.TEST_PORT || 8088;
const DISCORD_CLIENT_ID = config.discord.oauth.client_id;
const DISCORD_CLIENT_SECRET = config.discord.oauth.client_secret;
const DISCORD_CALLBACK_URI = `http://localhost:${TEST_PORT}/discord-callback`;

if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.error('ERROR: Missing Discord credentials in config.discord.oauth.');
  console.error('Make sure discord.oauth.client_id and discord.oauth.client_secret are set in config.js.');
  process.exit(1);
}

// Create a test app to handle the OAuth callback
const app = express();
let server;

// Add the test callback URI to the config object
config.discord.oauth.callback_uri_development = DISCORD_CALLBACK_URI;

// Store Discord user info for verification
let discordUserInfo = null;

// Setup a basic in-memory store for pending operations
const pendingOperations = new Map();

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Discord OAuth Test</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
          }
          .button {
            display: inline-block;
            padding: 10px 20px;
            margin: 10px 5px;
            background-color: #5865F2;
            color: white;
            border-radius: 4px;
            text-decoration: none;
            font-weight: bold;
          }
          .button.red { background-color: #ED4245; }
          .button.green { background-color: #57F287; }
          pre {
            background-color: #f6f8fa;
            border-radius: 4px;
            padding: 10px;
            overflow: auto;
          }
        </style>
      </head>
      <body>
        <h1>Discord OAuth Testing Tool</h1>
        <p>Use the buttons below to test different Discord OAuth flows.</p>
        
        <div>
          <a href="/check-config" class="button">Check Discord Config</a>
          <a href="/start-oauth" class="button green">Start Discord OAuth Flow</a>
          <a href="/start-direct-oauth" class="button">Start Direct OAuth</a>
        </div>
        
        ${discordUserInfo ? `
        <h2>Discord User Info</h2>
        <pre>${JSON.stringify(discordUserInfo, null, 2)}</pre>
        ` : ''}
      </body>
    </html>
  `);
});

// Check Discord configuration
app.get('/check-config', async (req, res) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/auth/discord/check-config`);
    res.send(`
      <html>
        <head>
          <title>Discord Config Check</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 4px;
              padding: 10px;
              overflow: auto;
            }
          </style>
        </head>
        <body>
          <h1>Discord Configuration Check</h1>
          <pre>${JSON.stringify(response.data, null, 2)}</pre>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Failed to check Discord configuration:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 4px;
              padding: 10px;
              overflow: auto;
            }
          </style>
        </head>
        <body>
          <h1>Error Checking Discord Configuration</h1>
          <div class="error">
            <strong>Error:</strong> ${error.message}
          </div>
          ${error.response ? `
          <h2>Response Data</h2>
          <pre>${JSON.stringify(error.response.data, null, 2)}</pre>
          ` : ''}
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
});

// Start OAuth flow
app.get('/start-oauth', async (req, res) => {
  try {
    // Generate a unique operation ID
    const operationId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    
    // Store the operation for later reference
    pendingOperations.set(operationId, {
      timestamp: Date.now(),
      status: 'initiated'
    });
    
    // Redirect to our server's discord login endpoint which will set up OAuth
    res.redirect(`${API_BASE_URL}/api/auth/discord/login?test_op=${operationId}`);
  } catch (error) {
    logger.error('Failed to initiate OAuth flow:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h1>Error Starting OAuth Flow</h1>
          <div class="error">
            <strong>Error:</strong> ${error.message}
          </div>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
});

// Direct OAuth initiation
app.get('/start-direct-oauth', (req, res) => {
  try {
    // Build Discord OAuth URL directly
    const state = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const redirectUri = DISCORD_CALLBACK_URI;
    
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('client_id', DISCORD_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('scope', 'identify email');
    authUrl.searchParams.append('state', state);
    
    // Store the state for verification
    pendingOperations.set(state, {
      timestamp: Date.now(),
      status: 'initiated',
      isDirect: true
    });
    
    res.redirect(authUrl.toString());
  } catch (error) {
    logger.error('Failed to initiate direct OAuth flow:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h1>Error Starting Direct OAuth Flow</h1>
          <div class="error">
            <strong>Error:</strong> ${error.message}
          </div>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
});

// Discord callback handler
app.get('/discord-callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;
  
  // Handle OAuth errors
  if (error) {
    logger.error(`Discord OAuth error: ${error}`, { error_description });
    return res.status(400).send(`
      <html>
        <head>
          <title>Discord OAuth Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h1>Discord OAuth Error</h1>
          <div class="error">
            <strong>Error:</strong> ${error}<br>
            <strong>Description:</strong> ${error_description || 'No description provided'}
          </div>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
  
  // Check for code and state
  if (!code || !state) {
    logger.error('Missing code or state in Discord callback');
    return res.status(400).send(`
      <html>
        <head>
          <title>Invalid Callback</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h1>Invalid Discord Callback</h1>
          <div class="error">
            <strong>Error:</strong> Missing required OAuth parameters
          </div>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
  
  // Check if this is from a pending operation
  const operation = pendingOperations.get(state);
  if (!operation) {
    logger.warn(`Received callback with unknown state: ${state}`);
  } else {
    logger.info(`Received callback for operation: ${state}`);
    operation.status = 'callback_received';
  }
  
  try {
    // For direct OAuth flow, exchange code for token directly
    if (operation?.isDirect) {
      // Exchange code for token
      const tokenParams = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: DISCORD_CALLBACK_URI
      });
      
      const tokenResponse = await axios.post(
        'https://discord.com/api/oauth2/token',
        tokenParams.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      const { access_token } = tokenResponse.data;
      
      // Get user info
      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      });
      
      discordUserInfo = userResponse.data;
      
      return res.redirect('/');
    }
    
    // For API-handled flow, store the code and state for later verification
    logger.info(`Redirecting to API callback with code and state`);
    
    // Return success
    res.send(`
      <html>
        <head>
          <title>Discord OAuth Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .success {
              background-color: #E8F5E9;
              color: #2E7D32;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 4px;
              padding: 10px;
              overflow: auto;
            }
          </style>
        </head>
        <body>
          <h1>Discord OAuth Successful</h1>
          <div class="success">
            <strong>Success:</strong> Your Discord authentication was successful.
          </div>
          <h2>Authentication Code</h2>
          <pre>${code.substring(0, 10)}...(truncated)</pre>
          <h3>What happened?</h3>
          <p>
            We received the OAuth authorization code from Discord. In a real application, 
            this code would be exchanged for an access token and used to get your Discord profile information.
          </p>
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('Error handling Discord callback:', error);
    res.status(500).send(`
      <html>
        <head>
          <title>Error</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              line-height: 1.6;
            }
            .button {
              display: inline-block;
              padding: 10px 20px;
              margin: 10px 0;
              background-color: #5865F2;
              color: white;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }
            .error {
              background-color: #FFEBEE;
              color: #C62828;
              padding: 10px;
              border-radius: 4px;
              margin: 10px 0;
            }
            pre {
              background-color: #f6f8fa;
              border-radius: 4px;
              padding: 10px;
              overflow: auto;
            }
          </style>
        </head>
        <body>
          <h1>Error Processing Discord Callback</h1>
          <div class="error">
            <strong>Error:</strong> ${error.message}
          </div>
          ${error.response ? `
          <h2>Response Data</h2>
          <pre>${JSON.stringify(error.response.data, null, 2)}</pre>
          ` : ''}
          <a href="/" class="button">Back to Home</a>
        </body>
      </html>
    `);
  }
});

// Start the server
async function start() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(TEST_PORT, () => {
      logger.info(`Discord OAuth test server running at http://localhost:${TEST_PORT}`);
      resolve();
    });
  });
}

// Cleanup function to run when process exits
function cleanup() {
  if (server) {
    logger.info('Shutting down server...');
    server.close();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// Test Discord Interactive Service example function
async function testDiscordInteractiveService() {
  try {
    // Import the Discord Interactive Service
    const discordInteractiveService = (await import('../services/discord/discord-interactive-service.js')).default;
    
    logger.info('Starting Discord Interactive Service test...');
    
    // Initialize the service
    await discordInteractiveService.initialize();
    logger.info('Discord Interactive Service initialized');
    
    // List all available channels the bot can see
    logger.info('Listing all accessible channels:');
    const guilds = discordInteractiveService.client.guilds.cache;
    for (const guild of guilds.values()) {
      logger.info(`Guild: ${guild.name} (${guild.id})`);
      const channels = guild.channels.cache;
      for (const channel of channels.values()) {
        logger.info(`  - Channel: ${channel.name} (${channel.id}) [Type: ${channel.type}]`);
      }
    }
    
    // Debug our channel IDs
    logger.info('Channel IDs from service:');
    Object.entries(discordInteractiveService.channelIds).forEach(([key, value]) => {
      logger.info(`  - ${key}: "${value}"`);
    });
    
    // Test sending messages to different channels
    
    // 1. Test Contest Creation with Interactive Buttons
    try {
      // Create a rich embed
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      
      // First, check what contests exist in the database
      const contests = await prisma.contests.findMany({
        take: 5,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          name: true,
          contest_code: true,
          image_url: true,
          prize_pool: true,
          entry_fee: true,
          start_time: true,
          end_time: true,
          status: true
        }
      });
      
      logger.info(`Found ${contests.length} contests in database`);
      if (contests.length > 0) {
        logger.info(`First contest: ID ${contests[0].id}, Name: ${contests[0].name}`);
        logger.info(`Contest details: ${JSON.stringify(contests[0], null, 2)}`);
      }
      
      // If we have contests, use a real ID, otherwise use a placeholder
      const contestId = contests.length > 0 ? contests[0].id : 1;
      
      // Get or define the contest code and image URL
      const contestCode = contests.length > 0 && contests[0].contest_code 
        ? contests[0].contest_code 
        : 'DIAMOND42'; // Fallback if no contest available
        
      // Standardized approach: Always use contest code for image URLs
      // This matches the new standard in both the contestImageService and contestSchedulerService
      const imageUrl = `https://degenduel.me/images/contests/${contestCode}.png`;
      logger.info(`Using standardized image URL with contest code: ${imageUrl}`);
      
      // Get contest details from database or use fallback values
      const contestName = contests.length > 0 && contests[0].name 
        ? contests[0].name : 'Diamond Hands Challenge';
        
      // Format prize pool and entry fee as strings
      const prizePool = contests.length > 0 && contests[0].prize_pool 
        ? (typeof contests[0].prize_pool === 'string' 
          ? contests[0].prize_pool 
          : `${contests[0].prize_pool} SOL`)
        : '50 SOL';
        
      const entryFee = contests.length > 0 && contests[0].entry_fee
        ? (typeof contests[0].entry_fee === 'string' 
          ? contests[0].entry_fee 
          : `${contests[0].entry_fee} SOL`)
        : '0.1 SOL';
        
      const startTime = contests.length > 0 && contests[0].start_time
        ? new Date(contests[0].start_time).toLocaleString() 
        : new Date(Date.now() + 3600000).toLocaleString();
      
      const contestEmbed = new EmbedBuilder()
        .setTitle(`🎮 New Contest: ${contestName}`)
        .setDescription(`A new contest has been created with a prize pool of ${prizePool}!`)
        .setColor(0x00bfff) // Deep sky blue
        .setImage(imageUrl) // Contest image URL
        .setThumbnail('https://degenduel.me/assets/images/logo.png') // DegenDuel logo
        .addFields(
          { name: 'Contest Code', value: contestCode, inline: true },
          { name: 'Start Time', value: startTime, inline: true },
          { name: 'Prize Pool', value: prizePool, inline: true },
          { name: 'Entry Fee', value: entryFee, inline: true },
          { name: 'Status', value: 'Accepting Entries', inline: true }
        )
        .setFooter({ text: 'DegenDuel Platform', iconURL: 'https://degenduel.me/assets/images/logo.png' })
        .setTimestamp();

      // Create interactive buttons with real contest ID
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Join Contest')
            .setCustomId(`join_contest:${contestId}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('View Details')
            .setCustomId(`view_details:${contestId}`)
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setLabel('Open in App')
            .setURL(`https://degenduel.me/contests/${contestId}`)
            .setStyle(ButtonStyle.Link)
        );

      await discordInteractiveService.sendToChannel('contests', null, [contestEmbed], [row]);
      logger.info('Successfully sent interactive contest creation notification');
      
      // Wait 2 seconds between messages
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Also show Contest Started state
      const contestStartedEmbed = new EmbedBuilder()
        .setTitle(`🚀 Contest Started: ${contestName}`)
        .setDescription(`Contest **${contestName}** has officially started with 12 participants!`)
        .setColor(0x00ff00) // Green
        .setImage(imageUrl) // Contest image URL
        .setThumbnail('https://degenduel.me/assets/images/logo.png') // DegenDuel logo
        .addFields(
          { name: 'Participants', value: `12`, inline: true },
          { name: 'Prize Pool', value: prizePool, inline: true },
          { name: 'Duration', value: '2 hours', inline: true }
        )
        .setTimestamp();

      // Create interactive buttons for started contest
      const startedRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('View Leaderboard')
            .setCustomId(`view_leaderboard:${contestId}`)
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setLabel('Open in App')
            .setURL(`https://degenduel.me/contests/${contestId}`)
            .setStyle(ButtonStyle.Link)
        );

      await discordInteractiveService.sendToChannel('contests', null, [contestStartedEmbed], [startedRow]);
      logger.info('Successfully sent interactive contest started notification');
      
      // Wait 2 seconds between messages
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Also show Contest Completed state
      const contestCompletedEmbed = new EmbedBuilder()
        .setTitle(`🏆 Contest Completed: ${contestName}`)
        .setDescription(`Contest **${contestName}** has ended with **12** participants!`)
        .setColor(0xffd700) // Gold
        .setImage(imageUrl) // Contest image URL
        .setThumbnail('https://degenduel.me/assets/images/logo.png') // DegenDuel logo
        .addFields(
          { name: 'Contest Code', value: contestCode, inline: true },
          { name: 'Prize Pool', value: prizePool, inline: true },
          { name: 'Participants', value: '12', inline: true },
          { name: 'Duration', value: '2 hours', inline: true },
          { 
            name: '🏆 Winners', 
            value: '━━━━━━━━━━━━━━━━━━━━━━━', 
            inline: false 
          },
          { name: '🥇 DegenKing', value: 'Prize: 25 SOL', inline: true },
          { name: '🥈 TokenMaster', value: 'Prize: 15 SOL', inline: true },
          { name: '🥉 SolChamp', value: 'Prize: 10 SOL', inline: true }
        )
        .setTimestamp();

      // Create button to link to the contest
      const completedRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('View Contest Results')
            .setURL(`https://degenduel.me/contests/${contestId}`)
            .setStyle(ButtonStyle.Link)
        );

      await discordInteractiveService.sendToChannel('contests', null, [contestCompletedEmbed], [completedRow]);
      logger.info('Successfully sent interactive contest completed notification');
      
      // Wait 2 seconds between messages
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Also show Contest Canceled state
      const contestCanceledEmbed = new EmbedBuilder()
        .setTitle(`❌ Contest Canceled: ${contestName}`)
        .setDescription(`Contest **${contestName}** has been canceled due to insufficient participants.`)
        .setColor(0xff0000) // Red
        .setImage(imageUrl) // Contest image URL
        .setThumbnail('https://degenduel.me/assets/images/logo.png') // DegenDuel logo
        .addFields(
          { name: 'Contest Code', value: contestCode, inline: true },
          { name: 'Prize Pool', value: prizePool, inline: true },
          { name: 'Participants', value: '2', inline: true },
          { name: 'Required Minimum', value: '5 participants', inline: true },
          { name: 'Refund Status', value: 'All entry fees have been refunded', inline: false }
        )
        .setTimestamp();

      // Create button for canceled contest
      const canceledRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Browse Active Contests')
            .setURL(`https://degenduel.me/contests`)
            .setStyle(ButtonStyle.Link)
        );

      await discordInteractiveService.sendToChannel('contests', null, [contestCanceledEmbed], [canceledRow]);
      logger.info('Successfully sent interactive contest canceled notification');
      
    } catch (err) {
      logger.error('Failed to send interactive contest notifications:', err);
    }
    
    // Wait 2 seconds between messages
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 2. Test Token Pump Notification with Interactive Buttons
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import('discord.js');
      
      // Create token pump notification with progress bar
      const tokenData = {
        symbol: 'DEGEN',
        name: 'DegenCoin',
        address: 'DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump',
        change_24h: 120.5,
        price: 0.00420,
        market_cap: 9500000,
        volume_24h: 3200000,
        image_url: 'https://degenduel.me/assets/images/logo.png',
        socials: {
          twitter: 'https://twitter.com/DegenDuel',
          telegram: 'https://t.me/DegenDuel',
          website: 'https://degenduel.me'
        }
      };
      
      // Create a function to generate a progress bar
      const createProgressBar = (value, maxValue, size = 10) => {
        const percentage = Math.min(100, Math.max(0, (value / maxValue) * 100));
        const filledCount = Math.round((percentage / 100) * size);
        return `${'█'.repeat(filledCount)}${'░'.repeat(size - filledCount)} ${percentage.toFixed(1)}%`;
      };
      
      // Format numbers for display
      const formatNumber = (num) => {
        if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toFixed(2);
      };
      
      const progressBar = createProgressBar(tokenData.change_24h, 100);

      const embed = new EmbedBuilder()
        .setTitle(`🚀 ${tokenData.symbol} is pumping!`)
        .setDescription(`**${tokenData.name}** has increased by **${tokenData.change_24h.toFixed(2)}%** in the last 24 hours.\n\n${progressBar}`)
        .setColor(0x00ff00) // Green
        .addFields(
          { name: 'Current Price', value: `$${tokenData.price.toFixed(6)}`, inline: true },
          { name: 'Market Cap', value: tokenData.market_cap ? `$${formatNumber(tokenData.market_cap)}` : 'Unknown', inline: true },
          { name: 'Volume 24h', value: tokenData.volume_24h ? `$${formatNumber(tokenData.volume_24h)}` : 'Unknown', inline: true }
        );

      // Add token image if available
      if (tokenData.image_url) {
        embed.setThumbnail(tokenData.image_url);
      }

      // Add time-based notification
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
            .setURL(`https://dexscreener.com/solana/${tokenData.address}`)
            .setStyle(ButtonStyle.Link),
          new ButtonBuilder()
            .setLabel('Trade Now')
            .setURL(`https://jup.ag/swap/SOL-${tokenData.address}`)
            .setStyle(ButtonStyle.Link)
        );

      await discordInteractiveService.sendToChannel('trades', null, [embed], [row]);
      logger.info('Successfully sent interactive token pump notification');
    } catch (err) {
      logger.error('Failed to send interactive token pump notification:', err);
    }
    
    // Shutdown the service
    await discordInteractiveService.stop();
    logger.info('Discord Interactive Service test completed');
    
  } catch (error) {
    logger.error('Error testing Discord Interactive Service:', error);
  }
}

// Main function to run the test
async function main() {
  try {
    // If "--test-discord-service" flag is passed, run the interactive service test instead of OAuth test
    if (process.argv.includes('--test-discord-service')) {
      return await testDiscordInteractiveService();
    }
    
    // Otherwise run the OAuth test server
    await start();
    
    // Check environment setup
    logger.info('Discord OAuth Test Tool');
    logger.info('=====================');
    logger.info(`API Base URL: ${API_BASE_URL}`);
    logger.info(`Callback URL: ${DISCORD_CALLBACK_URI}`);
    
    // Print URL instead of opening browser
    logger.info(`Test server is now available at http://localhost:${TEST_PORT}`);
    
    logger.info('Browser opened to test interface');
  } catch (error) {
    logger.error('Error starting test:', error);
    process.exit(1);
  }
}

// Run the test
main();