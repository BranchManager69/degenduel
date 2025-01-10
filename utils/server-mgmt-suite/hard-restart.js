#!/usr/bin/env node
import { execSync } from 'child_process';
import colors from 'colors';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { logApi } from './utils/logger-suite/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const execute = (command, errorMessage = '') => {
    try {
        execSync(command, { stdio: 'inherit' });
        return true;
    } catch (error) {
        if (errorMessage) {
            logApi.error(errorMessage);
            logApi.error(`Command failed: ${command}`);
        }
        return false;
    }
};

const steps = [
    {
        name: 'TERMINATING ALL PROCESSES',
        command: 'pm2 list && pm2 stop all || true'
    },
    {
        name: 'CLEANING UP PM2',
        command: 'pm2 delete all || true'
    },
    {
        name: 'CLEANING BUILD FILES',
        command: 'rm -rf dist'
    },
    {
        name: 'CLEANING LOGS',
        command: 'rm -f server/logs/*.log'
    },
    {
        name: 'REBUILDING PROJECT',
        command: 'npm run build'
    },
    {
        name: 'GENERATING FAVICONS',
        command: 'npm run favicons'
    },
    {
        name: 'STARTING FRONTEND',
        command: 'npm run start:frontend'
    },
    {
        name: 'STARTING API',
        command: 'npm run start:api'
    }
];

console.log(colors.bold(`\n
╔══════════════════════════════════════════════════════════╗
║  ██████╗ ██████╗  █████╗ ███╗   ██╗ ██████╗██╗  ██╗      ║
║  ██╔══██╗██╔══██╗██╔══██╗████╗  ██║██╔════╝██║  ██║      ║
║  ██████╔╝██████╔╝███████║██╔██╗ ██║██║     ███████║      ║
║  ██╔══██╗██╔══██╗██╔══██║██║╚██╗██║██║     ██╔══██║      ║
║  ██████╔╝██║  ██║██║  ██║██║ ╚████║╚██████╗██║  ██║      ║
║  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝      ║
║                                                          ║
║  [ INITIATING HARD RESTART SEQUENCE ]                    ║
╚══════════════════════════════════════════════════════════╝
`));

steps.forEach((step, index) => {
    console.log(`\n[STEP ${index + 1}/${steps.length}] ${colors.yellow('🔄')} ${step.name}`);
    console.log('══════════════════════════════════════════════════\n');
    
    if (!execute(step.command, `Failed to execute: ${step.command}`)) {
        console.log(colors.yellow(`\n╔══════════════════════════════════════════════════════════╗
║  ⚠ WARNING: Step failed but continuing...                    ║
╚══════════════════════════════════════════════════════════╝\n`));
    }
});

console.log(colors.green(`\n╔══════════════════════════════════════════════════════════╗
║  ✅ HARD RESTART COMPLETE                                ║
╚══════════════════════════════════════════════════════════╝\n`));