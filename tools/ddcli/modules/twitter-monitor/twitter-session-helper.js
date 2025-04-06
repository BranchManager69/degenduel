#!/usr/bin/env node

/**
 * Twitter Login Helper Script
 * 
 * This script provides a block of commands to generate a new Twitter session file.
 */

import chalk from 'chalk';
import { fileURLToPath } from 'url';
import path from 'path';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants - Server is always Linux
const SERVER_IP = '147.79.74.67';
const SERVER_USERNAME = 'branchmanager';
const SERVER_SCRIPT_PATH = '/home/websites/degenduel/scripts/twitter/utils/twitter-login-and-save-session.cjs';
const SERVER_UPLOAD_PATH = '/home/websites/degenduel/keys/twitter-session.json';

console.log(chalk.bold.blue('='.repeat(80)));
console.log(chalk.bold.white('Twitter Login Helper - COPY THE ENTIRE BLOCK BELOW'));
console.log(chalk.bold.blue('='.repeat(80)));

// Single block of Windows commands to copy-paste - now the script uploads automatically!
console.log(chalk.green(`
mkdir %USERPROFILE%\\ddcli-temp
scp ${SERVER_USERNAME}@${SERVER_IP}:${SERVER_SCRIPT_PATH} %USERPROFILE%\\ddcli-temp\\twitter-login-and-save-session.cjs
cd %USERPROFILE%\\ddcli-temp
npm install playwright
SET SERVER_USERNAME=${SERVER_USERNAME}
SET SERVER_IP=${SERVER_IP}
SET SERVER_PATH=${SERVER_UPLOAD_PATH}
node twitter-login-and-save-session.cjs
`));

console.log(chalk.bold.yellow('IMPORTANT: A browser window will open. You have 45 seconds to log in to Twitter.'));
console.log(chalk.bold.yellow('The script will automatically upload the session file to the server when done.'));
console.log(chalk.bold.blue('='.repeat(80)));