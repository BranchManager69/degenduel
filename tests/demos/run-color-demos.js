/**
 * Combined Color Demo Runner
 * Runs both color-demo.js and service-theme-demo.js sequentially
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n====================================================================');
console.log('                      RUNNING COLOR DEMOS                           ');
console.log('====================================================================\n');

// Define the demo scripts to run
const demoScripts = [
  path.join(__dirname, 'color-demo.js'),
  path.join(__dirname, 'service-theme-demo.js')
];

// Run each demo script
for (let i = 0; i < demoScripts.length; i++) {
  const script = demoScripts[i];
  
  if (i > 0) {
    // Add a separator between demos
    console.log('\n\n====================================================================');
    console.log('                      NEXT DEMO                                    ');
    console.log('====================================================================\n\n');
  }
  
  try {
    // Use execSync to run the script as a separate process
    execSync(`node ${script}`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Error running ${script}:`, error);
  }
}

console.log('\n====================================================================');
console.log('                      ALL DEMOS COMPLETED                          ');
console.log('====================================================================\n');