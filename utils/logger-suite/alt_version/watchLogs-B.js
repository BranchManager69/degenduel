#!/usr/bin/env node
import fs from 'fs';
import paths from '../../../config/paths.js';
import { watchLogs } from './utils/logViewer.js';

const args = process.argv.slice(2);
const type = args[0] || 'all';
const lines = parseInt(args[1]) || 50;
const raw = args.includes('--raw');

// Validate log type
const validTypes = ['api', 'frontend', 'error', 'all'];
if (!validTypes.includes(type)) {
  console.error(`Invalid log type. Must be one of: ${validTypes.join(', ')}`);
  process.exit(1);
}

// Validate lines
if (isNaN(lines) || lines < 1) {
  console.error('Lines must be a positive number');
  process.exit(1);
}

// Ensure log directory exists
if (!fs.existsSync(paths.logs)) {
  console.error(`Log directory not found: ${paths.logs}`);
  console.error('Creating log directory...');
  fs.mkdirSync(paths.logs, { recursive: true, mode: 0o755 });
}

console.log(`Log directory: ${paths.logs}`);
console.log(`Watching ${type} logs (last ${lines} lines)...`);
console.log('Press Ctrl+C to exit\n');

watchLogs(type, lines, !raw);