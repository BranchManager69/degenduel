// Test the AI log analyzer service log analysis functionality

import { analyzeServiceLogs } from '../services/ai-service/analyzers/log-analyzer.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

// Mock AI service for testing
const mockAiService = {
  name: 'TestAIService',
  logger: logApi.forService('ai_service_test'),
  generateChatCompletion: async (messages, options) => {
    console.log('AI would analyze this many messages:', messages.length);
    console.log('Message content length:', messages[0].content.length);
    
    // Return a mock analysis result
    return {
      content: `AI Analysis Summary:
      
This is a simulated AI analysis of the service logs. In a real analysis, GPT would identify patterns, errors, and insights based on the logs provided.

Key findings:
1. Several INFO level logs showing normal operation
2. Some ERROR logs that might indicate issues
3. Performance metrics showing reasonable response times
4. No critical system failures detected

Recommendations:
- Continue monitoring the service
- Review ERROR logs for potential issues
- Consider optimizing slower operations`
    };
  }
};

async function testServiceLogAnalysis() {
  console.log('Testing AI service log analysis...');
  
  // First, check if we have enough service logs
  const logCount = await prisma.service_logs.count();
  console.log(`Current service log count: ${logCount}`);
  
  // Run analysis on the solana_engine service
  console.log('Running analysis on solana_engine service logs...');
  const solanaResult = await analyzeServiceLogs(mockAiService, 'solana_engine');
  
  if (solanaResult) {
    console.log('Analysis completed successfully!');
    console.log('Summary:', solanaResult.summary);
    console.log('Logs analyzed:', solanaResult.logsAnalyzed);
  } else {
    console.log('Analysis was skipped (not enough logs or other issue)');
    
    // Add some more logs for testing
    console.log('Adding test logs for solana_engine...');
    await addTestLogs('solana_engine', 10);
    
    // Try the analysis again
    console.log('Retrying analysis...');
    const retryResult = await analyzeServiceLogs(mockAiService, 'solana_engine');
    
    if (retryResult) {
      console.log('Analysis completed successfully after adding logs!');
      console.log('Summary:', retryResult.summary);
      console.log('Logs analyzed:', retryResult.logsAnalyzed);
    } else {
      console.log('Analysis still failed after adding logs.');
    }
  }
  
  // Check if analysis was stored in database
  const analysisCount = await prisma.ai_service_log_analyses.count();
  console.log(`Service log analyses in database: ${analysisCount}`);
}

// Helper function to add test logs
async function addTestLogs(service, count) {
  for (let i = 0; i < count; i++) {
    const level = ['info', 'warn', 'error'][Math.floor(Math.random() * 3)];
    const message = `Test log #${i + 1} for ${service}`;
    const details = { test: true, iteration: i + 1 };
    
    await logApi.serviceLog.write(
      service,
      level,
      message,
      details,
      { metadata: 'test run' },
      'test_event',
      Math.floor(Math.random() * 100) + 50,
      null
    );
  }
  
  console.log(`Added ${count} test logs for ${service}`);
}

// Run the test
testServiceLogAnalysis()
  .then(() => {
    console.log('Test completed successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });