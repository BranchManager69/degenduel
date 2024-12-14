#!/usr/bin/env node
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ANSI color codes for cyberpunk aesthetic
const colors = {
  neon: '\x1b[38;5;207m',
  cyan: '\x1b[38;5;51m',
  green: '\x1b[38;5;46m',
  yellow: '\x1b[38;5;226m',
  red: '\x1b[38;5;196m',
  reset: '\x1b[0m'
};

const banner = `
${colors.neon}╔══════════════════════════════════════════════════════════╗
║  ${colors.cyan}██████╗ ███████╗███████╗████████╗ █████╗ ██████╗ ████████╗${colors.neon}║
║  ${colors.cyan}██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚══██╔══╝${colors.neon}║
║  ${colors.cyan}██████╔╝█████╗  ███████╗   ██║   ███████║██████╔╝   ██║   ${colors.neon}║
║  ${colors.cyan}██╔══██╗██╔══╝  ╚════██║   ██║   ██╔══██║██╔══██╗   ██║   ${colors.neon}║
║  ${colors.cyan}██║  ██║███████╗███████║   ██║   ██║  ██║██║  ██║   ██║   ${colors.neon}║
║  ${colors.cyan}╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ${colors.neon}║
║                                                              ║
║  ${colors.yellow}[ INITIATING QUICK SYSTEM RESTART ]                       ${colors.neon}║
╚══════════════════════════════════════════════════════════╝${colors.reset}
`;

function execute(command, options = {}) {
  try {
    execSync(command, { 
      stdio: 'inherit', 
      cwd: PROJECT_ROOT,
      ...options 
    });
  } catch (error) {
    console.error(`${colors.red}[ERROR]${colors.reset} Failed to execute: ${command}`);
    throw error;
  }
}

function logStep(step, message) {
  console.log(`\n${colors.cyan}[STEP ${step}/3]${colors.reset} ${message}`);
  console.log(`${colors.neon}${'═'.repeat(50)}${colors.reset}\n`);
}

console.log(banner);

try {
  logStep(1, '🏗️  REBUILDING FRONTEND MATRIX');
  execute('npm run build', { stdio: 'inherit' });

  logStep(2, '🔄 CYCLING SYSTEM POWER');
  execute('pm2 restart ecosystem.config.cjs', { stdio: 'inherit' });

  logStep(3, '📊 RUNNING DIAGNOSTICS');
  execute('pm2 status', { stdio: 'inherit' });

  console.log(`\n${colors.neon}╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  ${colors.green}✓ SYSTEM RESTART COMPLETED SUCCESSFULLY${colors.neon}                  ║`);
  console.log(`║                                                              ║`);
  console.log(`║  ${colors.cyan}MONITORING COMMANDS:${colors.neon}                                      ║`);
  console.log(`║  ${colors.yellow}npm run logs${colors.neon}      - Real-time neural feedback          ║`);
  console.log(`║  ${colors.yellow}npm run status${colors.neon}    - System vitals check                ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝${colors.reset}`);

} catch (error) {
  console.error(`\n${colors.red}╔══════════════════════════════════════════════════════════╗`);
  console.error(`║  ⚠ CRITICAL SYSTEM FAILURE                                  ║`);
  console.error(`║  ${error.message.slice(0, 52).padEnd(52)}║`);
  console.error(`╚══════════════════════════════════════════════════════════╝${colors.reset}\n`);
  process.exit(1);
}