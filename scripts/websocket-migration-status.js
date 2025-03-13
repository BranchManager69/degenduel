#!/usr/bin/env node

/**
 * WebSocket Migration Status Tool
 * 
 * This tool analyzes the current WebSocket implementation status
 * and shows which endpoints are using legacy vs v69 implementations.
 * It helps track the migration progress from legacy to v69 WebSockets.
 */

import { logApi } from '../utils/logger-suite/logger.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

// Paths to search
const LEGACY_PATH = path.resolve(process.cwd(), 'websocket');
const V69_PATH = path.resolve(process.cwd(), 'websocket/v69');

// Get all WebSocket implementations
const getLegacyFiles = () => {
  return fs.readdirSync(LEGACY_PATH)
    .filter(file => file.endsWith('-ws.js') && !file.startsWith('base'))
    .map(file => ({
      name: file.replace('-ws.js', ''),
      file,
      path: path.join(LEGACY_PATH, file),
      implementation: 'legacy'
    }));
};

const getV69Files = () => {
  return fs.readdirSync(V69_PATH)
    .filter(file => file.endsWith('-ws.js') && !file.startsWith('base'))
    .map(file => ({
      name: file.replace('-ws.js', ''),
      file,
      path: path.join(V69_PATH, file),
      implementation: 'v69'
    }));
};

// Check if both legacy and v69 implementations exist
const checkMigrationStatus = () => {
  const legacyFiles = getLegacyFiles();
  const v69Files = getV69Files();
  
  // Combine all unique WebSocket names
  const allNames = [...new Set([
    ...legacyFiles.map(f => f.name),
    ...v69Files.map(f => f.name)
  ])];
  
  // Check status for each WebSocket
  return allNames.map(name => {
    const legacy = legacyFiles.find(f => f.name === name);
    const v69 = v69Files.find(f => f.name === name);
    
    return {
      name,
      legacy: legacy ? true : false,
      v69: v69 ? true : false,
      status: legacy && v69 ? 'both' : (legacy ? 'legacy-only' : 'v69-only')
    };
  });
};

// Print results in table format
const printResults = (status) => {
  console.log('\n');
  console.log(chalk.bgBlue.white(' WEBSOCKET MIGRATION STATUS '));
  console.log('\n');
  
  // Print header
  console.log(
    chalk.cyan.bold('WebSocket'.padEnd(20)),
    chalk.yellow.bold('Legacy'.padEnd(15)),
    chalk.green.bold('v69'.padEnd(15)),
    chalk.magenta.bold('Status'.padEnd(25)),
    chalk.blue.bold('Notes')
  );
  
  console.log('-'.repeat(100));
  
  // Add notes for special WebSockets
  const notes = {
    'market': 'Now handled by market-data-ws.js',
    'token-data': 'Now handled by market-data-ws.js',
    'market-data': 'Consolidated implementation for market + token-data',
    'portfolio': 'Keep separate (authentication required)'
  };
  
  // Print each WebSocket status
  status.forEach(item => {
    console.log(
      chalk.white(item.name.padEnd(20)),
      item.legacy ? chalk.yellow('✓'.padEnd(15)) : chalk.gray('✗'.padEnd(15)),
      item.v69 ? chalk.green('✓'.padEnd(15)) : chalk.gray('✗'.padEnd(15)),
      getStatusColor(item.status)(getStatusText(item.status).padEnd(25)),
      notes[item.name] ? chalk.blue(notes[item.name]) : ''
    );
  });
  
  // Print summary
  const totalWebSockets = status.length;
  const legacyOnly = status.filter(s => s.status === 'legacy-only').length;
  const v69Only = status.filter(s => s.status === 'v69-only').length;
  const both = status.filter(s => s.status === 'both').length;
  
  console.log('\n');
  console.log(chalk.bgCyan.black(' MIGRATION SUMMARY '));
  console.log('\n');
  console.log(`Total WebSockets: ${chalk.white.bold(totalWebSockets)}`);
  console.log(`Legacy Only: ${chalk.yellow.bold(legacyOnly)}`);
  console.log(`v69 Only: ${chalk.green.bold(v69Only)}`);
  console.log(`Both Implementations: ${chalk.magenta.bold(both)}`);
  
  // Calculate migration progress
  const migrationProgress = Math.round((v69Only + both) / totalWebSockets * 100);
  console.log(`Migration Progress: ${chalk.cyan.bold(migrationProgress + '%')}`);
  
  console.log('\n');
  console.log(chalk.bgGreen.black(' NEXT STEPS '));
  console.log('\n');
  
  if (legacyOnly > 0) {
    console.log('1. Create v69 versions for these legacy-only WebSockets:');
    status.filter(s => s.status === 'legacy-only')
      .forEach(s => console.log(`   - ${chalk.yellow(s.name)}`));
  }
  
  if (both > 0) {
    console.log('\n2. Test and validate these WebSockets (with both implementations):');
    status.filter(s => s.status === 'both')
      .forEach(s => console.log(`   - ${chalk.magenta(s.name)}`));
  }
  
  if (both > 0) {
    console.log('\n3. Update the initializer to prefer v69 over legacy for these WebSockets:');
    status.filter(s => s.status === 'both')
      .forEach(s => console.log(`   - ${chalk.magenta(s.name)}`));
  }
  
  console.log('\n');
  console.log(chalk.bgCyan.black(' CONSOLIDATION STATUS '));
  console.log('\n');
  
  console.log('Market Data Consolidation: ' + chalk.green.bold('COMPLETED ✓'));
  console.log('\n1. ' + chalk.cyan.bold('Market Data Consolidation:'));
  console.log('   ' + chalk.green('✓') + ' Created consolidated market-data-ws.js in v69 directory');
  console.log('   ' + chalk.green('✓') + ' Handles functionality from both market-ws.js and token-data-ws.js');
  console.log('   ' + chalk.green('✓') + ' Supports backward compatibility through multiple endpoints');
  console.log('   ' + chalk.green('✓') + ' Maintains functionality of both original WebSockets');
  
  console.log('\n2. ' + chalk.cyan.bold('Keep portfolio-ws separate:'));
  console.log('   - It\'s user-specific and requires authentication');
  console.log('   - It serves a fundamentally different purpose (user portfolio vs market data)');
  console.log('   - It requires integration with user accounts and trade systems');
  
  console.log('\n3. ' + chalk.cyan.bold('Next Consolidation Opportunities:'));
  console.log('   - Consider consolidating admin-spy-ws and broadcast-command-ws into admin-ws');
  console.log('   - Consider integrating wallet-ws functionality into portfolio-ws');
  
  console.log('\n');
};

// Helper functions for formatting
const getStatusColor = (status) => {
  switch (status) {
    case 'both': return chalk.magenta;
    case 'legacy-only': return chalk.yellow;
    case 'v69-only': return chalk.green;
    default: return chalk.white;
  }
};

const getStatusText = (status) => {
  switch (status) {
    case 'both': return 'Both (Ready for switchover)';
    case 'legacy-only': return 'Legacy Only (Needs v69 version)';
    case 'v69-only': return 'v69 Only (Fully migrated)';
    default: return status;
  }
};

// Run the analysis
try {
  const status = checkMigrationStatus();
  printResults(status);
} catch (error) {
  console.error(chalk.red('Error analyzing WebSocket migration status:'), error);
}