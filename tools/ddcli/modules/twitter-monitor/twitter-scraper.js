import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import ora from 'ora';
import ui from '../../core/ui.js';

// Get the current module path for relative references
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get current timestamp in a formatted string
 * @returns {string} Formatted timestamp string
 */
function getFormattedDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Execute a command and display progress
 * @param {string} command Command to execute
 * @param {string[]} args Command arguments
 * @param {Object} options Command options including environment variables
 * @param {string} spinnerText Text to display in spinner
 * @param {string} successText Text to display on success
 * @returns {Promise<{stdout: string, stderr: string}>} Promise that resolves when command completes
 */
async function executeCommand(command, args, options, spinnerText, successText) {
  return new Promise((resolve, reject) => {
    const spinner = ora(spinnerText).start();
    
    const process = spawn(command, args, options);
    
    // Buffer for stdout/stderr
    let stdout = '';
    let stderr = '';
    
    // Collect stdout
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    // Collect stderr
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // Handle completion
    process.on('close', (code) => {
      if (code === 0) {
        spinner.succeed(successText);
        resolve({ stdout, stderr });
      } else {
        spinner.fail(`Command failed with code ${code}`);
        console.error(chalk.red(stderr));
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    
    // Handle errors
    process.on('error', (error) => {
      spinner.fail(`Command execution error`);
      console.error(chalk.red(error.message));
      reject(error);
    });
  });
}

/**
 * Scrape content from a Twitter/X post
 * @param {string} url URL of the tweet to scrape
 * @param {Object} options Options for scraping
 * @param {boolean} options.includeVisible Whether to include visible elements
 */
export async function scrapeTweet(url, options = {}) {
  const { includeVisible = true } = options;
  
  // Create timestamp and output directory
  const timestamp = getFormattedDateTime();
  const projectRoot = path.resolve(process.cwd()); // Current working directory
  const baseOutputDir = path.join(projectRoot, 'scrapes', timestamp);
  
  ui.message(`Timestamp: ${chalk.blue(timestamp)}`);
  ui.message(`Output directory: ${chalk.blue(baseOutputDir)}`);
  
  // Create output directory
  try {
    fs.mkdirSync(baseOutputDir, { recursive: true });
  } catch (error) {
    ui.message(`Error creating output directory: ${error.message}`, 'error');
    return;
  }
  
  // Create subdirectories
  const addressesDir = path.join(baseOutputDir, 'addresses');
  fs.mkdirSync(addressesDir, { recursive: true });
  
  let visibleElementsDir;
  if (includeVisible) {
    visibleElementsDir = path.join(baseOutputDir, 'visible-elements');
    fs.mkdirSync(visibleElementsDir, { recursive: true });
  }
  
  // Step 1: Run the address scraper
  try {
    const scrapeScriptPath = path.join(projectRoot, 'scripts', 'twitter', 'scrape.mjs');
    
    // Check if script exists
    if (!fs.existsSync(scrapeScriptPath)) {
      ui.message(`Script not found: ${scrapeScriptPath}`, 'error');
      return;
    }
    
    await executeCommand(
      'node', 
      [scrapeScriptPath, url], 
      {
        env: {
          ...process.env,
          NODE_OPTIONS: '--no-deprecation',
          CUSTOM_OUTPUT_DIR: addressesDir
        }
      },
      'Scraping addresses from tweet...',
      'Address scraping completed successfully'
    );
  } catch (error) {
    ui.message(`Address scraping failed: ${error.message}`, 'error');
    // Continue with other steps
  }
  
  // Step 2: Run the visible elements collector if enabled
  if (includeVisible) {
    ui.message('Processing visible elements...');
    
    const formats = ['md', 'json', 'html', 'txt'];
    
    for (const format of formats) {
      try {
        const scriptPath = path.join(projectRoot, 'scripts', 'twitter', 'utils', 'log-visible-elements.cjs');
        
        // Check if script exists
        if (!fs.existsSync(scriptPath)) {
          ui.message(`Script not found: ${scriptPath}`, 'error');
          continue;
        }
        
        await executeCommand(
          'node',
          [scriptPath, url, `--format=${format}`],
          {
            env: {
              ...process.env,
              NODE_OPTIONS: '--no-deprecation',
              CUSTOM_OUTPUT_DIR: visibleElementsDir,
              CUSTOM_OUTPUT_FILE: `visible-elements.${format}`
            }
          },
          `Generating ${format.toUpperCase()} output...`,
          `${format.toUpperCase()} output generated successfully`
        );
      } catch (error) {
        ui.message(`Error generating ${format.toUpperCase()} output: ${error.message}`, 'warning');
        // Continue with other formats
      }
    }
  }
  
  // Create/update a "latest" symlink
  const latestSymlinkPath = path.join(path.dirname(baseOutputDir), 'latest');
  
  try {
    // Remove existing symlink if it exists
    if (fs.existsSync(latestSymlinkPath)) {
      fs.unlinkSync(latestSymlinkPath);
    }
    
    // Create new symlink
    fs.symlinkSync(baseOutputDir, latestSymlinkPath, 'dir');
    ui.message('Updated "latest" symlink to point to this run', 'success');
  } catch (error) {
    ui.message(`Could not update "latest" symlink: ${error.message}`, 'warning');
  }
  
  // Final success message
  ui.box(
    `${chalk.green('Scraping completed successfully!')}\n\n` +
    `Results saved to: ${chalk.blue(baseOutputDir)}\n` +
    `Quick access: ${chalk.blue(`cd ${latestSymlinkPath}`)}`,
    {
      borderColor: 'green',
      padding: 1
    }
  );
}