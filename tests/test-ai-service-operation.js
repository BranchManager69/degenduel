/**
 * Test script for AI service onPerformOperation
 * 
 * This script tests the AI service's periodic operation which includes:
 * - Client error analysis
 * - Admin action analysis
 * - Log file analysis
 */

import aiService from '../services/ai-service/ai-service.js';
import prisma from '../config/prisma.js';

async function testAIServiceOperation() {
  console.log('🤖 Testing AI Service operation...');
  
  try {
    // Initialize the AI service
    console.log('Initializing AI service...');
    await aiService.initialize();
    
    // Set permissive limits for testing
    console.log('\n⚙️ Setting permissive limits for testing...');
    aiService.config.analysis = aiService.config.analysis || {};
    
    // Enable all analysis types
    aiService.config.analysis.clientErrors = aiService.config.analysis.clientErrors || {};
    aiService.config.analysis.clientErrors.enabled = true;
    aiService.config.analysis.clientErrors.minErrorsToAnalyze = 1;
    
    aiService.config.analysis.adminActions = aiService.config.analysis.adminActions || {};
    aiService.config.analysis.adminActions.enabled = true;
    aiService.config.analysis.adminActions.minActionsToAnalyze = 1;
    
    aiService.config.analysis.logs = aiService.config.analysis.logs || {};
    aiService.config.analysis.logs.enabled = true;
    
    aiService.config.analysis.logs.generalLogs = aiService.config.analysis.logs.generalLogs || {};
    aiService.config.analysis.logs.generalLogs.enabled = true;
    aiService.config.analysis.logs.generalLogs.maxLines = 1000;
    
    aiService.config.analysis.logs.errorLogs = aiService.config.analysis.logs.errorLogs || {};
    aiService.config.analysis.logs.errorLogs.enabled = true;
    aiService.config.analysis.logs.errorLogs.maxErrors = 50;
    
    // Run the operation
    console.log('\n🔄 Running AI service operation...');
    const results = await aiService.onPerformOperation();
    
    console.log('\n📊 Operation results:');
    if (results.clientErrors) {
      console.log('✅ Client error analysis completed');
      console.log('- Errors analyzed:', results.clientErrors.errorsAnalyzed);
      console.log('- Summary excerpt:', results.clientErrors.summary.substring(0, 100) + '...');
    } else {
      console.log('❌ Client error analysis skipped or failed');
    }
    
    if (results.adminActions) {
      console.log('✅ Admin action analysis completed');
      console.log('- Actions analyzed:', results.adminActions.actionsAnalyzed);
      console.log('- Summary excerpt:', results.adminActions.summary.substring(0, 100) + '...');
    } else {
      console.log('❌ Admin action analysis skipped or failed');
    }
    
    if (results.logs) {
      if (results.logs.general) {
        console.log('✅ General log analysis completed');
        console.log('- Log file:', results.logs.general.logFile);
        console.log('- Lines analyzed:', results.logs.general.linesAnalyzed);
        console.log('- Summary excerpt:', results.logs.general.summary.substring(0, 100) + '...');
      } else {
        console.log('❌ General log analysis skipped or failed');
      }
      
      if (results.logs.error) {
        console.log('✅ Error log analysis completed');
        console.log('- Errors analyzed:', results.logs.error.errorsAnalyzed);
        console.log('- Summary excerpt:', results.logs.error.summary.substring(0, 100) + '...');
      } else {
        console.log('❌ Error log analysis skipped or failed');
      }
      
      if (results.logs.service && Object.keys(results.logs.service).length > 0) {
        console.log('✅ Service log analysis completed for:');
        for (const [service, result] of Object.entries(results.logs.service)) {
          if (result) {
            console.log(`- ${service}: ${result.logsAnalyzed || 'unknown'} logs analyzed`);
          }
        }
      } else {
        console.log('❌ Service log analysis skipped or failed');
      }
    } else {
      console.log('❌ Log analysis was not included in results');
    }
    
    console.log('\n📈 AI service performance stats:');
    console.log('- Last operation time:', aiService.stats.performance.lastOperationTimeMs, 'ms');
    console.log('- Total operations:', aiService.stats.operations.total);
    console.log('- Successful operations:', aiService.stats.operations.successful);
    console.log('- Failed operations:', aiService.stats.operations.failed);
    
    console.log('\n✨ Test completed successfully!');
  } catch (error) {
    console.error('❌ Error during test:', error);
  } finally {
    // Cleanup
    await prisma.$disconnect();
    process.exit(0);
  }
}

// Run the test
testAIServiceOperation();