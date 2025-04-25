import { Command } from 'commander';
import chalk from 'chalk';
import ui from '../../core/ui.js';
import { setupKeypress } from '../../core/keypress.js';
import { monitorKeyword } from './twitter-monitor.js';
import { scrapeTweet } from './twitter-scraper.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to Twitter session cookies
const TWITTER_SESSION_PATH = path.resolve('/home/websites/degenduel/keys/twitter-session.json');

// Module description - used by the interactive menu
export const description = 'Monitor Twitter for keywords and scrape content from tweets';

/**
 * Run the Twitter session helper script
 */
function runSessionHelper() {
  const helperPath = path.join(__dirname, 'twitter-session-helper.js');
  
  // Make sure the helper script is executable
  try {
    fs.chmodSync(helperPath, 0o755);
  } catch (error) {
    console.error(chalk.red(`Error making helper script executable: ${error.message}`));
  }
  
  // Spawn the helper script as a child process
  const child = spawn('node', [helperPath], {
    stdio: 'inherit',
    shell: true
  });
  
  // Handle errors
  child.on('error', (error) => {
    console.error(chalk.red(`Error running helper script: ${error.message}`));
  });
}

/**
 * Register all commands for the twitter monitor module
 * @param {import('commander').Command} program Commander program instance
 */
export function registerCommands(program) {
  const twitterCommand = new Command('twitter')
    .description('Twitter monitoring and scraping tools');
  
  // Add monitor subcommand
  twitterCommand
    .command('monitor')
    .description('Monitor Twitter for keywords')
    .argument('<keyword>', 'Keyword to monitor')
    .option('-i, --interval <seconds>', 'Polling interval in seconds', '30')
    .option('-l, --limit <count>', 'Maximum number of tweets to display', '10')
    .option('-a, --analyze', 'Analyze tweets with AI', false)
    .option('-t, --analysis-type <type>', 'Type of analysis (sentiment, topics, summary, alert)', 'sentiment')
    .option('--alert-threshold <level>', 'Alert threshold level (low, medium, high)', 'medium')
    .option('--prompt <text>', 'Custom analysis prompt for AI')
    .action((keyword, options) => {
      // Check if session file exists
      if (!fs.existsSync(TWITTER_SESSION_PATH)) {
        ui.box(
          `${chalk.red('Twitter session file not found!')}\n\n` +
          `You need to generate a Twitter session file before using this command.\n` +
          `Run ${chalk.cyan('ddcli twitter login')} for step-by-step instructions.`,
          { borderColor: 'red', padding: 1 }
        );
        return;
      }
      
      // Check for OpenAI API key if analysis is enabled
      if (options.analyze && !process.env.OPENAI_API_KEY) {
        ui.box(
          `${chalk.yellow('Warning: OpenAI API key not found!')}\n\n` +
          `To use AI analysis, set the OPENAI_API_KEY environment variable:\n\n` +
          `${chalk.cyan('export OPENAI_API_KEY=your_api_key_here')}\n\n` +
          `Continuing without AI analysis...`,
          { borderColor: 'yellow', padding: 1 }
        );
        options.analyze = false;
      }
      
      const interval = parseInt(options.interval, 10) * 1000;
      const limit = parseInt(options.limit, 10);
      
      ui.header(`Twitter Monitor: ${chalk.green(keyword)}`);
      ui.message(`Monitoring for tweets containing "${keyword}"`);  
      ui.message(`Polling every ${options.interval} seconds`);
      
      if (options.analyze) {
        ui.message(`AI Analysis: ${chalk.cyan(options.analysisType)}`);
        if (options.analysisType === 'alert') {
          ui.message(`Alert Threshold: ${chalk.yellow(options.alertThreshold)}`);
        }
      }
      
      ui.message(`Press ${chalk.bold('Ctrl+C')} to exit`, 'info');
      console.log('');
      
      // Start monitoring with analysis options
      monitorKeyword(keyword, { 
        interval, 
        limit,
        analyze: options.analyze,
        analysisType: options.analysisType,
        alertThreshold: options.alertThreshold,
        customPrompt: options.prompt
      });
      
      // Setup keypress handler for interactive control
      setupKeypress({
        onKeyPress: (str, key) => {
          // Additional key handlers can be added here
        }
      });
    });
    
  // Add scrape subcommand (similar to 'npm run x')
  twitterCommand
    .command('scrape')
    .description('Scrape content from a Twitter/X post')
    .argument('<url>', 'URL of the tweet to scrape')
    .option('-v, --visible <boolean>', 'Include visible elements in output', 'true')
    .action((url, options) => {
      // Check if session file exists
      if (!fs.existsSync(TWITTER_SESSION_PATH)) {
        ui.box(
          `${chalk.red('Twitter session file not found!')}\n\n` +
          `You need to generate a Twitter session file before using this command.\n` +
          `Run ${chalk.cyan('ddcli twitter login')} for step-by-step instructions.`,
          { borderColor: 'red', padding: 1 }
        );
        return;
      }
      
      const includeVisible = options.visible.toLowerCase() === 'true';
      
      ui.header(`Twitter Scraper`);
      ui.message(`Scraping content from: ${chalk.blue(url)}`);
      ui.message(`Including visible elements: ${includeVisible ? chalk.green('Yes') : chalk.yellow('No')}`);
      
      // Start scraping
      scrapeTweet(url, { includeVisible });
    });
  
  // Add x subcommand as an alias to scrape (equivalent to 'npm run x')
  twitterCommand
    .command('x')
    .description('Quickly scrape a Twitter/X post (alias for scrape)')
    .argument('<url>', 'URL of the tweet to scrape')
    .option('-f, --fast', 'Skip visible elements collection for faster results', false)
    .action((url, options) => {
      // Check if session file exists
      if (!fs.existsSync(TWITTER_SESSION_PATH)) {
        ui.box(
          `${chalk.red('Twitter session file not found!')}\n\n` +
          `You need to generate a Twitter session file before using this command.\n` +
          `Run ${chalk.cyan('ddcli twitter login')} for step-by-step instructions.`,
          { borderColor: 'red', padding: 1 }
        );
        return;
      }
      
      const includeVisible = !options.fast;
      
      ui.header(`Twitter X Scraper`);
      ui.message(`Scraping content from: ${chalk.blue(url)}`);
      ui.message(`Mode: ${options.fast ? chalk.yellow('Fast (skip visible elements)') : chalk.green('Complete')}`);
      
      // Start scraping
      scrapeTweet(url, { includeVisible });
    });
  
  // Add login helper command
  twitterCommand
    .command('login')
    .description('Generate a new Twitter session file with step-by-step guidance')
    .action(() => {
      ui.header('Twitter Login Helper');
      ui.message('Running the Twitter login helper to generate a new session...');
      console.log('');
      
      // Run the session helper script
      runSessionHelper();
    });
  
  // Register the twitter command to the main program
  program.addCommand(twitterCommand);
}