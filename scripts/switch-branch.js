#!/usr/bin/env node
import { getCurrentBranch, checkWorkingDirectory, switchToBranch } from './utils/git.js';
import { stopServices, startServices, getServicesStatus, buildApplication, attemptRecovery } from './utils/services.js';
import { logSuccess, logError } from './utils/logger.js';

const VALID_BRANCHES = ['main', 'refactor/logging-improvements'];

async function switchBranch(targetBranch) {
  const startTime = Date.now();
  
  try {
    // 1. Validate target branch
    if (!VALID_BRANCHES.includes(targetBranch)) {
      throw new Error(`Invalid branch. Must be one of: ${VALID_BRANCHES.join(', ')}`);
    }

    // 2. Check current branch and status
    const currentBranch = getCurrentBranch();
    if (currentBranch === targetBranch) {
      console.log(`Already on branch ${targetBranch}`);
      return;
    }

    // Check for uncommitted changes
    checkWorkingDirectory();

    console.log(`\n🔄 Switching from ${currentBranch} to ${targetBranch}...`);

    // 3. Stop services gracefully
    console.log('\n📥 Stopping services...');
    await stopServices(targetBranch);

    // 4. Switch branch
    console.log(`\n🔀 Switching to ${targetBranch}...`);
    switchToBranch(targetBranch);

    // 5. Install dependencies and rebuild
    console.log('\n📦 Installing dependencies and building...');
    await buildApplication();

    // 6. Restart services
    console.log('\n🚀 Starting services...');
    await startServices();

    // 7. Verify services
    console.log('\n✅ Verifying services...');
    const servicesStatus = getServicesStatus();
    
    // Calculate duration
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`\n✨ Successfully switched to ${targetBranch} in ${duration}s`);
    console.log('\nServices status:');
    console.log(servicesStatus);

    // Log success
    logSuccess(targetBranch, currentBranch, duration);

  } catch (error) {
    console.error('\n❌ Error switching branches:', error.message);
    
    // Attempt recovery
    console.log('\n🔄 Attempting recovery...');
    await attemptRecovery();

    // Log error
    logError(targetBranch, error);

    process.exit(1);
  }
}

// Get target branch from command line
const targetBranch = process.argv[2];
if (!targetBranch) {
  console.error(`\nUsage: npm run switch-branch <branch-name>`);
  console.error(`\nAvailable branches:`);
  console.error(VALID_BRANCHES.map(b => `  - ${b}`).join('\n'));
  process.exit(1);
}

switchBranch(targetBranch);