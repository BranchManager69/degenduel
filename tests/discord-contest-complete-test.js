// tests/discord-contest-complete-test.js
import dotenv from 'dotenv';
dotenv.config();

import discordNotificationService from '../services/discordNotificationService.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import { logApi } from '../utils/logger-suite/logger.js';

/**
 * This script tests the contest completion notification functionality
 * by emitting a simulated contest completion event
 */
async function testContestCompletionNotification() {
  try {
    console.log('Initializing Discord notification service...');
    await discordNotificationService.init();

    // Simulated contest completion data
    const mockCompletionData = {
      contest_id: 12345,
      contest_name: "Weekend Warrior Showdown",
      contest_code: "WWS-123",
      prize_pool: "4.20",
      platform_fee: "0.069",
      participant_count: 42,
      start_time: new Date(Date.now() - (24 * 60 * 60 * 1000)), // 24 hours ago
      end_time: new Date(),
      winners: [
        {
          wallet_address: "9xty71irZF6KpG8xnBiCRShgd3VLEgaYrs9RXrWzK3C2",
          place: 1,
          prize_amount: "2.9",
          display_name: "DegenLord"
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

    console.log('Emitting contest completed event with test data...');
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_COMPLETED, mockCompletionData);
    
    // Give time for the event to be processed
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Test completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during test:', error);
    process.exit(1);
  }
}

// Run the test
testContestCompletionNotification();