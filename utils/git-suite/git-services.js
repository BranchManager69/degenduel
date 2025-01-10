import { execute } from './git.js';
import { logApi, logFrontend } from './utils/logger.js';

export async function stopServices(targetBranch) {
  execute('pm2 stop all');
  logApi.info(`Stopping services for branch switch to ${targetBranch}`);
  logFrontend.info(`Stopping services for branch switch to ${targetBranch}`);
}

export async function startServices() {
  execute('pm2 start ecosystem.config.cjs');
}

export function getServicesStatus() {
  return execute('pm2 status');
}

export async function buildApplication() {
  execute('npm install');
  execute('npm run build');
}

export async function attemptRecovery() {
  try {
    await startServices();
    return true;
  } catch (error) {
    console.error('Recovery failed:', error.message);
    return false;
  }
}