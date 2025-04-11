/**
 * Token Function Testing Script
 * 
 * This script tests the token function calling capability in the AI service.
 * It validates that the token lookup functions work correctly with real data.
 */

import { handleFunctionCall } from '../../services/ai-service/utils/terminal-function-handler.js';
import aiService from '../../services/ai-service/ai-service.js';
import prisma from '../../config/prisma.js';

// Test tokens to look up (real tokens on Solana)
const TEST_TOKENS = [
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'BONK', name: 'Bonk' },
  { symbol: 'JUP', name: 'Jupiter' }
];

/**
 * Run the token function handler tests
 */
async function testTokenFunctions() {
  console.log('\n🔍 TESTING TOKEN FUNCTION HANDLER\n');
  
  try {
    // Initialize the AI service
    console.log('Initializing AI service...');
    await aiService.initialize();
    console.log('AI service initialized successfully.');
    
    // Test getTokenPrice function
    console.log('\n1. Testing getTokenPrice function:');
    for (const token of TEST_TOKENS) {
      console.log(`\nLooking up token: ${token.symbol}`);
      
      // Create a function call object
      const functionCall = {
        function: {
          name: 'getTokenPrice',
          arguments: { tokenSymbol: token.symbol }
        }
      };
      
      // Call the function handler
      const result = await handleFunctionCall(functionCall);
      
      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        continue;
      }
      
      console.log('✅ Success! Token data:');
      console.log(`- Symbol: ${result.symbol}`);
      console.log(`- Name: ${result.name || 'N/A'}`);
      console.log(`- Price: ${result.price || 'N/A'}`);
      console.log(`- 24h Change: ${result.change_24h || 'N/A'}`);
      console.log(`- Market Cap: ${result.market_cap || 'N/A'}`);
      
      // Print all available fields
      console.log('\nAll available fields:');
      Object.entries(result)
        .filter(([key]) => !['social_links', 'tags'].includes(key))
        .forEach(([key, value]) => {
          console.log(`- ${key}: ${value}`);
        });
      
      // Print social links if available
      if (result.social_links && Object.keys(result.social_links).length > 0) {
        console.log('\nSocial Links:');
        Object.entries(result.social_links).forEach(([platform, url]) => {
          console.log(`- ${platform}: ${url}`);
        });
      }
    }
    
    // Test getTokenPriceHistory function
    console.log('\n\n2. Testing getTokenPriceHistory function:');
    const timeframes = ['24h', '7d'];
    
    for (const token of TEST_TOKENS) {
      for (const timeframe of timeframes) {
        console.log(`\nLooking up price history for ${token.symbol} (${timeframe}):`);
        
        // Create a function call object
        const functionCall = {
          function: {
            name: 'getTokenPriceHistory',
            arguments: { 
              tokenSymbol: token.symbol,
              timeframe
            }
          }
        };
        
        // Call the function handler
        const result = await handleFunctionCall(functionCall);
        
        if (result.error) {
          console.log(`❌ Error: ${result.error}`);
          continue;
        }
        
        console.log('✅ Success! History data:');
        console.log(`- Symbol: ${result.symbol}`);
        console.log(`- Timeframe: ${result.timeframe}`);
        console.log(`- Data points: ${result.dataPoints}`);
        
        if (result.history && result.history.length > 0) {
          console.log(`- First point: ${result.history[0].timestamp} -> ${result.history[0].price}`);
          console.log(`- Last point: ${result.history[result.history.length-1].timestamp} -> ${result.history[result.history.length-1].price}`);
        } else {
          console.log('- No history data available');
        }
      }
    }
    
    // Test getTokenPools function
    console.log('\n\n3. Testing getTokenPools function:');
    
    for (const token of TEST_TOKENS) {
      console.log(`\nLooking up pools for ${token.symbol}:`);
      
      // Create a function call object
      const functionCall = {
        function: {
          name: 'getTokenPools',
          arguments: { tokenSymbol: token.symbol }
        }
      };
      
      // Call the function handler
      const result = await handleFunctionCall(functionCall);
      
      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
        continue;
      }
      
      console.log('✅ Success! Pool data:');
      console.log(`- Symbol: ${result.symbol}`);
      console.log(`- Address: ${result.address}`);
      console.log(`- Pool count: ${result.poolCount}`);
      
      if (result.pools && result.pools.length > 0) {
        console.log('\nTop pools:');
        result.pools.forEach((pool, index) => {
          console.log(`${index + 1}. ${pool.dex} - ${pool.address} (Size: ${pool.size})`);
        });
      } else {
        console.log('- No pool data available');
      }
    }
    
    // Test getActiveContests function
    console.log('\n\n4. Testing getActiveContests function:');
    
    // Create a function call object
    const contestFunctionCall = {
      function: {
        name: 'getActiveContests',
        arguments: { limit: 3, includeUpcoming: true }
      }
    };
    
    // Call the function handler
    const contestResult = await handleFunctionCall(contestFunctionCall);
    
    if (contestResult.error) {
      console.log(`❌ Error: ${contestResult.error}`);
    } else {
      console.log('✅ Success! Contest data:');
      console.log(`- Total contests: ${contestResult.count}`);
      
      if (contestResult.contests && contestResult.contests.length > 0) {
        console.log('\nContest list:');
        contestResult.contests.forEach((contest, index) => {
          console.log(`${index + 1}. ${contest.name} (${contest.code}) - ${contest.timeInfo}`);
          console.log(`   Prize: ${contest.prizePool}, Entry: ${contest.entryFee}`);
          console.log(`   Participants: ${contest.participants.current}/${contest.participants.max}`);
        });
      } else {
        console.log('- No active or upcoming contests found');
      }
    }
    
    // Test getUserProfile function
    console.log('\n\n5. Testing getUserProfile function:');
    
    // Let's find a real user first
    console.log('Finding a real user...');
    const usersExist = await prisma.users.findMany({
      take: 1,
      select: { 
        username: true,
        wallet_address: true 
      }
    });
    
    // Use the first user found or fallback to a default for testing
    const testUser = usersExist.length > 0 ? 
      usersExist[0].username || usersExist[0].wallet_address : 
      'branchmanager';
    
    console.log(`Using user: ${testUser}`);
    
    const userProfileFunctionCall = {
      function: {
        name: 'getUserProfile',
        arguments: { usernameOrWallet: testUser }
      }
    };
    
    // Call the function handler
    const userProfileResult = await handleFunctionCall(userProfileFunctionCall);
    
    if (userProfileResult.error) {
      console.log(`❌ Error: ${userProfileResult.error}`);
    } else {
      console.log('✅ Success! User profile data:');
      console.log(`- Username: ${userProfileResult.username}`);
      console.log(`- Nickname: ${userProfileResult.nickname}`);
      console.log(`- Wallet: ${userProfileResult.wallet_address}`);
      console.log(`- Role: ${userProfileResult.role}`);
      console.log(`- Level: ${userProfileResult.level.number} (${userProfileResult.level.title})`);
      console.log(`- Experience: ${userProfileResult.experience.current}`);
      
      console.log('\nUser Stats:');
      console.log(`- Contests Entered: ${userProfileResult.stats.contests_entered}`);
      console.log(`- Contests Won: ${userProfileResult.stats.contests_won}`);
      console.log(`- Total Prize Money: ${userProfileResult.stats.total_prize_money}`);
      
      if (userProfileResult.achievements && userProfileResult.achievements.length > 0) {
        console.log('\nRecent Achievements:');
        userProfileResult.achievements.slice(0, 3).forEach((achievement, index) => {
          console.log(`${index + 1}. ${achievement.type} (${achievement.tier})`);
        });
      }
    }
    
    // Test getTopUsers function
    console.log('\n\n6. Testing getTopUsers function:');
    
    // Test with experience category instead of contests_won
    const topUsersFunctionCall = {
      function: {
        name: 'getTopUsers',
        arguments: { category: 'experience', limit: 3 }
      }
    };
    
    // Call the function handler
    const topUsersResult = await handleFunctionCall(topUsersFunctionCall);
    
    if (topUsersResult.error) {
      console.log(`❌ Error: ${topUsersResult.error}`);
    } else {
      console.log(`✅ Success! Top users by ${topUsersResult.category}:`);
      console.log(`- Total users: ${topUsersResult.count}`);
      
      if (topUsersResult.users && topUsersResult.users.length > 0) {
        console.log('\nTop Users:');
        topUsersResult.users.forEach((user, index) => {
          console.log(`${index + 1}. ${user.username} (${user.nickname}), Level ${user.level}`);
          console.log(`   Experience: ${user.experience}`);
        });
      } else {
        console.log('- No users found with experience points');
      }
    }
    
    // Test getTokenMetricsHistory function
    console.log('\n\n7. Testing getTokenMetricsHistory function:');
    
    // Test with volume metric
    const metricsFunctionCall = {
      function: {
        name: 'getTokenMetricsHistory',
        arguments: { 
          tokenSymbol: 'SOL', 
          metricType: 'price',
          timeframe: '24h' 
        }
      }
    };
    
    // Call the function handler
    const metricsResult = await handleFunctionCall(metricsFunctionCall);
    
    if (metricsResult.error) {
      console.log(`❌ Error: ${metricsResult.error}`);
    } else {
      console.log('✅ Success! Token metrics history:');
      console.log(`- Symbol: ${metricsResult.symbol}`);
      console.log(`- Metric: ${metricsResult.metric}`);
      console.log(`- Timeframe: ${metricsResult.timeframe}`);
      console.log(`- Data points: ${metricsResult.dataPoints}`);
      
      if (metricsResult.history && metricsResult.history.length > 0) {
        console.log('\nHistory sample:');
        const sample = metricsResult.history.slice(0, Math.min(3, metricsResult.history.length));
        sample.forEach((dataPoint, index) => {
          console.log(`${index + 1}. ${new Date(dataPoint.timestamp).toLocaleString()} - ${dataPoint.price}`);
        });
      } else {
        console.log('- No history data available');
      }
    }
    
    // Test admin-only function with user role
    console.log('\n\n8. Testing admin-only function with user role:');
    
    const adminFunctionCall = {
      function: {
        name: 'getSystemSettings',
        arguments: {}
      }
    };
    
    // Call with user role (should be denied)
    const adminResultRegular = await handleFunctionCall(adminFunctionCall, { userRole: 'user' });
    
    console.log(adminResultRegular.error ? 
      `✅ Expected error: ${adminResultRegular.error}` : 
      '❌ Failed: Admin function allowed for regular user');
    
    // Call with admin role (should be allowed)
    const adminResultAdmin = await handleFunctionCall(adminFunctionCall, { userRole: 'admin' });
    
    console.log(!adminResultAdmin.error ? 
      '✅ Success: Admin function allowed for admin role' : 
      `❌ Failed: Admin function denied for admin: ${adminResultAdmin.error}`);
    
    console.log('\n🎉 TERMINAL FUNCTION TESTS COMPLETED\n');
  } catch (error) {
    console.error('❌ Error during token function tests:', error);
  } finally {
    await prisma.$disconnect();
    console.log('Test complete, exiting...');
    process.exit(0);
  }
}

// Run the tests
testTokenFunctions();