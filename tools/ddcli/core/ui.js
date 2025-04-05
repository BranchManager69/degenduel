import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';

/**
 * UI utilities for consistent CLI styling
 */
const ui = {
  /**
   * Display a formatted header
   * @param {string} text The header text to display
   */
  header: (text) => {
    console.log('');
    console.log(chalk.bold.blue(text));
    console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  },
  
  /**
   * Display a colored message
   * @param {string} text The text to display
   * @param {string} type The type of message (info, success, warning, error)
   */
  message: (text, type = 'info') => {
    const styles = {
      info: chalk.blue,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
    };
    const style = styles[type] || styles.info;
    console.log(style(text));
  },
  
  /**
   * Display a boxed message
   * @param {string} text The text to display in the box
   * @param {boxen.Options} options Boxen options for styling
   */
  box: (text, options = {}) => {
    const defaultOptions = {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue',
    };
    console.log(boxen(text, { ...defaultOptions, ...options }));
  },
  
  /**
   * Create a spinner with consistent styling
   * @param {string} text The spinner text to display
   * @returns {ora.Ora} The spinner instance
   */
  spinner: (text) => {
    return ora({
      text,
      color: 'blue',
    });
  },
  
  /**
   * Format a key-value pair for display
   * @param {string} key The key
   * @param {string} value The value
   * @returns {string} Formatted string
   */
  keyValue: (key, value) => {
    return `${chalk.blue(key)}: ${value}`;
  },
  
  /**
   * Print a table with headers and rows
   * @param {string[]} headers Table headers
   * @param {string[][]} rows Table rows (arrays of values)
   */
  table: (headers, rows) => {
    // Calculate column widths based on content
    const colWidths = headers.map((header, colIndex) => {
      const maxRowWidth = rows.reduce((max, row) => {
        return Math.max(max, String(row[colIndex] || '').length);
      }, 0);
      return Math.max(header.length, maxRowWidth) + 2;
    });
    
    // Print headers
    const headerRow = headers.map((header, i) => 
      chalk.bold.blue(header.padEnd(colWidths[i])))
      .join(' ');
    console.log(headerRow);
    
    // Print separator
    const separator = colWidths.map(width => '─'.repeat(width)).join(' ');
    console.log(chalk.dim(separator));
    
    // Print rows
    for (const row of rows) {
      const formattedRow = row.map((cell, i) => 
        String(cell || '').padEnd(colWidths[i]))
        .join(' ');
      console.log(formattedRow);
    }
  },
};

export default ui;