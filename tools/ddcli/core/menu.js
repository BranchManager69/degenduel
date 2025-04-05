import chalk from 'chalk';
import { setupKeypress } from './keypress.js';

/**
 * Create an interactive menu with keyboard navigation
 * @param {Object} options Menu options
 * @param {string} options.title Menu title
 * @param {Array<{label: string, value: any}>} options.items Menu items with label and value
 * @param {Function} options.onSelect Callback when item is selected
 * @param {Function} options.onExit Callback when menu is exited
 */
export function createMenu(options) {
  const { title, items, onSelect, onExit } = options;
  let selectedIndex = 0;
  let active = true;
  
  // Clear the console area for the menu
  const clearMenu = () => {
    // Move cursor to beginning of line and clear down
    process.stdout.write('\x1B[1G\x1B[J');
  };
  
  // Render the menu
  const renderMenu = () => {
    clearMenu();
    console.log(chalk.bold.blue(title));
    console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
    
    items.forEach((item, index) => {
      const isSelected = index === selectedIndex;
      const prefix = isSelected ? chalk.blue('→ ') : '  ';
      const itemText = isSelected ? chalk.bold(item.label) : item.label;
      console.log(`${prefix}${itemText}`);
    });
    
    console.log('');
    console.log(chalk.dim('Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit'));
  };
  
  // Handle keypress events
  const handleKeypress = (str, key) => {
    if (!active) return;
    
    if (key.name === 'up') {
      selectedIndex = (selectedIndex > 0) ? selectedIndex - 1 : items.length - 1;
      renderMenu();
    } else if (key.name === 'down') {
      selectedIndex = (selectedIndex < items.length - 1) ? selectedIndex + 1 : 0;
      renderMenu();
    } else if (key.name === 'return') {
      const selectedItem = items[selectedIndex];
      if (onSelect && selectedItem) {
        // Clear the menu before calling onSelect
        clearMenu();
        active = false;
        onSelect(selectedItem.value, selectedItem);
      }
    } else if (key.name === 'escape') {
      if (onExit) {
        clearMenu();
        active = false;
        onExit();
      }
    }
  };
  
  // Setup keypress handler
  const keyHandler = setupKeypress({
    onKeyPress: handleKeypress,
  });
  
  // Initial render
  renderMenu();
  
  // Return control functions
  return {
    close: () => {
      active = false;
      keyHandler.cleanup();
      clearMenu();
    },
    rerender: renderMenu,
  };
}