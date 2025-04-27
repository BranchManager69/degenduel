// tests/discord-contest-lifecycle-test.js
import dotenv from 'dotenv';
dotenv.config();

import discordNotificationService from '../services/discordNotificationService.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Discord webhook test configuration
import { config } from '../config/config.js';

/**
 * This script tests the enhanced Discord notifications for all contest states
 * by simulating the entire contest lifecycle from creation to completion or cancellation
 */
async function testContestLifecycleNotifications() {
  try {
    console.log('Initializing Discord notification service...');
    
    // Initialize the service 
    await discordNotificationService.init();
    
    // Override webhooks for testing
    discordNotificationService.webhookUrls = {
      adminLogs: process.env.DISCORD_WEBHOOK_ADMIN_LOGS || '',
      system: process.env.DISCORD_WEBHOOK_SYSTEM || '',
      alerts: process.env.DISCORD_WEBHOOK_ALERTS || '',
      contests: process.env.DISCORD_WEBHOOK_CONTESTS || '',
      transactions: process.env.DISCORD_WEBHOOK_TRANSACTIONS || '',
      tokens: process.env.DISCORD_WEBHOOK_TOKENS || '',
      trades: process.env.DISCORD_WEBHOOK_TRADES || ''
    };
    
    // Reinitialize webhook clients
    discordNotificationService.webhooks = {};
    for (const [key, url] of Object.entries(discordNotificationService.webhookUrls)) {
      if (url) {
        const DiscordWebhook = (await import('../utils/discord-webhook.js')).default;
        discordNotificationService.webhooks[key] = new DiscordWebhook(url);
      }
    }
    
    // STEP 1: Contest Creation (Pending state)
    console.log('Simulating pending contest creation...');
    const pendingContestData = {
      id: 12345,
      name: "Weekend Warrior Showdown",
      contest_code: "WWS-123",
      prize_pool: "4.20",
      entry_fee: "0.069",
      status: "pending",
      start_time: new Date(Date.now() + (1000 * 60 * 60)), // 1 hour from now
      image_url: "https://degenduel.me/assets/images/logo.png" // Use absolute URL for testing
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, pendingContestData);
    console.log('Sent pending contest notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 2: Contest Creation (Active state)
    console.log('Simulating active contest creation...');
    const activeContestData = {
      id: 23456,
      name: "Live Trading Challenge",
      contest_code: "LTC-456",
      prize_pool: "6.9",
      entry_fee: "0.42",
      status: "active",
      start_time: new Date(Date.now() - (1000 * 60 * 15)), // Started 15 minutes ago
      image_url: "https://degenduel.me/assets/images/logo.png" // Use absolute URL for testing
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, activeContestData);
    console.log('Sent active contest notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 3: Contest Creation (Completed state)
    console.log('Simulating completed contest...');
    const completedContestData = {
      id: 34567,
      name: "Yesterday's Trading Tournament",
      contest_code: "YTT-789",
      prize_pool: "10.0",
      entry_fee: "0.25",
      status: "completed",
      start_time: new Date(Date.now() - (1000 * 60 * 60 * 24)), // 24 hours ago
      image_url: "https://degenduel.me/assets/images/logo.png" // Use absolute URL for testing
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, completedContestData);
    console.log('Sent completed contest notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 4: Contest Creation (Cancelled state)
    console.log('Simulating cancelled contest...');
    const cancelledContestData = {
      id: 45678,
      name: "Cancelled Challenge",
      contest_code: "CNC-101",
      prize_pool: "5.0",
      entry_fee: "0.1",
      status: "cancelled",
      start_time: new Date(Date.now() - (1000 * 60 * 30)), // 30 minutes ago
      image_url: "https://degenduel.me/assets/images/logo.png" // Use absolute URL for testing
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, cancelledContestData);
    console.log('Sent cancelled contest notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 5: User Join Contest
    console.log('Simulating user joining contest...');
    const joinData = {
      type: 'user_joined',
      contestId: 12345,
      contestName: "Weekend Warrior Showdown",
      contestCode: "WWS-123",
      userDisplayName: "CryptoBob",
      currentParticipants: 5,
      maxParticipants: 10,
      prizePool: "4.20",
      entryFee: "0.069",
      startTime: new Date(Date.now() + (1000 * 60 * 60)),
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_ACTIVITY, joinData);
    console.log('Sent user join notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 6: Contest Completion
    console.log('Simulating contest completion event...');
    const completionData = {
      contest_id: 12345,
      contest_name: "Weekend Warrior Showdown",
      contest_code: "WWS-123",
      prize_pool: "4.20",
      platform_fee: "0.069",
      participant_count: 10,
      start_time: new Date(Date.now() - (1000 * 60 * 60 * 3)), // 3 hours ago
      end_time: new Date(),
      winners: [
        {
          wallet_address: "9xty71irZF6KpG8xnBiCRShgd3VLEgaYrs9RXrWzK3C2",
          place: 1,
          prize_amount: "2.9",
          display_name: "CryptoBob"
        },
        {
          wallet_address: "8mCsw83jVBdFrj4dQ4QZGQWb1AECvZk2861FcxwpV9ZM",
          place: 2,
          prize_amount: "0.84",
          display_name: "SolQueen"
        },
        {
          wallet_address: "EXJLegLSXA3Tw4PiwJ7EixKSSS4aNk9VxENc4LZ6goTX",
          place: 3,
          prize_amount: "0.462",
          display_name: "CryptoFan69"
        }
      ]
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_COMPLETED, completionData);
    console.log('Sent contest completion event notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // STEP 7: User Achievement
    console.log('Simulating achievement unlock...');
    const achievementData = {
      user_name: "CryptoBob",
      achievement_name: "First Victory",
      description: "Win your first contest",
      xp_awarded: 500
    };
    
    serviceEvents.emit(SERVICE_EVENTS.USER_ACHIEVEMENT, achievementData);
    console.log('Sent achievement notification');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Give time for all events to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Contest lifecycle test completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during test:', error);
    process.exit(1);
  }
}

// Run the test
testContestLifecycleNotifications();