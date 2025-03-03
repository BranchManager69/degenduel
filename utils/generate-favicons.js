#!/usr/bin/env node
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync, accessSync, constants, writeFileSync } from 'fs';
import { colors } from './utils/colors.js';
import { logStep, logSuccess, logError } from './utils/logger.js';

/**
 * Generate favicons for the project
 * 
 * WARNING: This script has not been used for a while, and may not work as expected.
 * It's kept here for reference, but it's not actively maintained.
 * 
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Configuration
const CONFIG = {
  source: join(PROJECT_ROOT, 'public', 'favicon.svg'),
  outputDir: join(PROJECT_ROOT, 'public', 'assets'),
  sizes: {
    'favicon-16x16.png': 16,
    'favicon-32x32.png': 32,
    'apple-touch-icon.png': 180,
    'android-chrome-192x192.png': 192,
    'android-chrome-512x512.png': 512
  }
};

// Cyberpunk ASCII art banner
const banner = `
${colors.neon}╔══════════════════════════════════════════════════════════╗
║  ${colors.cyan}███████╗ █████╗ ██╗   ██╗██╗ ██████╗ ██████╗ ███╗   ██╗${colors.neon}║
║  ${colors.cyan}██╔════╝██╔══██╗██║   ██║██║██╔════╝██╔═══██╗████╗  ██║${colors.neon}║
║  ${colors.cyan}█████╗  ███████║██║   ██║██║██║     ██║   ██║██╔██╗ ██║${colors.neon}║
║  ${colors.cyan}██╔══╝  ██╔══██║╚██╗ ██╔╝██║██║     ██║   ██║██║╚██╗██║${colors.neon}║
║  ${colors.cyan}██║     ██║  ██║ ╚████╔╝ ██║╚██████╗╚██████╔╝██║ ╚████║${colors.neon}║
║  ${colors.cyan}╚═╝     ╚═╝  ╚═╝  ╚═══╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝${colors.neon}║
║                                                              ║
║  ${colors.yellow}[ INITIATING FAVICON GENERATION SEQUENCE ]                ${colors.neon}║
╚══════════════════════════════════════════════════════════╝${colors.reset}
`;

// Add this function to create a default SVG
function createDefaultFavicon() {
  const defaultSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#000"/>
    <text x="256" y="256" font-family="Arial" font-size="200" fill="#fff" text-anchor="middle" dominant-baseline="middle">
      BB
    </text>
  </svg>`;
  
  try {
    writeFileSync(CONFIG.source, defaultSvg);
    logSuccess('Created default favicon.svg');
    return true;
  } catch (error) {
    logError('Default favicon creation', error);
    return false;
  }
}

function validateEnvironment() {
  try {
    // Check if source SVG exists, create default if it doesn't
    if (!existsSync(CONFIG.source)) {
      if (!createDefaultFavicon()) {
        return false;
      }
    }
    
    // Create output directory if it doesn't exist
    if (!existsSync(CONFIG.outputDir)) {
      mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    
    // Verify sharp-cli is installed
    execSync('npx sharp-cli --version', { stdio: 'ignore' });
    
    return true;
  } catch (error) {
    if (error.message.includes('sharp-cli')) {
      logError('Dependencies check', error || new Error('sharp-cli not found'));
      execSync('npm install -D sharp-cli', { stdio: 'inherit' });
    } else {
      logError('Environment validation', error || new Error('Environment validation failed'));
      return false;
    }
  }
}

function generateFavicon(filename, size) {
  const outputPath = join(CONFIG.outputDir, filename);
  try {
    execSync(`npx sharp-cli --input "${CONFIG.source}" --output "${outputPath}" resize ${size}`, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    logSuccess(`Generated ${filename} (${size}x${size}px)`);
    return true;
  } catch (error) {
    logError(`Favicon generation: ${filename}`, error);
    return false;
  }
}

async function main() {
  console.log(banner);

  // Step 1: Validate environment
  logStep(1, 3, '🔍 VALIDATING ENVIRONMENT');
  if (!validateEnvironment()) {
    process.exit(1);
  }

  // Step 2: Clean output directory
  logStep(2, 3, '🧹 CLEANING OUTPUT DIRECTORY');
  Object.keys(CONFIG.sizes).forEach(filename => {
    const path = join(CONFIG.outputDir, filename);
    if (existsSync(path)) {
      try {
        execSync(`rm "${path}"`, { stdio: 'ignore' });
        logSuccess(`Cleaned ${filename}`);
      } catch (error) {
        logError(`Failed to clean ${filename}`, error);
      }
    }
  });

  // Step 3: Generate favicons
  logStep(3, 3, '🎨 GENERATING FAVICONS');
  const results = Object.entries(CONFIG.sizes).map(([filename, size]) => 
    generateFavicon(filename, size)
  );

  // Final status
  const success = results.every(Boolean);
  console.log(`\n${colors.neon}╔══════════════════════════════════════════════════════════╗`);
  if (success) {
    console.log(`║  ${colors.green}✓ FAVICON GENERATION COMPLETED SUCCESSFULLY${colors.neon}             ║`);
  } else {
    console.log(`║  ${colors.red}⚠ FAVICON GENERATION COMPLETED WITH ERRORS${colors.neon}                ║`);
  }
  console.log(`╚══════════════════════════════════════════════════════════╝${colors.reset}`);

  process.exit(success ? 0 : 1);
}

main().catch(error => {
  logError('Main process', error);
  process.exit(1);
});