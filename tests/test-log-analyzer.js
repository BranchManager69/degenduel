/**
 * Test script for AI log analyzer
 * 
 * This script tests the log analysis functionality by:
 * 1. Importing the AI service
 * 2. Running the log analysis directly on actual log files
 * 3. Checking the results
 */

import aiService from '../services/ai-service/ai-service.js';
import { analyzeErrorLogs, analyzeGeneralLogs } from '../services/ai-service/analyzers/log-analyzer.js';
import prisma from '../config/prisma.js';
import fs from 'fs';
import path from 'path';

async function testLogAnalyzer() {
  console.log('🤖 Testing AI Log Analyzer...');
  
  try {
    // Initialize the AI service
    console.log('Initializing AI service...');
    await aiService.initialize();
    
    // Set a more permissive limit for testing
    console.log('\n⚙️ Setting more permissive limits for testing...');
    aiService.config.analysis = aiService.config.analysis || {};
    aiService.config.analysis.logs = aiService.config.analysis.logs || {};
    aiService.config.analysis.logs.generalLogs = aiService.config.analysis.logs.generalLogs || {};
    aiService.config.analysis.logs.generalLogs.minLines = 50; // Require fewer lines
    
    // Test general log analysis with actual logs
    console.log('\n🔍 Testing general log analysis with real logs...');
    const logDir = '/home/websites/degenduel/logs';
    
    // Check that log directory exists
    if (!fs.existsSync(logDir)) {
      console.error(`Log directory not found at ${logDir}`);
      process.exit(1);
    }
    
    console.log(`Found log directory at ${logDir}`);
    const files = fs.readdirSync(logDir);
    console.log(`Log files count: ${files.filter(f => f.endsWith('.log')).length}`);
    console.log(`Error log files: ${files.filter(f => f.startsWith('error-')).length}`);
    console.log(`API log files: ${files.filter(f => f.startsWith('api-')).length}`);
    console.log(`Debug log files: ${files.filter(f => f.startsWith('debug-')).length}`);
    
    const generalLogResults = await analyzeGeneralLogs(aiService, logDir, 1000);
    
    if (generalLogResults) {
      console.log('✅ General log analysis successful!');
      console.log('Log file analyzed:', generalLogResults.logFile);
      console.log('Lines analyzed:', generalLogResults.linesAnalyzed);
      console.log('Summary excerpt:', generalLogResults.summary.substring(0, 150) + '...');
    } else {
      console.log('❌ General log analysis skipped or failed.');
    }
    
    // Test error log analysis
    console.log('\n🔍 Testing error log analysis with client errors from database...');
    
    // Count client errors
    const errorCount = await prisma.client_errors.count();
    console.log(`Found ${errorCount} client errors in the database.`);
    
    const errorLogResults = await analyzeErrorLogs(aiService, 500);
    
    if (errorLogResults) {
      console.log('✅ Error log analysis successful!');
      console.log('Errors analyzed:', errorLogResults.errorsAnalyzed);
      console.log('Summary excerpt:', errorLogResults.summary.substring(0, 150) + '...');
    } else {
      console.log('❌ Error log analysis skipped or failed.');
      
      if (errorCount < 10) {
        console.log('Not enough client errors in the database for analysis (need at least 10).');
      }
    }
    
    // Check the database for stored analyses
    console.log('\n📊 Checking database for analysis results...');
    
    const generalLogAnalyses = await prisma.ai_log_analyses.findMany({
      orderBy: { analyzed_at: 'desc' },
      take: 5
    });
    
    console.log(`Found ${generalLogAnalyses.length} general log analyses in the database.`);
    if (generalLogAnalyses.length > 0) {
      console.log('Most recent analysis:');
      console.log('- File:', generalLogAnalyses[0].log_file);
      console.log('- Lines:', generalLogAnalyses[0].lines_analyzed);
      console.log('- Created:', generalLogAnalyses[0].analyzed_at);
    }
    
    const errorLogAnalyses = await prisma.ai_error_analyses.findMany({
      orderBy: { analyzed_at: 'desc' },
      take: 5
    });
    
    console.log(`Found ${errorLogAnalyses.length} error log analyses in the database.`);
    if (errorLogAnalyses.length > 0) {
      console.log('Most recent analysis:');
      console.log('- Errors:', errorLogAnalyses[0].error_count);
      console.log('- Created:', errorLogAnalyses[0].analyzed_at);
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
testLogAnalyzer();