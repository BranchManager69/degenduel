import { Command } from 'commander';
import chalk from 'chalk';
import ui from '../../core/ui.js';
import { setupKeypress } from '../../core/keypress.js';
import { monitorKeyword } from './twitter-monitor.js';
import { scrapeTweet } from './twitter-scraper.js';

// Module description - used by the interactive menu
export const description = 'Monitor Twitter for keywords and scrape content from tweets';

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
    .action((keyword, options) => {
      const interval = parseInt(options.interval, 10) * 1000;
      const limit = parseInt(options.limit, 10);
      
      ui.header(`Twitter Monitor: ${chalk.green(keyword)}`);
      ui.message(`Monitoring for tweets containing "${keyword}"`);  
      ui.message(`Polling every ${options.interval} seconds`);  
      ui.message(`Press ${chalk.bold('Ctrl+C')} to exit`, 'info');
      console.log('');
      
      // Start monitoring
      monitorKeyword(keyword, { interval, limit });
      
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
      const includeVisible = !options.fast;
      
      ui.header(`Twitter X Scraper`);
      ui.message(`Scraping content from: ${chalk.blue(url)}`);
      ui.message(`Mode: ${options.fast ? chalk.yellow('Fast (skip visible elements)') : chalk.green('Complete')}`);
      
      // Start scraping
      scrapeTweet(url, { includeVisible });
    });
  
  // Register the twitter command to the main program
  program.addCommand(twitterCommand);
}