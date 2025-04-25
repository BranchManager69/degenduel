/**
 * Input handler for interactive CLI forms
 * Provides reusable input components for different data types
 */
import readline from 'readline';
import chalk from 'chalk';
import { setupKeypress } from './keypress.js';
import { createMenu } from './menu.js';

/**
 * Get text input from the user
 * @param {Object} options Input options
 * @param {string} options.prompt Prompt text to display
 * @param {Function} options.validate Validation function (returns error message or null if valid)
 * @param {string} options.default Default value
 * @param {Array<string>} options.suggestions Suggested values
 * @returns {Promise<string>} The user's input
 */
export async function getTextInput(options) {
  const { prompt, validate, default: defaultValue = '', suggestions = [] } = options;
  
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    // Display prompt with default and suggestions
    let promptText = `${prompt}`;
    
    if (defaultValue) {
      promptText += ` (default: ${chalk.cyan(defaultValue)})`;
    }
    
    if (suggestions.length > 0) {
      promptText += `\nSuggestions: ${suggestions.map(s => chalk.cyan(s)).join(', ')}`;
    }
    
    promptText += '\n> ';
    
    const askInput = () => {
      rl.question(promptText, (answer) => {
        // Use default if empty
        const value = answer.trim() || defaultValue;
        
        // Validate input if validator provided
        if (validate) {
          const validationError = validate(value);
          if (validationError) {
            console.log(chalk.red(`Error: ${validationError}`));
            askInput(); // Ask again
            return;
          }
        }
        
        rl.close();
        resolve(value);
      });
    };
    
    askInput();
  });
}

/**
 * Get numeric input from the user
 * @param {Object} options Input options
 * @param {string} options.prompt Prompt text to display
 * @param {number} options.min Minimum allowed value
 * @param {number} options.max Maximum allowed value
 * @param {number} options.default Default value
 * @param {Array<number>} options.suggestions Suggested values
 * @returns {Promise<number>} The user's input as a number
 */
export async function getNumberInput(options) {
  const { prompt, min, max, default: defaultValue, suggestions = [] } = options;
  
  // Create validator function
  const validate = (value) => {
    const num = parseFloat(value);
    
    if (isNaN(num)) {
      return 'Please enter a valid number';
    }
    
    if (min !== undefined && num < min) {
      return `Value must be at least ${min}`;
    }
    
    if (max !== undefined && num > max) {
      return `Value must be at most ${max}`;
    }
    
    return null;
  };
  
  // Get and parse the input
  const value = await getTextInput({
    prompt,
    validate,
    default: defaultValue !== undefined ? defaultValue.toString() : undefined,
    suggestions: suggestions.map(s => s.toString()),
  });
  
  return parseFloat(value);
}

/**
 * Display a selection menu for the user to choose from
 * @param {Object} options Selection options
 * @param {string} options.title Menu title
 * @param {Array<{label: string, value: any}>} options.items Menu items
 * @param {any} options.default Default selection value
 * @returns {Promise<any>} The selected value
 */
export async function getSelection(options) {
  const { title, items, default: defaultValue } = options;
  
  // Find default index if provided
  let defaultIndex = 0;
  if (defaultValue !== undefined) {
    const index = items.findIndex(item => item.value === defaultValue);
    if (index !== -1) {
      defaultIndex = index;
    }
  }
  
  return new Promise((resolve) => {
    createMenu({
      title,
      items,
      initialIndex: defaultIndex,
      isSubmenu: true,
      onSelect: (value) => {
        resolve(value);
      },
      onExit: () => {
        // Return default value or null on exit
        resolve(defaultValue !== undefined ? defaultValue : null);
      }
    });
  });
}

/**
 * Get confirmation from the user (yes/no)
 * @param {Object} options Confirmation options
 * @param {string} options.prompt Prompt text to display
 * @param {boolean} options.default Default selection (true for yes, false for no)
 * @returns {Promise<boolean>} True for yes, false for no
 */
export async function getConfirmation(options) {
  const { prompt, default: defaultValue = true } = options;
  
  const items = [
    { 
      label: defaultValue ? chalk.green('Yes') + ' (default)' : 'Yes', 
      value: true 
    },
    { 
      label: !defaultValue ? chalk.red('No') + ' (default)' : 'No', 
      value: false 
    }
  ];
  
  return getSelection({
    title: prompt,
    items,
    default: defaultValue
  });
}

/**
 * Create a form with multiple inputs
 * @param {Object} options Form options
 * @param {string} options.title Form title
 * @param {Array<{type: string, field: string, ...}>} options.fields Form fields
 * @returns {Promise<Object>} Object with field values
 */
export async function getFormInput(options) {
  const { title, fields } = options;
  const result = {};
  
  console.log(chalk.bold.blue(title));
  console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
  
  for (const field of fields) {
    const { type, field: fieldName, ...fieldOptions } = field;
    
    switch (type) {
      case 'text':
        result[fieldName] = await getTextInput(fieldOptions);
        break;
      case 'number':
        result[fieldName] = await getNumberInput(fieldOptions);
        break;
      case 'select':
        result[fieldName] = await getSelection(fieldOptions);
        break;
      case 'confirm':
        result[fieldName] = await getConfirmation(fieldOptions);
        break;
      default:
        console.warn(chalk.yellow(`Unknown field type: ${type}`));
        break;
    }
  }
  
  return result;
}

/**
 * Show a message with options for the user to choose from
 * @param {Object} options Message options
 * @param {string} options.message Message to display
 * @param {Array<{label: string, value: any}>} options.actions Available actions
 * @returns {Promise<any>} The selected action value
 */
export async function showMessage(options) {
  const { message, actions } = options;
  
  console.log(message);
  
  if (!actions || actions.length === 0) {
    return Promise.resolve(null);
  }
  
  return getSelection({
    title: 'Select an action',
    items: actions,
    isSubmenu: true
  });
}