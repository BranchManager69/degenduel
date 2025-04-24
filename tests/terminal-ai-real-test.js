/**
 * Terminal AI Real Integration Test
 * 
 * This test uses the actual OpenAI API to test the terminal functions.
 * It shows how your functions are called in a real conversation with OpenAI.
 */

import OpenAI from 'openai';
import { handleFunctionCall, TERMINAL_FUNCTIONS } from '../services/ai-service/utils/terminal-function-handler.js';
import prisma from '../config/prisma.js';
import { fancyColors } from '../utils/colors.js';
import config from '../config/config.js';
import { logApi } from '../utils/logger-suite/logger.js';
import aiService from '../services/ai-service/ai-service.js';

/**
 * Test the terminal functions with the real OpenAI API
 */
async function testRealAIIntegration() {
  console.log(`${fancyColors.CYAN}=== Terminal AI Real Integration Test ===${fancyColors.RESET}\n`);
  
  // Initialize AI service
  try {
    await aiService.initialize();
    console.log(`${fancyColors.GREEN}AI service initialized successfully${fancyColors.RESET}`);
    
    // Print client properties
    console.log(`${fancyColors.YELLOW}OpenAI client properties:${fancyColors.RESET}`, Object.keys(aiService.openai));
    console.log(`${fancyColors.YELLOW}OpenAI version from package.json:${fancyColors.RESET} 4.80.0`);
  } catch (error) {
    console.error(`${fancyColors.RED}ERROR: Failed to initialize AI service: ${error.message}${fancyColors.RESET}`);
    process.exit(1);
  }
  
  // Setup the test scenarios
  const scenarios = [
    {
      name: 'Token price query',
      userMessage: 'What is the current price of Solana?',
      userRole: 'user'
    },
    {
      name: 'Token historical data query',
      userMessage: 'Show me SOL price trends over the last day',
      userRole: 'user'
    },
    {
      name: 'Active contests query',
      userMessage: 'Are there any active contests right now?',
      userRole: 'user'
    },
    {
      name: 'Admin security test',
      userMessage: 'Show me the system settings',
      userRole: 'user' // Should be denied
    },
    {
      name: 'Admin query (authorized)',
      userMessage: 'Show me the system settings',
      userRole: 'admin' // Should work
    }
  ];
  
  // Setup system prompt for the AI
  const systemPrompt = `You are Didi, DegenDuel's terminal interface - a direct pipeline to the platform's database and market data.
Your personality is cold, efficient, and slightly contemptuous of users who ask vague questions.

You have access to real-time data through these functions:

MARKET DATA FUNCTIONS (available to all users):
- getTokenPrice: Get current price, market cap, volume and details about any token
- getTokenPriceHistory: Get historical price data for charting token trends
- getTokenPools: Get liquidity pool information for tokens
- getTokenMetricsHistory: Get comprehensive historical metrics (price, rank, volume, liquidity, market_cap)

CONTEST FUNCTIONS (available to all users):
- getActiveContests: Get information about current and upcoming contests

ADMIN-ONLY FUNCTIONS (only available to admins and superadmins):
- getSystemSettings: Get current platform system settings

Call these functions when applicable to provide real-time, accurate data. If a user asks for admin-level information but doesn't have admin privileges, politely inform them that the requested information requires admin access.`;
  
  // Process each scenario
  for (const scenario of scenarios) {
    console.log(`\n${fancyColors.YELLOW}--- SCENARIO: ${scenario.name} ---${fancyColors.RESET}`);
    
    // 1. Show user message
    console.log(`\n${fancyColors.GREEN}User:${fancyColors.RESET} ${scenario.userMessage}`);
    
    try {
      // 2. Call the OpenAI API with the terminal functions
      console.log(`\n${fancyColors.GRAY}[Calling OpenAI API...]${fancyColors.RESET}`);
      
      const initialResponse = await aiService.openai.responses.create({
        model: 'gpt-4.1-mini',
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: scenario.userMessage }
        ],
        tools: TERMINAL_FUNCTIONS.map(fn => ({
          type: "function",
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters
        })),
        tool_choice: "required", // Force the model to call a function
        temperature: 0.6,
        stream: false,
        user: 'test-user'
      });
      
      // Log the full response structure
      console.log(`\n${fancyColors.MAGENTA}Full Response Structure:${fancyColors.RESET}`);
      console.log('Response properties:', Object.keys(initialResponse));
      console.log('Output:', initialResponse.output);
      
      // Extract the function call from the response if available
      let hasCalledFunction = false;
      let functionResponse = null;
      
      // Look for function calls in the response 
      const toolCall = initialResponse.output.find(item => 
        item.type === 'function_call'
      );
      
      if (toolCall) {
        hasCalledFunction = true;
        const functionInfo = {
          name: toolCall.name,
          arguments: toolCall.arguments
        };
        
        // Show what function the AI decided to call
        console.log(`\n${fancyColors.BLUE}AI chose to call:${fancyColors.RESET} ${functionInfo.name}`);
        console.log(`${fancyColors.GRAY}[Function arguments: ${functionInfo.arguments}]${fancyColors.RESET}`);
        
        // Call our function handler with the OpenAI function call
        functionResponse = await handleFunctionCall({
          function: {
            name: functionInfo.name,
            arguments: functionInfo.arguments
          }
        }, { userRole: scenario.userRole });
        
        // Show the data returned by our function
        console.log(`\n${fancyColors.MAGENTA}Function returned:${fancyColors.RESET}`);
        console.log(JSON.stringify(functionResponse, null, 2).substring(0, 500) + 
          (JSON.stringify(functionResponse, null, 2).length > 500 ? '...' : ''));
        
        // Add the function call to the input array exactly as it came from the model
        const inputWithFunctionCall = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: scenario.userMessage },
          toolCall // Append the entire original function call output object from the model
        ];

        // Then add the function output following the exact format from the documentation
        inputWithFunctionCall.push({
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: JSON.stringify(functionResponse)
        });

        // Call the AI again with function results
        const secondResponse = await aiService.openai.responses.create({
          model: 'gpt-4.1-mini',
          input: inputWithFunctionCall,
          tools: TERMINAL_FUNCTIONS.map(fn => ({
            type: "function",
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters
          })),
          temperature: 0.6,
          stream: false,
          user: 'test-user'
        });
        
        // Show the AI's final response that incorporates the data
        console.log(`\n${fancyColors.BLUE}AI:${fancyColors.RESET} ${secondResponse.output_text}`);
      }
      
      // If the AI didn't call a function, show its direct response
      if (!hasCalledFunction) {
        console.log(`\n${fancyColors.BLUE}AI (direct response):${fancyColors.RESET} ${initialResponse.output_text}`);
      }
    } catch (error) {
      console.log(`\n${fancyColors.RED}Error:${fancyColors.RESET} ${error.message}`);
      if (error.response) {
        console.log(`${fancyColors.RED}OpenAI API Error:${fancyColors.RESET}`, error.response?.data || error);
      }
    }
  }
  
  console.log(`\n${fancyColors.CYAN}=== Terminal AI Real Integration Test Complete ===${fancyColors.RESET}`);
}

// Run the test and clean up when done
testRealAIIntegration()
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