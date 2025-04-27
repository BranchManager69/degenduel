// tests/test-discord-interactive.js
/**
 * @file Test script for Discord interactive service
 * @description Tests all notification types for the Discord interactive bot
 * @author Claude
 * @version 1.0.0
 */

import serviceEvents from '../utils/service-suite/service-events.js';
import discordInteractiveService from '../services/discord/discord-interactive-service.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// Initialize the Discord bot
async function testBot() {
  try {
    logApi.info("Starting Discord interactive service test...");
    
    // Initialize the bot service
    await discordInteractiveService.initialize();
    logApi.info("Discord bot initialized successfully!");
    
    // Get real data from database for testing
    const realContests = await fetchRealContests();
    const realTokens = await fetchRealTokens();
    
    // Test each notification type with 3 second delays between them
    await runTests(realContests, realTokens);
    
    // Wait for all notifications to be sent before shutting down
    setTimeout(() => {
      logApi.info("All tests complete, shutting down bot...");
      discordInteractiveService.stop();
      process.exit(0);
    }, 15000);
  } catch (error) {
    logApi.error("Error testing Discord bot:", error);
    process.exit(1);
  }
}

// Run all notification tests in sequence
async function runTests(contests, tokens) {
  // 1. Test contest creation notification
  await testContestCreated(contests[0]);
  await sleep(3000);
  
  // 2. Test contest started notification
  await testContestStarted(contests[0]);
  await sleep(3000);
  
  // 3. Test contest completed notification
  await testContestCompleted(contests[0]);
  await sleep(3000);
  
  // 4. Test token pump notification
  await testTokenPump(tokens[0]);
}

// Helper function to wait
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test contest creation notification
async function testContestCreated(contest) {
  try {
    logApi.info(`Testing contest:created event with contest: ${contest.name}`);
    
    // Prepare enriched contest data
    const contestData = {
      id: contest.id,
      name: contest.name,
      contest_code: contest.contest_code || 'TEST123',
      start_time: contest.start_time || new Date(Date.now() + 3600000), // 1 hour from now
      prize_pool: parseFloat(contest.prize_pool) || 10,
      entry_fee: parseFloat(contest.entry_fee) || 0.5
    };
    
    // Emit the event
    serviceEvents.emit('contest:created', contestData);
    logApi.info("✅ contest:created event emitted");
  } catch (error) {
    logApi.error("Error testing contest:created event:", error);
  }
}

// Test contest started notification
async function testContestStarted(contest) {
  try {
    logApi.info(`Testing contest:started event with contest: ${contest.name}`);
    
    // Prepare enriched contest data
    const contestData = {
      id: contest.id,
      name: contest.name,
      participant_count: 12, // Mock data
      prize_pool: parseFloat(contest.prize_pool) || 10,
      duration: '2 hours' // Mock data
    };
    
    // Emit the event
    serviceEvents.emit('contest:started', contestData);
    logApi.info("✅ contest:started event emitted");
  } catch (error) {
    logApi.error("Error testing contest:started event:", error);
  }
}

// Test contest completed notification
async function testContestCompleted(contest) {
  try {
    logApi.info(`Testing contest:completed event with contest: ${contest.name}`);
    
    // Create mock winners data
    const winners = [
      { place: 1, display_name: "SolanaKing", prize_amount: 5.0 },
      { place: 2, display_name: "TokenWizard", prize_amount: 3.0 },
      { place: 3, display_name: "CryptoDegen", prize_amount: 2.0 }
    ];
    
    // Prepare enriched contest data
    const contestData = {
      id: contest.id,
      contest_name: contest.name,
      contest_code: contest.contest_code || 'TEST123',
      prize_pool: parseFloat(contest.prize_pool) || 10,
      participant_count: 24, // Mock data
      start_time: new Date(Date.now() - 7200000), // 2 hours ago
      end_time: new Date(), // Now
      winners: winners
    };
    
    // Emit the event
    serviceEvents.emit('contest:completed', contestData);
    logApi.info("✅ contest:completed event emitted");
  } catch (error) {
    logApi.error("Error testing contest:completed event:", error);
  }
}

// Test token pump notification
async function testTokenPump(token) {
  try {
    logApi.info(`Testing token:pump event with token: ${token.symbol}`);
    
    // Prepare token price data
    const tokenData = {
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      price: parseFloat(token.current_price) || 0.005,
      change_24h: 25.75, // Mock 25.75% increase
      market_cap: token.market_cap || 1500000,
      volume_24h: token.volume_24h || 250000,
      image_url: token.image_url,
      socials: {
        twitter: token.twitter_url || 'https://twitter.com/solana',
        telegram: token.telegram_url || 'https://t.me/solana',
        website: token.website_url || 'https://solana.com'
      }
    };
    
    // Emit the event
    serviceEvents.emit('token:pump', tokenData);
    logApi.info("✅ token:pump event emitted");
  } catch (error) {
    logApi.error("Error testing token:pump event:", error);
  }
}

// Fetch real contests from database
async function fetchRealContests() {
  try {
    const contests = await prisma.contests.findMany({
      take: 5,
      orderBy: {
        created_at: 'desc'
      }
    });
    
    logApi.info(`Fetched ${contests.length} contests from database`);
    return contests.length > 0 ? contests : [createMockContest()];
  } catch (error) {
    logApi.error("Error fetching contests:", error);
    return [createMockContest()];
  }
}

// Fetch real tokens from database
async function fetchRealTokens() {
  try {
    const tokens = await prisma.tokens.findMany({
      where: {
        is_active: true
      },
      take: 5,
      orderBy: {
        created_at: 'desc'
      },
      include: {
        token_prices: true
      }
    });
    
    logApi.info(`Fetched ${tokens.length} tokens from database`);
    
    // Enrich tokens with price data
    const enrichedTokens = tokens.map(token => {
      return {
        ...token,
        current_price: token.token_prices?.price || 0.001,
        market_cap: token.market_cap || 1000000,
        volume_24h: token.volume_24h || 100000
      };
    });
    
    return enrichedTokens.length > 0 ? enrichedTokens : [createMockToken()];
  } catch (error) {
    logApi.error("Error fetching tokens:", error);
    return [createMockToken()];
  }
}

// Create mock contest if no real contests found
function createMockContest() {
  return {
    id: 12345,
    name: "Test Degen Contest",
    contest_code: "TEST123",
    start_time: new Date(Date.now() + 3600000), // 1 hour from now
    prize_pool: "10.0",
    entry_fee: "0.5"
  };
}

// Create mock token if no real tokens found
function createMockToken() {
  return {
    address: "DitHyRMQiSDhn5cnKMJV2CDDt6sVct96YrECiM49pump",
    name: "Pump.fun",
    symbol: "PUMP",
    current_price: 0.002,
    market_cap: 2500000,
    volume_24h: 350000,
    image_url: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
    twitter_url: "https://twitter.com/pump_fun",
    telegram_url: "https://t.me/pump_fun",
    website_url: "https://pump.fun"
  };
}

// Run the test
testBot();