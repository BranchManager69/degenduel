import { execSync } from 'child_process';

export function execute(command, options = {}) {
  try {
    return execSync(command, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      ...options
    });
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

export function getCurrentBranch() {
  return execute('git branch --show-current').trim();
}

export function checkWorkingDirectory() {
  const status = execute('git status --porcelain');
  if (status.trim()) {
    throw new Error('Working directory not clean. Commit or stash changes first.');
  }
}

export function switchToBranch(branch) {
  execute(`git checkout ${branch}`);
  execute(`git pull origin ${branch}`);
}