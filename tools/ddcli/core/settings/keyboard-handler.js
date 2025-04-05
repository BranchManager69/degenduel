import { setupKeypress } from '../keypress.js';
import settingsManager from './settings-manager.js';
import ui from '../ui.js';
import chalk from 'chalk';

let keyhandler = null;
let isSettingsOpen = false;

/**
 * Initialize keyboard shortcuts for settings
 * @param {Object} options Options for keypress handling
 */
export function initializeSettingsKeyboardShortcuts(options = {}) {
  const { onSettingsOpen, onSettingsClose } = options;
  
  // Clean up existing handler if one exists
  if (keyhandler) {
    keyhandler.cleanup();
  }
  
  // Setup new keyboard handler
  keyhandler = setupKeypress({
    onKeyPress: (str, key) => {
      // Check for settings hotkey ('s' key)
      if (key.name === 's' && !key.ctrl && !key.meta && !key.shift) {
        if (!isSettingsOpen) {
          isSettingsOpen = true;
          
          // Notify that settings are being opened
          if (typeof onSettingsOpen === 'function') {
            onSettingsOpen();
          }
          
          // Clear current display
          console.log('\n');
          ui.message('Opening settings...', 'info');
          
          // Show settings menu
          settingsManager.showSettingsMenu(() => {
            isSettingsOpen = false;
            
            // Notify that settings are closed
            if (typeof onSettingsClose === 'function') {
              onSettingsClose();
            }
            
            ui.message(`\nSettings closed. Press ${chalk.bold('s')} to open settings again.`, 'info');
          });
        }
      }
      
      // Pass to original handler if provided
      if (options.onKeyPress && !isSettingsOpen) {
        options.onKeyPress(str, key);
      }
    }
  });
  
  return {
    cleanup: () => {
      if (keyhandler) {
        keyhandler.cleanup();
        keyhandler = null;
      }
    }
  };
}

/**
 * Display help text for settings keyboard shortcuts
 */
export function showSettingsKeyboardHelp() {
  console.log(`\nSettings: Press ${chalk.bold('s')} at any time to open settings menu`);
}