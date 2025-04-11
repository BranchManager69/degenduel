// tests/discord-user-achievements-test.js
import dotenv from 'dotenv';
dotenv.config();

import discordNotificationService from '../services/discordNotificationService.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import { logApi } from '../utils/logger-suite/logger.js';

/**
 * This script tests the user achievement and level-up notifications
 * by emitting simulated user milestone events
 */
async function testUserMilestoneNotifications() {
  try {
    console.log('Initializing Discord notification service...');
    await discordNotificationService.init();

    // Simulate sending an achievement notification
    const mockAchievement = {
      user_name: "CryptoDegen420",
      achievement_name: "Contest Crusader",
      description: "Win 5 contests in a single week",
      xp_awarded: 500,
      icon_url: "https://example.com/achievements/contest_crusader.png" // Optional icon
    };

    console.log('Emitting user achievement event...');
    serviceEvents.emit(SERVICE_EVENTS.USER_ACHIEVEMENT, mockAchievement);
    
    // Wait 2 seconds before sending the next notification
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate sending a level up notification
    const mockLevelUp = {
      user_name: "CryptoDegen420",
      previous_level: 9,
      new_level: 10,
      total_xp: 5750,
      unlocked_perks: [
        "Reduced trading fees (0.1%)",
        "Access to VIP contests",
        "Custom profile badge"
      ]
    };

    console.log('Emitting user level up event...');
    serviceEvents.emit(SERVICE_EVENTS.USER_LEVEL_UP, mockLevelUp);
    
    // Wait 2 seconds before sending the next notification
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Simulate sending a general milestone notification
    const mockMilestone = {
      user_name: "CryptoDegen420",
      title: "Trading Veteran",
      description: "**CryptoDegen420** has completed over 100 trades on DegenDuel!",
      fields: [
        { name: "Total Trades", value: "105", inline: true },
        { name: "Success Rate", value: "69%", inline: true },
        { name: "Total Volume", value: "420 SOL", inline: true }
      ]
    };

    console.log('Emitting user milestone event...');
    serviceEvents.emit(SERVICE_EVENTS.USER_MILESTONE, mockMilestone);
    
    // Give time for the events to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Test completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during test:', error);
    process.exit(1);
  }
}

// Run the test
testUserMilestoneNotifications();