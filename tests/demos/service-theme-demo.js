/**
 * Service Theme Demo - Compact Version
 */

// Reset code and utility functions
const RESET = '\x1b[0m';
const sep = (char = '-', length = 60) => console.log(char.repeat(length));

// Helper to create a complete theme from a base color
function createTheme(baseName, baseColor, isDark = false) {
  const darkBg = '\x1b[48;5;236m';
  const headerBg = isDark ? '\x1b[48;5;236m' : darkBg;
  
  return {
    name: baseName,
    colors: {
      tag: `\x1b[1m${baseColor}`,                 // Bold base color for tag
      header: `\x1b[1m${baseColor}${headerBg}`,   // Bold base color on dark background for headers
      info: baseColor,                            // Base color for info messages
      success: '\x1b[38;5;46m',                   // Standard green for success
      warning: '\x1b[38;5;214m',                  // Standard orange for warnings
      error: '\x1b[38;5;196m',                    // Standard red for errors
      highlight: `\x1b[4m\x1b[1m${baseColor}`,    // Bold underlined base color for highlights
      token: '\x1b[38;5;220m',                    // Gold for token symbols
    }
  };
}

// Current and recommended themes
const themes = {
  // Current
  tokenSync: createTheme('Token Sync', '\x1b[38;5;201m'),           // Magenta (201)
  contestWallet: createTheme('Contest Wallet', '\x1b[38;5;51m'),    // Cyan (51)
  heliusClient: createTheme('Helius Client', '\x1b[38;5;127m'),     // Purple (127)
  jupiterClient: createTheme('Jupiter Client', '\x1b[38;5;208m'),   // Orange (208)
  solanaEngine: createTheme('Solana Engine', '\x1b[38;5;75m'),      // Blue (75)
  
  // Recommended alternatives
  indigo: createTheme('Indigo Theme', '\x1b[38;5;93m', true),       // Indigo (93)
  lime: createTheme('Lime Theme', '\x1b[38;5;112m'),                // Lime (112)
  salmon: createTheme('Salmon Theme', '\x1b[38;5;209m'),            // Salmon (209)
  seaGreen: createTheme('Sea Green Theme', '\x1b[38;5;29m', true),  // Sea Green (29)
};

// Display a theme with all component variations
function displayTheme(theme) {
  const c = theme.colors;
  const r = RESET;
  
  console.log(`${c.tag}${theme.name}${r}`);
  console.log(`${c.header} HEADER ${r} | ${c.tag}[Tag]${r} | ${c.info}Info${r} | ${c.success}Success${r} | ${c.warning}Warning${r} | ${c.error}Error${r} | ${c.highlight}Highlight${r} | ${c.token}Token${r}`);

  // Usage example
  console.log(`  ${c.tag}[service]${r} ${c.info}Processing ${c.token}SOL${r}${c.info} token operations${r}`);
  console.log(`  ${c.tag}[service]${r} ${c.success}Transaction complete${r}`);
  console.log(`  ${c.tag}[service]${r} ${c.warning}Network congestion detected${r}`);
  console.log(`  ${c.tag}[service]${r} ${c.error}Failed to connect${r}`);
}

// Main display
console.log('\n✨ SERVICE THEME DEMO ✨\n');

// Current themes
sep('=');
console.log('CURRENT SERVICE THEMES');
sep('=');

Object.entries(themes)
  .filter(([key]) => ['tokenSync', 'contestWallet', 'heliusClient', 'jupiterClient', 'solanaEngine'].includes(key))
  .forEach(([_, theme]) => {
    displayTheme(theme);
    sep();
  });

// Recommended themes
sep('=');
console.log('RECOMMENDED NEW THEMES');
sep('=');

Object.entries(themes)
  .filter(([key]) => ['indigo', 'lime', 'salmon', 'seaGreen'].includes(key))
  .forEach(([_, theme]) => {
    displayTheme(theme);
    sep();
  });

// Implementation guide
console.log('\nIMPLEMENTATION EXAMPLE:');
console.log('```javascript');
console.log('// In colors.js:');
console.log('export const serviceSpecificColors = {');
console.log('  // Current services...');
console.log('  ');
console.log('  // New service with Indigo theme');
console.log('  myNewService: {');
console.log('    tag: \'\\x1b[1m\\x1b[38;5;93m\',                  // Bold indigo');
console.log('    header: \'\\x1b[1m\\x1b[38;5;93m\\x1b[48;5;236m\', // Bold indigo on dark bg');
console.log('    info: \'\\x1b[38;5;93m\',                         // Indigo');
console.log('    success: \'\\x1b[38;5;46m\',                      // Green');
console.log('    warning: \'\\x1b[38;5;214m\',                     // Orange');
console.log('    error: \'\\x1b[38;5;196m\',                       // Red');
console.log('  }');
console.log('};');
console.log('```\n');

// Visual comparison
sep('=');
console.log('QUICK REFERENCE');
sep();

const colorNames = {
  tokenSync: 'Magenta (201)',
  contestWallet: 'Cyan (51)',
  heliusClient: 'Purple (127)',
  jupiterClient: 'Orange (208)',
  solanaEngine: 'Blue (75)',
  indigo: 'Indigo (93)',
  lime: 'Lime (112)',
  salmon: 'Salmon (209)',
  seaGreen: 'Sea Green (29)'
};

Object.entries(themes).forEach(([key, theme]) => {
  console.log(`${theme.colors.tag}■${RESET} ${theme.colors.tag}${key.padEnd(15)}${RESET} - ${colorNames[key]}`);
});