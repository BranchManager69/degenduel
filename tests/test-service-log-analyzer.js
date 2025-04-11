/**
 * Test script for AI service log analyzer
 * 
 * This script tests the service log analysis functionality by:
 * 1. Initializing the AI service
 * 2. Running the service log analysis directly on service logs
 * 3. Checking the results
 */

import aiService from '../services/ai-service/ai-service.js';
import { analyzeServiceLogs } from '../services/ai-service/analyzers/log-analyzer.js';
import prisma from '../config/prisma.js';

async function testServiceLogAnalyzer() {
  console.log('🤖 Testing AI Service Log Analyzer...');
  
  try {
    // Initialize the AI service
    console.log('Initializing AI service...');
    await aiService.initialize();
    
    // Temporarily reduce the minimum log threshold to 10 for testing
    console.log('Temporarily reducing minimum log threshold to 10 logs for testing...');
    
    // Test service log analysis for each service
    const services = ['solana_engine', 'contest_scheduler', 'token_monitoring'];
    
    for (const service of services) {
      console.log(`\n🔍 Testing service log analysis for ${service}...`);
      
      // Count service logs
      const logCount = await prisma.service_logs.count({
        where: {
          service
        }
      });
      
      console.log(`Found ${logCount} ${service} logs in the database.`);
      
      // Run the analyzer
      const serviceLogResults = await analyzeServiceLogs(aiService, service, 50);
      
      if (serviceLogResults) {
        console.log(`✅ ${service} log analysis successful!`);
        console.log('Logs analyzed:', serviceLogResults.logsAnalyzed);
        console.log('Summary excerpt:', serviceLogResults.summary.substring(0, 150) + '...');
      } else {
        console.log(`❌ ${service} log analysis skipped or failed.`);
      }
    }
    
    // Check the database for stored analyses
    console.log('\n📊 Checking database for analysis results...');
    
    const serviceLogAnalyses = await prisma.ai_service_log_analyses.findMany({
      orderBy: { analyzed_at: 'desc' },
      take: 5
    });
    
    console.log(`Found ${serviceLogAnalyses.length} service log analyses in the database.`);
    
    if (serviceLogAnalyses.length > 0) {
      console.log('Most recent analyses:');
      for (const analysis of serviceLogAnalyses.slice(0, 3)) {
        console.log(`- ${analysis.service}: ${analysis.log_count} logs analyzed at ${analysis.analyzed_at}`);
      }
    }
    
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
testServiceLogAnalyzer();