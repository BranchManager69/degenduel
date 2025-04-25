/**
 * Terminal Function Tests Runner
 * 
 * This script runs tests for the terminal function handler used by the AI service.
 * It provides a way to test the OpenAI responses API function calling implementation.
 */

import { handleFunctionCall, TERMINAL_FUNCTIONS } from '../services/ai-service/utils/terminal-function-handler.js';
import {
  formatNumber,
  handleGetTokenMetricsHistory,
  handleGetPlatformActivity,
  handleGetServiceStatus,
  handleGetSystemSettings,
  handleGetWebSocketStats,
  handleGetIPBanStatus,
  handleGetDiscordWebhookEvents
} from '../services/ai-service/utils/additional-functions.js';

/**
 * Run basic tests for the terminal functions
 */
async function runTests() {
  console.log('=== Terminal Function Tests ===');
  
  try {
    // Test a basic token price function call
    console.log('\n-- Testing getTokenPrice function --');
    const tokenPriceResult = await handleFunctionCall({
      function: {
        name: 'getTokenPrice',
        arguments: JSON.stringify({ tokenSymbol: 'SOL' }) 
      }
    });
    console.log('Result:', JSON.stringify(tokenPriceResult, null, 2));
    
    // Test token price history function
    console.log('\n-- Testing getTokenPriceHistory function --');
    const historyResult = await handleFunctionCall({
      function: {
        name: 'getTokenPriceHistory',
        arguments: JSON.stringify({ 
          tokenSymbol: 'SOL',
          timeframe: '24h'
        }) 
      }
    });
    console.log('Result:', 
      historyResult.error ? 
        historyResult.error : 
        `Found ${historyResult.dataPoints} data points for ${historyResult.symbol}`
    );
    
    // Test token metrics history function
    console.log('\n-- Testing getTokenMetricsHistory function --');
    const metricsResult = await handleFunctionCall({
      function: {
        name: 'getTokenMetricsHistory',
        arguments: JSON.stringify({ 
          tokenSymbol: 'SOL',
          metricType: 'price',
          timeframe: '7d'
        }) 
      }
    });
    console.log('Result:',
      metricsResult.error ? 
        metricsResult.error : 
        `Found ${metricsResult.dataPoints} data points for ${metricsResult.symbol} ${metricsResult.metric}`
    );
    
    // Test active contests function
    console.log('\n-- Testing getActiveContests function --');
    const contestsResult = await handleFunctionCall({
      function: {
        name: 'getActiveContests',
        arguments: JSON.stringify({ 
          limit: 3,
          includeUpcoming: true
        }) 
      }
    });
    console.log('Result:',
      contestsResult.error ? 
        contestsResult.error : 
        `Found ${contestsResult.count} active/upcoming contests`
    );
    
    // Test user profile function
    console.log('\n-- Testing getUserProfile function --');
    // Note: Replace with a real username in your system
    const userResult = await handleFunctionCall({
      function: {
        name: 'getUserProfile',
        arguments: JSON.stringify({ 
          usernameOrWallet: 'branch' // Replace with a real username
        }) 
      }
    });
    console.log('Result:',
      userResult.error ? 
        userResult.error : 
        `Found user ${userResult.username} (Level ${userResult.level.number} ${userResult.level.title})`
    );
    
    // Test platform activity function
    console.log('\n-- Testing getPlatformActivity function --');
    const activityResult = await handleFunctionCall({
      function: {
        name: 'getPlatformActivity',
        arguments: JSON.stringify({ 
          activityType: 'contests',
          limit: 3
        }) 
      }
    });
    console.log('Result:',
      activityResult.error ? 
        activityResult.error : 
        `Found ${activityResult.count} ${activityResult.type} activities`
    );
    
    // Test an admin-only function with regular user role
    console.log('\n-- Testing admin function with regular user role --');
    const adminFunctionRegularUser = await handleFunctionCall({
      function: {
        name: 'getSystemSettings',
        arguments: '{}'
      }
    }, { userRole: 'user' });
    console.log('Result:', adminFunctionRegularUser.error ? 
      `Access denied as expected: ${adminFunctionRegularUser.error}` : 
      'FAILURE: Admin function incorrectly allowed for regular user'
    );
    
    // Test an admin-only function with admin role
    console.log('\n-- Testing admin function with admin role --');
    const adminFunctionAdminUser = await handleFunctionCall({
      function: {
        name: 'getSystemSettings',
        arguments: '{}'
      }
    }, { userRole: 'admin' });
    console.log('Result:',
      adminFunctionAdminUser.error ? 
        `Error: ${adminFunctionAdminUser.error}` : 
        `Success: Found ${adminFunctionAdminUser.count} system settings`
    );
    
  } catch (error) {
    console.error('Test error:', error);
  }
}

// Run the tests
runTests()
  .then(() => {
    console.log('\nTests completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running tests:', err);
    process.exit(1);
  });