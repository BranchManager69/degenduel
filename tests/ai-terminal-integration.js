/**
 * AI Terminal Integration Test
 * 
 * This script tests the integration of the AI service with OpenAI's responses API,
 * focusing on the token function calling capabilities.
 */

import { generateTokenAIResponse } from '../services/ai-service/ai-service.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Ensure the environment is loaded
import config from '../config/config.js';

/**
 * Run an AI terminal integration test
 */
async function runIntegrationTest() {
  console.log('=== AI Terminal Integration Test ===');
  console.log('Testing integration with OpenAI Responses API\n');
  
  // Check for API key
  if (!config.api_keys?.openai) {
    console.error('Error: No OpenAI API key configured. Please set the OPENAI_API_KEY environment variable.');
    process.exit(1);
  }
  
  try {
    // Test different queries with function calling
    const testCases = [
      {
        name: 'Token price query',
        messages: [
          {
            role: 'user',
            content: 'What is the current price of Solana?'
          }
        ]
      },
      {
        name: 'Token price history query',
        messages: [
          {
            role: 'user',
            content: 'Show me SOL price trends over the last 7 days'
          }
        ]
      },
      {
        name: 'Active contests query',
        messages: [
          {
            role: 'user',
            content: 'Are there any active trading contests right now?'
          }
        ]
      },
      {
        name: 'Platform activity query',
        messages: [
          {
            role: 'user',
            content: 'Show me recent contest activity on the platform'
          }
        ]
      },
      {
        name: 'Admin function with regular user',
        messages: [
          {
            role: 'user',
            content: 'Show me the system settings'
          }
        ],
        options: { userRole: 'user' }
      }
    ];
    
    // Process each test case
    for (const testCase of testCases) {
      console.log(`\n-- Testing: ${testCase.name} --`);
      console.log(`User query: "${testCase.messages[0].content}"`);
      
      const options = {
        ...(testCase.options || {}),
        userId: 'test-user',
        walletAddress: 'test-wallet',
        loadoutType: 'terminal',
        userRole: testCase.options?.userRole || 'user'
      };
      
      const startTime = Date.now();
      const result = await generateTokenAIResponse(testCase.messages, options);
      const duration = Date.now() - startTime;
      
      console.log(`Response (${duration}ms):`);
      console.log(result.content);
      
      if (result.functionCalled) {
        console.log(`Function called: ${result.functionCalled}`);
      }
      
      console.log('-'.repeat(50));
    }
    
  } catch (error) {
    console.error('Integration test error:', error);
  }
}

// Run the integration test
runIntegrationTest()
  .then(() => {
    console.log('\nIntegration test completed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running integration test:', err);
    process.exit(1);
  });