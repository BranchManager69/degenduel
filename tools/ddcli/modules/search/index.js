import { Command } from 'commander';
import chalk from 'chalk';
import ui from '../../core/ui.js';
import { search, healthCheck } from './search-client.js';
import { setupKeypress } from '../../core/keypress.js';

// Module description - used by the interactive menu
export const description = 'Search codebase using the custom AI API';

/**
 * Register all commands for the search module
 * @param {import('commander').Command} program Commander program instance
 */
export function registerCommands(program) {
  const searchCommand = new Command('search')
    .description('Search codebase using the custom AI API');
  
  // Basic search command
  searchCommand
    .command('query')
    .description('Search for code matching a query')
    .argument('<query>', 'Search query')
    .option('-l, --limit <number>', 'Maximum number of results', '5')
    .option('-e, --endpoint <string>', 'API endpoint to use', 'search')
    .option('-f, --format <string>', 'Output format (terminal, json)', 'terminal')
    .action(async (query, options) => {
      ui.header(`AI Code Search: ${chalk.green(query)}`);
      ui.message(`Searching codebase for "${query}"...`);
      console.log('');
      
      try {
        const spinner = ui.spinner('Querying AI API...');
        spinner.start();
        
        const result = await search(query, options);
        
        spinner.succeed('Search completed');
        
        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Display results in terminal with nice formatting
          if (result.matches && result.matches.length > 0) {
            result.matches.forEach((match, index) => {
              ui.box(
                `${chalk.blue(`#${index + 1} - ${match.file || 'Unknown file'}`)}${match.line ? chalk.dim(` (Line ${match.line})`) : ''}\n\n` +
                `${match.code ? match.code.trim() : 'No code available'}\n\n` +
                (match.explanation ? `${chalk.yellow('Explanation:')} ${match.explanation}` : ''),
                {
                  padding: 1,
                  borderColor: 'green',
                  borderStyle: 'round',
                }
              );
            });
          } else {
            ui.message('No matches found', 'warning');
          }
          
          if (result.summary) {
            ui.box(
              `${chalk.bold('Search Summary')}\n\n${result.summary}`,
              { padding: 1, borderColor: 'blue', borderStyle: 'round' }
            );
          }
        }
      } catch (err) {
        ui.message(`Error: ${err.message}`, 'error');
        console.error(chalk.red(err.stack));
      }
    });
  
  // Status check command
  searchCommand
    .command('status')
    .description('Check the AI API server status')
    .action(async () => {
      ui.header('AI API Server Status');
      
      try {
        const spinner = ui.spinner('Checking API server status...');
        spinner.start();
        
        const status = await healthCheck();
        
        spinner.succeed('Status check completed');
        
        ui.box(
          `${chalk.bold('API Server Status')}\n\n` +
          `Status: ${status.status === 'ok' ? chalk.green('Online') : chalk.red('Offline')}\n` +
          `Version: ${status.version || 'Unknown'}\n` +
          `Memory: ${status.memory || 'Not reported'}\n` +
          `Uptime: ${status.uptime || 'Not reported'}\n` +
          `Models: ${status.models ? status.models.join(', ') : 'Not reported'}\n`,
          { padding: 1, borderColor: 'cyan', borderStyle: 'round' }
        );
      } catch (err) {
        ui.message(`Error connecting to API server: ${err.message}`, 'error');
      }
    });
  
  // Shorthand for search query - allows for: ddcli s "query string"
  const shortCommand = new Command('s')
    .description('Quick search (alias for search query)')
    .argument('<query>', 'Search query')
    .option('-l, --limit <number>', 'Maximum number of results', '5')
    .option('-e, --endpoint <string>', 'API endpoint to use', 'search')
    .option('-f, --format <string>', 'Output format (terminal, json)', 'terminal')
    .action(async (query, options) => {
      ui.header(`Quick Search: ${chalk.green(query)}`);
      
      try {
        const spinner = ui.spinner('Searching...');
        spinner.start();
        
        const result = await search(query, options);
        
        spinner.succeed('Search completed');
        
        if (options.format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Display results in terminal with nice formatting
          if (result.matches && result.matches.length > 0) {
            result.matches.forEach((match, index) => {
              ui.box(
                `${chalk.blue(`#${index + 1} - ${match.file || 'Unknown file'}`)}${match.line ? chalk.dim(` (Line ${match.line})`) : ''}\n\n` +
                `${match.code ? match.code.trim() : 'No code available'}\n\n` +
                (match.explanation ? `${chalk.yellow('Explanation:')} ${match.explanation}` : ''),
                {
                  padding: 1,
                  borderColor: 'green',
                  borderStyle: 'round',
                }
              );
            });
          } else {
            ui.message('No matches found', 'warning');
          }
          
          if (result.summary) {
            ui.box(
              `${chalk.bold('Search Summary')}\n\n${result.summary}`,
              { padding: 1, borderColor: 'blue', borderStyle: 'round' }
            );
          }
        }
      } catch (err) {
        ui.message(`Error: ${err.message}`, 'error');
      }
    });
  
  // Register the search command and shorthand to the main program
  program.addCommand(searchCommand);
  program.addCommand(shortCommand);
}