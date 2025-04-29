#!/usr/bin/env node

/**
 * Service Status Utility
 * 
 * Shows the status of all services in system_settings table.
 * 
 * Usage:
 *   node tools/system-status/service-status.js [options]
 * 
 * Options:
 *   --active     Show only active services
 *   --minutes    Show time in minutes ago (default: pretty time format)
 *   --sort=field Sort by field (status, name, time) (default: time)
 *   --json       Output in JSON format
 */

import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import { formatDistance } from 'date-fns';

const prisma = new PrismaClient();

// Parse command line arguments
const args = process.argv.slice(2);
const showOnlyActive = args.includes('--active');
const showInMinutes = args.includes('--minutes');
const outputJson = args.includes('--json');

// Get sort field
let sortField = 'time'; // Default
const sortArg = args.find(arg => arg.startsWith('--sort='));
if (sortArg) {
  sortField = sortArg.split('=')[1];
}

async function fetchServiceStatus() {
  try {
    // Get all service entries from system_settings
    const serviceEntries = await prisma.$queryRaw`
      SELECT 
        key, 
        value->>'status' as status, 
        updated_at 
      FROM system_settings 
      WHERE value ? 'status'
      ${showOnlyActive ? prisma.$raw`AND value->>'status' = 'active'` : prisma.$raw``}
      ORDER BY updated_at DESC
    `;

    // Get other entries that don't follow the service pattern
    const otherEntries = await prisma.$queryRaw`
      SELECT 
        key, 
        '(config)' as status, 
        updated_at 
      FROM system_settings 
      WHERE NOT value ? 'status' 
      ORDER BY updated_at DESC
    `;

    // Combine entries
    const allEntries = [...serviceEntries, ...otherEntries];

    // Sort entries
    if (sortField === 'name') {
      allEntries.sort((a, b) => a.key.localeCompare(b.key));
    } else if (sortField === 'status') {
      allEntries.sort((a, b) => {
        if (a.status === b.status) {
          return new Date(b.updated_at) - new Date(a.updated_at);
        }
        return a.status.localeCompare(b.status);
      });
    }
    // No need to sort by time, already sorted

    return allEntries;
  } catch (error) {
    console.error('Error fetching service status:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

function formatTime(dateStr, showInMinutes) {
  const date = new Date(dateStr);
  const now = new Date();
  
  if (showInMinutes) {
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    
    if (diffMinutes < 60) {
      return `${diffMinutes} minutes ago`;
    } else if (diffMinutes < 24 * 60) {
      const hours = Math.floor(diffMinutes / 60);
      return `${hours} hours ago`;
    } else {
      const days = Math.floor(diffMinutes / (60 * 24));
      return `${days} days ago`;
    }
  } else {
    return formatDistance(date, now, { addSuffix: true });
  }
}

async function displayStatus() {
  const entries = await fetchServiceStatus();
  
  if (outputJson) {
    // Output as JSON
    const jsonOutput = entries.map(entry => ({
      service: entry.key,
      status: entry.status,
      updated_at: entry.updated_at,
      updated_ago: formatTime(entry.updated_at, showInMinutes)
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }
  
  // Output in console format
  console.log(chalk.bold('\nDEGENDUEL SERVICE STATUS REPORT'));
  console.log(chalk.bold(`${new Date().toISOString()}\n`));
  
  // Calculate padding for service names
  const maxNameLength = Math.max(...entries.map(e => e.key.length));
  
  // Group entries by update time (grouped by minute)
  const byTime = {};
  
  entries.forEach((entry, index) => {
    const { key, status, updated_at } = entry;
    
    const date = new Date(updated_at);
    const timeKey = `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}`;
    
    if (!byTime[timeKey]) {
      byTime[timeKey] = [];
    }
    byTime[timeKey].push(entry);
    
    // Format status with color
    let statusColored;
    if (status === 'active') {
      statusColored = chalk.green('● ACTIVE');
    } else if (status === 'stopped') {
      statusColored = chalk.red('■ STOPPED');
    } else if (status === '(config)') {
      statusColored = chalk.blue('✦ CONFIG');
    } else {
      statusColored = chalk.yellow(`▲ ${status?.toUpperCase() || 'UNKNOWN'}`);
    }
    
    // Format time
    const formattedTime = formatTime(updated_at, showInMinutes);
    
    // Display entry
    console.log(
      `${chalk.bold(index + 1).padStart(3)}. ` + 
      `${chalk.cyan(key.padEnd(maxNameLength))} ` +
      `${statusColored.padEnd(15)} ` + 
      `${chalk.dim(`Updated: ${formattedTime}`)}`
    );
  });
  
  console.log(chalk.bold(`\nTOTAL: ${entries.length} entries`));
  
  if (showOnlyActive) {
    console.log(chalk.dim('(Showing only active services. Use without --active to show all)'));
  }
}

displayStatus();