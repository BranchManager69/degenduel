import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { createMenu } from './menu.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get a list of all available modules
 * @returns {Array<{name: string, description: string}>} List of modules with descriptions
 */
export async function getAvailableModules() {
  const modulesDir = path.join(__dirname, '..', 'modules');
  
  if (!fs.existsSync(modulesDir)) {
    console.error(chalk.red(`Modules directory not found: ${modulesDir}`));
    return [];
  }
  
  const moduleEntries = fs.readdirSync(modulesDir, { withFileTypes: true });
  
  const moduleDirs = moduleEntries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name);
  
  const modules = [];
  
  for (const moduleName of moduleDirs) {
    const moduleIndexPath = path.join(modulesDir, moduleName, 'index.js');
    
    if (fs.existsSync(moduleIndexPath)) {
      try {
        const module = await import(`../modules/${moduleName}/index.js`);
        
        // Format the module name for display
        const formattedName = moduleName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        
        // Get description if available, otherwise use default
        let description = 'No description available';
        if (module.description) {
          description = module.description;
        }
        
        modules.push({
          name: moduleName,
          displayName: formattedName,
          description
        });
      } catch (err) {
        console.error(chalk.red(`Error loading module info '${moduleName}':`, err));
      }
    }
  }
  
  return modules;
}

/**
 * Show an interactive menu of available modules
 * @param {import('commander').Command} program The Commander program instance
 */
export async function showModuleMenu(program) {
  const modules = await getAvailableModules();
  
  if (modules.length === 0) {
    console.error(chalk.red('No modules found'));
    return;
  }
  
  // Create menu items from modules
  const menuItems = modules.map(module => ({
    label: `${module.displayName} - ${module.description}`,
    value: module.name
  }));
  
  // Add an exit option
  menuItems.push({
    label: 'Exit',
    value: 'exit'
  });
  
  // Banner is now handled by the menu system

  // Create the menu
  createMenu({
    title: 'DegenDuel CLI Modules',
    items: menuItems,
    onSelect: async (value) => {
      if (value === 'exit') {
        process.exit(0);
      } else {
        try {
          // Try to load the module
          const module = await import(`../modules/${value}/index.js`);
          
          // Check if the module has an interactive mode
          if (typeof module.showInteractiveMenu === 'function') {
            // Launch the module's interactive menu
            await module.showInteractiveMenu();
            
            // After the interactive session, show the main menu again
            showModuleMenu(program);
          } else {
            // Fall back to showing help if no interactive mode
            console.log(chalk.yellow(`Module '${value}' does not support interactive mode. Showing help instead.`));
            console.log('');
            program.parse([process.argv[0], process.argv[1], value, '--help']);
            
            // Return to the main menu after a brief pause
            setTimeout(() => {
              showModuleMenu(program);
            }, 3000);
          }
        } catch (err) {
          console.error(chalk.red(`Error launching module '${value}':`, err));
          
          // Return to the main menu after a brief pause
          setTimeout(() => {
            showModuleMenu(program);
          }, 3000);
        }
      }
    },
    onExit: () => {
      process.exit(0);
    }
  });
}

/**
 * Load all CLI modules and register their commands
 * @param {import('commander').Command} program The Commander program instance
 */
export async function loadModules(program) {
  // Modules directory path
  const modulesDir = path.join(__dirname, '..', 'modules');
  
  // Check if directory exists
  if (!fs.existsSync(modulesDir)) {
    console.error(chalk.red(`Modules directory not found: ${modulesDir}`));
    return;
  }
  
  // Read all module directories
  const moduleEntries = fs.readdirSync(modulesDir, { withFileTypes: true });
  
  // Filter for directories only
  const moduleDirs = moduleEntries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
    .map(entry => entry.name);
  
  // Load each module
  for (const moduleName of moduleDirs) {
    const moduleIndexPath = path.join(modulesDir, moduleName, 'index.js');
    
    // Check if module has an index.js file
    if (fs.existsSync(moduleIndexPath)) {
      try {
        // Dynamically import the module
        const module = await import(`../modules/${moduleName}/index.js`);
        if (typeof module.registerCommands === 'function') {
          module.registerCommands(program);
        } else {
          console.warn(chalk.yellow(`Module '${moduleName}' does not export a registerCommands function`));
        }
      } catch (err) {
        console.error(chalk.red(`Error loading module '${moduleName}':`, err));
      }
    }
  }
  
  // Add menu command
  program
    .command('menu')
    .description('Show interactive menu of available modules')
    .action(() => {
      showModuleMenu(program);
    });
}