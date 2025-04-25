/**
 * Test script to verify AI service log analysis intervals
 */

import aiService from '../services/ai-service/ai-service.js';

async function testAIServiceIntervals() {
  console.log('Testing AI service log analysis intervals...');
  
  try {
    // Initialize the AI service
    await aiService.initialize();
    
    // Show the current interval settings
    console.log('Analysis intervals:');
    console.log('- General logs:', aiService.config.analysis.logs.generalLogs.runIntervalMinutes, 'minutes');
    console.log('- Error logs:', aiService.config.analysis.logs.errorLogs.runIntervalMinutes, 'minutes');
    console.log('- Service logs:', aiService.config.analysis.logs.serviceLogs.runIntervalMinutes, 'minutes');
    
    // Set initial timestamps to simulate that the last analysis was run 10 minutes ago
    console.log('\nSimulating that the last analysis was run 10 minutes ago...');
    aiService.lastLogAnalysisRun = { 
      general: Date.now() - 10 * 60 * 1000,
      error: Date.now() - 10 * 60 * 1000,
      services: {}
    };
    
    // Add service timestamps
    for (const service of aiService.config.analysis.logs.serviceLogs.services) {
      aiService.lastLogAnalysisRun.services[service] = Date.now() - 10 * 60 * 1000;
    }
    
    // Check if analysis should run now
    console.log('\nChecking if analysis should run now (expecting YES for all):');
    const shouldRunGeneral = !aiService.lastLogAnalysisRun.general || 
        (Date.now() - aiService.lastLogAnalysisRun.general) > 
        (aiService.config.analysis.logs.generalLogs.runIntervalMinutes * 60 * 1000);
    
    const shouldRunError = !aiService.lastLogAnalysisRun.error || 
        (Date.now() - aiService.lastLogAnalysisRun.error) > 
        (aiService.config.analysis.logs.errorLogs.runIntervalMinutes * 60 * 1000);
    
    console.log('- General logs should run:', shouldRunGeneral ? 'YES' : 'NO');
    console.log('- Error logs should run:', shouldRunError ? 'YES' : 'NO');
    
    // Check services
    for (const service of aiService.config.analysis.logs.serviceLogs.services) {
      const shouldRunService = !aiService.lastLogAnalysisRun.services[service] || 
          (Date.now() - aiService.lastLogAnalysisRun.services[service]) > 
          (aiService.config.analysis.logs.serviceLogs.runIntervalMinutes * 60 * 1000);
      
      console.log(`- ${service} logs should run:`, shouldRunService ? 'YES' : 'NO');
    }
    
    // Now simulate that the last analysis was run 3 minutes ago
    console.log('\nSimulating that the last analysis was run 3 minutes ago...');
    aiService.lastLogAnalysisRun = { 
      general: Date.now() - 3 * 60 * 1000,
      error: Date.now() - 3 * 60 * 1000,
      services: {}
    };
    
    // Add service timestamps
    for (const service of aiService.config.analysis.logs.serviceLogs.services) {
      aiService.lastLogAnalysisRun.services[service] = Date.now() - 3 * 60 * 1000;
    }
    
    // Check if analysis should run now
    console.log('\nChecking if analysis should run now (expecting NO for all):');
    const shouldRunGeneral2 = !aiService.lastLogAnalysisRun.general || 
        (Date.now() - aiService.lastLogAnalysisRun.general) > 
        (aiService.config.analysis.logs.generalLogs.runIntervalMinutes * 60 * 1000);
    
    const shouldRunError2 = !aiService.lastLogAnalysisRun.error || 
        (Date.now() - aiService.lastLogAnalysisRun.error) > 
        (aiService.config.analysis.logs.errorLogs.runIntervalMinutes * 60 * 1000);
    
    console.log('- General logs should run:', shouldRunGeneral2 ? 'YES' : 'NO');
    console.log('- Error logs should run:', shouldRunError2 ? 'YES' : 'NO');
    
    // Check services
    for (const service of aiService.config.analysis.logs.serviceLogs.services) {
      const shouldRunService = !aiService.lastLogAnalysisRun.services[service] || 
          (Date.now() - aiService.lastLogAnalysisRun.services[service]) > 
          (aiService.config.analysis.logs.serviceLogs.runIntervalMinutes * 60 * 1000);
      
      console.log(`- ${service} logs should run:`, shouldRunService ? 'YES' : 'NO');
    }
    
    console.log('\nTest completed successfully!');
  } catch (error) {
    console.error('Error during test:', error);
  } finally {
    process.exit(0);
  }
}

testAIServiceIntervals();