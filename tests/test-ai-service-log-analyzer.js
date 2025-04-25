// Test the AI service log analyzer on all services

import { analyzeServiceLogs } from '../services/ai-service/analyzers/log-analyzer.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';

// Mock AI service for testing
const mockAiService = {
  name: 'TestAIService',
  logger: logApi.forService('ai_service_test'),
  generateChatCompletion: async (messages, options) => {
    console.log(`Analyzing ${options?.serviceName || 'unknown service'}: message content length = ${messages[0].content.length} chars`);
    
    // Return a mock analysis result
    return {
      content: `AI Analysis Summary for ${options?.serviceName || 'service'}:
      
This is a simulated AI analysis of the service logs. In a real analysis, GPT would identify patterns, errors, and insights based on the logs provided.

Key findings:
1. Several INFO level logs showing normal operation
2. Some ERROR logs that might indicate issues with external connections
3. Performance metrics showing reasonable response times
4. No critical system failures detected

Recommendations:
- Continue monitoring the service
- Review ERROR logs for potential issues
- Consider optimizing slower operations`
    };
  }
};

// Test the service log analyzer on a specified service
async function testAnalyzerForService(serviceName) {
  console.log(`Testing analysis for ${serviceName}...`);
  
  // Get count of logs for this service
  const logCount = await prisma.service_logs.count({
    where: { service: serviceName }
  });
  
  console.log(`Found ${logCount} logs for ${serviceName}`);
  
  if (logCount < 5) {
    console.log(`Skipping analysis - insufficient logs for ${serviceName}`);
    return false;
  }
  
  // Custom options for the mock AI service
  const options = { serviceName };
  mockAiService.generateChatCompletion = async (messages, _) => {
    console.log(`Analyzing ${serviceName}: message content length = ${messages[0].content.length} chars`);
    
    // Return a mock analysis result
    return {
      content: `AI Analysis Summary for ${serviceName}:
      
This is a simulated AI analysis of the service logs. In a real analysis, GPT would identify patterns, errors, and insights based on the logs provided.

Key findings:
1. Several INFO level logs showing normal operation
2. Some ERROR logs that might indicate issues with external connections
3. Performance metrics showing reasonable response times
4. No critical system failures detected

Recommendations:
- Continue monitoring the service
- Review ERROR logs for potential issues
- Consider optimizing slower operations`
    };
  };
  
  // Run the analyzer
  const result = await analyzeServiceLogs(mockAiService, serviceName);
  
  if (result) {
    console.log(`✅ Analysis completed for ${serviceName}`);
    // Store the result in the database
    try {
      const dbResult = await prisma.ai_service_log_analyses.create({
        data: {
          service: serviceName,
          summary: result.summary,
          analyzed_at: new Date(),
          log_count: result.logsAnalyzed,
          time_window_hours: 24,
          created_by: 'test'
        }
      });
      console.log(`Saved analysis #${dbResult.id} to database`);
    } catch (err) {
      console.error(`Error saving analysis to database:`, err.message);
    }
    return true;
  } else {
    console.log(`❌ Analysis failed for ${serviceName}`);
    return false;
  }
}

// Main test function
async function testAllServices() {
  console.log('Testing AI service log analyzer on all services...');
  
  // Get all service names
  const serviceNames = [
    ...Object.values(SERVICE_NAMES),
    'solana_engine', // Add legacy service names
    'admin_wallet',
    'market_data',
    'token_refresh',
    'ANALYTICS',
    'WS_BROADCASTER',
    'AUTH',
    'PRIVY_AUTH'
  ];
  
  let successCount = 0;
  let failCount = 0;
  
  // Test each service
  for (const serviceName of serviceNames) {
    const success = await testAnalyzerForService(serviceName);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    console.log('-'.repeat(50));
  }
  
  // Show summary
  console.log('\nTest summary:');
  console.log(`Total services tested: ${serviceNames.length}`);
  console.log(`Successful analyses: ${successCount}`);
  console.log(`Failed analyses: ${failCount}`);
  
  // Count analyses in database
  const analysisCount = await prisma.ai_service_log_analyses.count();
  console.log(`\nTotal service log analyses in database: ${analysisCount}`);
  
  return {
    total: serviceNames.length,
    success: successCount,
    fail: failCount
  };
}

// Run the tests
testAllServices()
  .then(result => {
    console.log('\nAll tests completed.');
    if (result.fail === 0) {
      console.log('All service analyzers working correctly! ✅');
    } else {
      console.log(`Some analyzers failed (${result.fail}/${result.total}) ❌`);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });