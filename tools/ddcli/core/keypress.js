import readline from 'readline';

/**
 * Setup key-press handling for interactive UI
 * @param {Object} options Configuration options
 * @param {boolean} options.raw Whether to use raw mode
 * @param {Function} options.onKeyPress Function to call on keypress
 * @returns {Object} Control functions for the keypress handler
 */
export function setupKeypress(options = {}) {
  const { raw = true, onKeyPress } = options;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  // Setup raw mode for direct keypresses
  if (raw) {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
  }
  
  // Handle keypress events
  const keypressHandler = (str, key) => {
    // Common exit keys
    if (key.ctrl && key.name === 'c') {
      cleanup();
      process.exit(0);
    }
    
    // Call the provided handler
    if (typeof onKeyPress === 'function') {
      onKeyPress(str, key);
    }
  };
  
  // Clean up function
  const cleanup = () => {
    process.stdin.removeListener('keypress', keypressHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    rl.close();
  };
  
  // Register handler
  process.stdin.on('keypress', keypressHandler);
  
  return {
    cleanup,
    // Provide a way to pause/resume handling
    pause: () => {
      process.stdin.removeListener('keypress', keypressHandler);
    },
    resume: () => {
      process.stdin.on('keypress', keypressHandler);
    },
  };
}