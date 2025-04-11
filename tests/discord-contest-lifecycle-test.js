// tests/discord-contest-lifecycle-test.js
import dotenv from 'dotenv';
dotenv.config();

import discordNotificationService from '../services/discordNotificationService.js';
import serviceEvents from '../utils/service-suite/service-events.js';
import { SERVICE_EVENTS } from '../utils/service-suite/service-events.js';
import { logApi } from '../utils/logger-suite/logger.js';

/**
 * This script tests the complete contest lifecycle notifications
 * by simulating the entire contest flow from creation to completion
 */
async function testContestLifecycleNotifications() {
  try {
    console.log('Initializing Discord notification service...');
    await discordNotificationService.init();

    // STEP 1: Contest Creation
    console.log('Simulating contest creation...');
    const contestData = {
      id: 12345,
      name: "Weekend Warrior Showdown",
      contest_code: "WWS-123",
      prize_pool: "4.20",
      entry_fee: "0.069",
      status: "pending",
      start_time: new Date(Date.now() + (1000 * 60)), // 1 minute from now
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_CREATED, contestData);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // STEP 2: User Join Contest
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
      startTime: new Date(Date.now() + (1000 * 60)),
    };
    
    serviceEvents.emit(SERVICE_EVENTS.CONTEST_ACTIVITY, joinData);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // STEP 3: Contest Completion
    console.log('Simulating contest completion...');
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
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // STEP 4: User Achievement
    console.log('Simulating achievement unlock...');
    const achievementData = {
      user_name: "CryptoBob",
      achievement_name: "First Victory",
      description: "Win your first contest",
      xp_awarded: 500
    };
    
    serviceEvents.emit(SERVICE_EVENTS.USER_ACHIEVEMENT, achievementData);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // STEP 5: User Level Up
    console.log('Simulating user level up...');
    const levelUpData = {
      user_name: "CryptoBob",
      wallet_address: "9xty71irZF6KpG8xnBiCRShgd3VLEgaYrs9RXrWzK3C2",
      previous_level: 4,
      new_level: 5,
      total_xp: 2500,
      unlocked_perks: [
        "Reduced trading fees (0.5%)",
        "Daily login bonus (+25 XP)",
      ]
    };
    
    serviceEvents.emit(SERVICE_EVENTS.USER_LEVEL_UP, levelUpData);
    
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