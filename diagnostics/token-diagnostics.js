#!/usr/bin/env node
/**
 * Token Database Diagnostics
 * 
 * Analyzes the token database for completeness and quality issues.
 */

import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

// Set up command line interface
const args = process.argv.slice(2);
const command = args[0] || 'all';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

/**
 * Main function to run diagnostics
 */
async function runDiagnostics() {
  console.log('\n🔍 TOKEN DATABASE DIAGNOSTICS 🔍\n');
  
  try {
    switch (command) {
      case 'basic':
        console.log('Running basic token checks...\n');
        await import('./check-tokens.js');
        break;
        
      case 'social':
      case 'simple': // Keep backward compatibility
        console.log('Analyzing embedded social links in token data...\n');
        await import('./simple-token-diagnostics.js');
        break;
        
      case 'full':
        console.log('Running comprehensive token quality report...\n');
        await import('./token-diagnostics.js');
        break;
        
      case 'all':
      case '': // Default when no args provided
        console.log('=== TOKEN DATABASE ANALYSIS ===\n');
        
        console.log('1. BASIC TOKEN CHECKS\n');
        await import('./check-tokens.js').then(() => {
          console.log('\n✅ Basic checks complete\n');
          
          console.log('2. SOCIAL LINK EXTRACTION\n');
          return import('./simple-token-diagnostics.js');
        }).then(() => {
          console.log('\n✅ Social link analysis complete\n');
          
          console.log('3. COMPREHENSIVE QUALITY REPORT\n');
          return import('./token-diagnostics.js');
        }).then(() => {
          console.log('\n=== ANALYSIS COMPLETE ===');
        });
        break;
        
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('Error running diagnostics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
Token Database Diagnostics

USAGE:
  node token-diagnostics.js [command]

COMMANDS:
  basic     Basic token data checks
  social    Analyze embedded social links in token descriptions
  full      Comprehensive token data quality report
  all       Run all diagnostics in one go (default)
  help      Show this help message

EXAMPLES:
  node token-diagnostics.js          Run all diagnostics (default)
  node token-diagnostics.js basic    Check basic token stats
  node token-diagnostics.js social   Find social links in descriptions
  `);
}

// Run the diagnostics
runDiagnostics();