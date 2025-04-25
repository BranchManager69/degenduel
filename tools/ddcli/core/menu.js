import chalk from 'chalk';
import { setupKeypress } from './keypress.js';

// Global menu stack to handle nested menus
const menuStack = [];
let activeKeyHandler = null;

/**
 * Cleanup all active menus and keyhandlers
 */
export function cleanupAllMenus() {
  if (activeKeyHandler) {
    activeKeyHandler.cleanup();
    activeKeyHandler = null;
  }
  
  // Clear menu stack
  menuStack.length = 0;
  
  // Clear the screen
  console.clear();
}

/**
 * Create an interactive menu with keyboard navigation
 * @param {Object} options Menu options
 * @param {string} options.title Menu title
 * @param {Array<{label: string, value: any}>} options.items Menu items with label and value
 * @param {Function} options.onSelect Callback when item is selected
 * @param {Function} options.onExit Callback when menu is exited
 * @param {boolean} options.isSubmenu Whether this is a submenu
 * @param {number} options.initialIndex Initial selected index
 */
export function createMenu(options) {
  const { title, items, onSelect, onExit, isSubmenu = false, initialIndex = 0 } = options;
  let selectedIndex = initialIndex;
  let active = true;
  
  // Clean up any existing menu if this is not a submenu
  if (!isSubmenu && menuStack.length > 0) {
    cleanupAllMenus();
  }
  
  // Add this menu to the stack
  const menuId = Date.now();
  const menuInstance = { id: menuId, active: true };
  menuStack.push(menuInstance);
  
  // Clear the console area for the menu
  const clearMenu = () => {
    console.clear();
  };
  
  // Render the menu
  const renderMenu = () => {
    // Only render if this is the active menu
    if (!menuInstance.active) return;
    
    clearMenu();
    
    // Re-render any banner if this is the main menu
    if (menuStack.length === 1) {
      try {
        // Using dynamic import for ESM compatibility
        import('figlet').then(figletModule => {
          import('gradient-string').then(gradientModule => {
            const banner = figletModule.default.textSync('DDCLI', { font: 'ANSI Shadow' });
            console.log(gradientModule.default.rainbow(banner));
            console.log(chalk.blue('DegenDuel Command Line Interface'));
            console.log(chalk.dim('━'.repeat(process.stdout.columns || 80)));
            
            // Re-render the menu items after the banner
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
          }).catch(() => {
            // Fallback if gradient-string fails to import
            renderMenuItems();
          });
        }).catch(() => {
          // Fallback if figlet fails to import
          renderMenuItems();
        });
        
        // Early return since we'll render the menu items in the promise callbacks
        return;
      } catch (err) {
        // Banner rendering is optional, continue with normal menu
      }
    }
    
    // Function to render just the menu items (used as fallback and for submenus)
    function renderMenuItems() {
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
    }
    
    // Render the menu items (will be executed if we didn't return early from banner rendering)
    renderMenuItems();
  };
  
  // Handle keypress events
  const handleKeypress = (str, key) => {
    // Only handle keys if this is the top menu
    if (menuStack.length === 0 || menuStack[menuStack.length - 1].id !== menuId || !active) {
      return;
    }
    
    if (key.name === 'up') {
      selectedIndex = (selectedIndex > 0) ? selectedIndex - 1 : items.length - 1;
      renderMenu();
    } else if (key.name === 'down') {
      selectedIndex = (selectedIndex < items.length - 1) ? selectedIndex + 1 : 0;
      renderMenu();
    } else if (key.name === 'return') {
      const selectedItem = items[selectedIndex];
      if (onSelect && selectedItem) {
        // Mark this menu as inactive before calling onSelect
        menuInstance.active = false;
        active = false;
        
        // Remove this menu from the stack
        const index = menuStack.findIndex(m => m.id === menuId);
        if (index !== -1) {
          menuStack.splice(index, 1);
        }
        
        // Call onSelect with the selected value
        onSelect(selectedItem.value, selectedItem);
      }
    } else if (key.name === 'escape') {
      if (onExit) {
        // Mark this menu as inactive
        menuInstance.active = false;
        active = false;
        
        // Remove this menu from the stack
        const index = menuStack.findIndex(m => m.id === menuId);
        if (index !== -1) {
          menuStack.splice(index, 1);
        }
        
        // Call onExit
        onExit();
      }
    }
  };
  
  // Cleanup existing key handler
  if (activeKeyHandler) {
    activeKeyHandler.cleanup();
  }
  
  // Setup keypress handler
  activeKeyHandler = setupKeypress({
    onKeyPress: handleKeypress,
  });
  
  // Initial render
  renderMenu();
  
  // Return control functions
  return {
    close: () => {
      active = false;
      menuInstance.active = false;
      
      // Remove this menu from the stack
      const index = menuStack.findIndex(m => m.id === menuId);
      if (index !== -1) {
        menuStack.splice(index, 1);
      }
      
      // Only clean up the key handler if this is the last menu
      if (menuStack.length === 0 && activeKeyHandler) {
        activeKeyHandler.cleanup();
        activeKeyHandler = null;
      }
      
      clearMenu();
    },
    rerender: renderMenu,
  };
}