/**
 * Terminal AI Integration Test
 * 
 * This test simulates how the OpenAI responses API would call our terminal functions
 * and shows how the responses would be used in a conversation flow.
 */

import { handleFunctionCall, TERMINAL_FUNCTIONS } from '../services/ai-service/utils/terminal-function-handler.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';

/**
 * Test the complete AI response flow with terminal functions
 */
async function testAIIntegration() {
  console.log(`${fancyColors.CYAN}=== Terminal AI Integration Test ===${fancyColors.RESET}\n`);
  
  // Define test scenarios - pairs of user messages and AI function calls
  const scenarios = [
    {
      name: 'Token price query',
      userMessage: 'What is the current price of Solana?',
      aiChoiceFunction: {
        function: {
          name: 'getTokenPrice',
          arguments: JSON.stringify({ tokenSymbol: 'SOL' })
        }
      }
    },
    {
      name: 'Token historical data query',
      userMessage: 'Show me SOL price trends over the last 24 hours',
      aiChoiceFunction: {
        function: {
          name: 'getTokenPriceHistory',
          arguments: JSON.stringify({ tokenSymbol: 'SOL', timeframe: '24h' })
        }
      }
    },
    {
      name: 'Contest information query',
      userMessage: 'Are there any active contests right now?',
      aiChoiceFunction: {
        function: {
          name: 'getActiveContests',
          arguments: JSON.stringify({ limit: 3, includeUpcoming: true })
        }
      }
    },
    {
      name: 'Platform activity query',
      userMessage: 'What\'s happening on the platform right now?',
      aiChoiceFunction: {
        function: {
          name: 'getPlatformActivity',
          arguments: JSON.stringify({ activityType: 'contests', limit: 3 })
        }
      }
    },
    {
      name: 'Admin function by regular user (denied)',
      userMessage: 'Show me the system settings',
      aiChoiceFunction: {
        function: {
          name: 'getSystemSettings',
          arguments: '{}'
        }
      },
      userRole: 'user'
    },
    {
      name: 'Admin function by admin (allowed)',
      userMessage: 'Show me the system settings',
      aiChoiceFunction: {
        function: {
          name: 'getSystemSettings',
          arguments: '{}'
        }
      },
      userRole: 'admin'
    }
  ];
  
  // Process each scenario
  for (const scenario of scenarios) {
    console.log(`\n${fancyColors.YELLOW}--- SCENARIO: ${scenario.name} ---${fancyColors.RESET}`);
    
    // 1. Show user message
    console.log(`\n${fancyColors.GREEN}User:${fancyColors.RESET} ${scenario.userMessage}`);
    
    // 2. Show AI's decision to call a function
    console.log(`\n${fancyColors.BLUE}AI:${fancyColors.RESET} I'll get that information for you...`);
    console.log(`${fancyColors.GRAY}[AI selects function: ${scenario.aiChoiceFunction.function.name}]${fancyColors.RESET}`);
    
    // 3. Call the function
    try {
      const functionResponse = await handleFunctionCall(
        scenario.aiChoiceFunction, 
        { userRole: scenario.userRole || 'user' }
      );
      
      // 4. Show the raw function response
      console.log(`\n${fancyColors.MAGENTA}Function Response:${fancyColors.RESET}`);
      console.log(JSON.stringify(functionResponse, null, 2).substring(0, 500) + 
        (JSON.stringify(functionResponse, null, 2).length > 500 ? '...' : ''));
      
      // 5. Generate a simulated AI response based on the function data
      let aiResponse = '';
      
      if (functionResponse.error) {
        if (functionResponse.error.includes('Permission denied')) {
          aiResponse = "I'm sorry, but that information is only available to administrators. Is there something else I can help you with?";
        } else {
          aiResponse = `I'm having trouble retrieving that information. Error: ${functionResponse.error}`;
        }
      } else {
        // Generate different responses based on function type
        const fnName = scenario.aiChoiceFunction.function.name;
        
        if (fnName === 'getTokenPrice') {
          aiResponse = `The current price of ${functionResponse.name} (${functionResponse.symbol}) is $${functionResponse.price}.`;
          if (functionResponse.price_24h_change) {
            const changeDirection = parseFloat(functionResponse.price_24h_change) >= 0 ? 'up' : 'down';
            aiResponse += ` It has gone ${changeDirection} ${Math.abs(functionResponse.price_24h_change)}% in the last 24 hours.`;
          }
          if (functionResponse.market_cap) {
            aiResponse += ` The market cap is ${functionResponse.market_cap}.`;
          }
        } else if (fnName === 'getTokenPriceHistory') {
          aiResponse = `Here's the price history for ${functionResponse.symbol} over the last ${functionResponse.timeframe}. `;
          
          if (functionResponse.history && functionResponse.history.length > 0) {
            const firstPrice = parseFloat(functionResponse.history[0].price);
            const lastPrice = parseFloat(functionResponse.history[functionResponse.history.length - 1].price);
            const pctChange = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(2);
            
            aiResponse += `The price ${pctChange >= 0 ? 'increased' : 'decreased'} by ${Math.abs(pctChange)}% `;
            aiResponse += `from $${firstPrice.toFixed(2)} to $${lastPrice.toFixed(2)} during this period.`;
          } else {
            aiResponse += `No price history data is available for this timeframe.`;
          }
        } else if (fnName === 'getActiveContests') {
          if (functionResponse.count === 0) {
            aiResponse = `There are no active contests at the moment.`;
          } else {
            aiResponse = `There ${functionResponse.count === 1 ? 'is' : 'are'} ${functionResponse.count} active or upcoming contest${functionResponse.count !== 1 ? 's' : ''}.`;
            
            if (functionResponse.contests && functionResponse.contests.length > 0) {
              aiResponse += ` The most recent is "${functionResponse.contests[0].name}" with a prize pool of ${functionResponse.contests[0].prizePool} SOL.`;
              aiResponse += ` ${functionResponse.contests[0].timeInfo}`;
            }
          }
        } else if (fnName === 'getPlatformActivity') {
          aiResponse = `Here's the latest platform activity for ${functionResponse.type}: `;
          
          if (functionResponse.count === 0) {
            aiResponse += `No recent ${functionResponse.type} activity to report.`;
          } else {
            aiResponse += `Found ${functionResponse.count} recent activities. `;
            
            if (functionResponse.activities && functionResponse.activities.length > 0) {
              if (functionResponse.type === 'contests') {
                const activity = functionResponse.activities[0];
                aiResponse += `Most recent: "${activity.name}" (${activity.status}) with ${activity.participants} participants.`;
              } else {
                aiResponse += `Various activities are happening across the platform.`;
              }
            }
          }
        } else if (fnName === 'getSystemSettings') {
          aiResponse = `I've found ${functionResponse.count} system settings. `;
          
          if (functionResponse.settings && functionResponse.settings.length > 0) {
            aiResponse += `Some examples include: ${functionResponse.settings.slice(0, 3).map(s => s.key).join(', ')}.`;
          }
          
          aiResponse += ` These settings control various aspects of the platform's operation.`;
        } else {
          aiResponse = `I've retrieved the information you requested.`;
        }
      }
      
      // 6. Show the AI's response
      console.log(`\n${fancyColors.BLUE}AI:${fancyColors.RESET} ${aiResponse}`);
      
    } catch (error) {
      console.log(`\n${fancyColors.RED}Error:${fancyColors.RESET} ${error.message}`);
    }
  }
  
  console.log(`\n${fancyColors.CYAN}=== Terminal AI Integration Test Complete ===${fancyColors.RESET}`);
}

// Run the test and disconnect from the database when done
testAIIntegration()
  .catch(error => {
    console.error(`${fancyColors.RED}Test error:${fancyColors.RESET}`, error);
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch (e) {
      console.error(`${fancyColors.RED}Error disconnecting from database:${fancyColors.RESET}`, e);
    }
    process.exit(0);
  });