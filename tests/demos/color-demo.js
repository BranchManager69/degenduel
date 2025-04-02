/**
 * Color Differentiation Demo - Compact Version
 */

// Define all color codes
const colors = {
  // Current service colors
  'Cyan (51)': '\x1b[1m\x1b[38;5;51m',      // contestWallet
  'Magenta (201)': '\x1b[1m\x1b[38;5;201m',  // tokenSync
  'Purple (127)': '\x1b[1m\x1b[38;5;127m',   // heliusClient
  'Orange (208)': '\x1b[1m\x1b[38;5;208m',   // jupiterClient
  'Blue (75)': '\x1b[1m\x1b[38;5;75m',       // solanaEngine
  
  // Suggested alternatives
  'Indigo (93)': '\x1b[1m\x1b[38;5;93m',     // deep purple-blue
  'Lime (112)': '\x1b[1m\x1b[38;5;112m',     // vibrant green
  'Salmon (209)': '\x1b[1m\x1b[38;5;209m',   // pinkish-orange
  'Teal (43)': '\x1b[1m\x1b[38;5;43m',       // blue-green
  'Sea Green (29)': '\x1b[1m\x1b[38;5;29m',  // darker green
  'Lavender (141)': '\x1b[1m\x1b[38;5;141m', // light purple
  'Turquoise (80)': '\x1b[1m\x1b[38;5;80m',  // blue-green
  
  'Reset': '\x1b[0m'
};

const reset = colors['Reset'];
const sep = '\n' + '-'.repeat(60) + '\n';

// Display header
console.log(sep + 'COLOR DEMO - CURRENT SERVICE COLORS' + sep);

// Current service colors
for (const [name, code] of Object.entries(colors)) {
  if (['Cyan (51)', 'Magenta (201)', 'Purple (127)', 'Orange (208)', 'Blue (75)'].includes(name)) {
    console.log(`${code}■■■ ${name.padEnd(15)}${reset}${code} [serviceClient] Example text${reset}`);
  }
}

// Recommended alternatives
console.log(sep + 'RECOMMENDED ALTERNATIVES' + sep);
for (const [name, code] of Object.entries(colors)) {
  if (['Indigo (93)', 'Lime (112)', 'Salmon (209)', 'Sea Green (29)'].includes(name)) {
    console.log(`${code}■■■ ${name.padEnd(15)}${reset}${code} [serviceClient] Example text${reset}`);
  }
}

// Show all colors in one block
console.log(sep + 'ALL COLORS WITH DIFFERENT UI ELEMENTS' + sep);
const elements = ['[tag]', 'Header', 'info', 'Success', 'Warning', 'Error'];

Object.entries(colors).forEach(([name, code]) => {
  if (name !== 'Reset') {
    console.log(`${code}${name.padEnd(15)}${reset}: ${elements.map(el => `${code}${el}${reset}`).join(' ')}`);
  }
});

// Quick comparison table
console.log(sep + 'VISUAL COMPARISON MATRIX' + sep);
const serviceColors = ['Cyan (51)', 'Magenta (201)', 'Purple (127)', 'Orange (208)', 'Blue (75)'];
const altColors = ['Indigo (93)', 'Lime (112)', 'Salmon (209)', 'Sea Green (29)'];

console.log('   ' + serviceColors.map(c => colors[c] + '■' + reset).join(' ') + ' ← Current');
console.log('   ' + altColors.map(c => colors[c] + '■' + reset).join(' ') + ' ← Recommended');
console.log(sep);