import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logApi } from '../../utils/logger-suite/logger.js';
import { requireAuth, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { requireDeviceAuth } from '../../middleware/deviceAuth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the scripts directories (relative to this file)
const SHORTCUTS_DIR = path.join(__dirname, '../../scripts/shortcuts');
const MAIN_SCRIPTS_DIR = path.join(__dirname, '../../scripts');

// Ensure the shortcuts directory exists
if (!fs.existsSync(SHORTCUTS_DIR)) {
  fs.mkdirSync(SHORTCUTS_DIR, { recursive: true });
  logApi.info(`Created shortcuts scripts directory at ${SHORTCUTS_DIR}`);
}

/**
 * @swagger
 * /api/admin/scripts:
 *   get:
 *     summary: List available scripts
 *     tags: [Scripts]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: List of available scripts
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to list scripts
 */
router.get('/', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    // Get scripts from shortcuts directory
    const shortcutFiles = fs.readdirSync(SHORTCUTS_DIR)
      .filter(file => file.endsWith('.js') || file.endsWith('.sh'))
      .map(file => ({
        name: file,
        path: path.join(SHORTCUTS_DIR, file),
        type: file.endsWith('.js') ? 'javascript' : 'shell',
        category: 'shortcuts'
      }));
    
    // Get scripts from main scripts directory (excluding the shortcuts subdirectory)
    const mainScriptFiles = fs.readdirSync(MAIN_SCRIPTS_DIR)
      .filter(file => 
        (file.endsWith('.js') || file.endsWith('.sh')) && 
        !fs.lstatSync(path.join(MAIN_SCRIPTS_DIR, file)).isDirectory()
      )
      .map(file => ({
        name: file,
        path: path.join(MAIN_SCRIPTS_DIR, file),
        type: file.endsWith('.js') ? 'javascript' : 'shell',
        category: 'main'
      }));
    
    // Combine both lists
    const allScripts = [...shortcutFiles, ...mainScriptFiles];
    
    res.json({ scripts: allScripts });
  } catch (error) {
    logApi.error(`Error listing scripts: ${error.message}`);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

// Add a new middleware to check if the script requires device authentication
const checkScriptDeviceAuth = async (req, res, next) => {
    // List of scripts that require device authentication
    const scriptsRequiringDeviceAuth = [
        'restart-app.sh',
        'manage-logs.js',
        'server-status.js'
    ];
    
    const scriptName = req.params.scriptName;
    
    if (scriptsRequiringDeviceAuth.includes(scriptName)) {
        // This script requires device authentication
        return requireDeviceAuth(req, res, next);
    }
    
    // Script doesn't require device authentication
    next();
};

/**
 * @swagger
 * /api/admin/scripts/{scriptName}:
 *   post:
 *     summary: Execute a script
 *     tags: [Scripts]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: scriptName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the script to execute
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               params:
 *                 oneOf:
 *                   - type: object
 *                     description: Named parameters for JavaScript scripts (key-value pairs)
 *                   - type: array
 *                     description: Positional parameters for shell scripts
 *               category:
 *                 type: string
 *                 description: Script category (shortcuts or main)
 *                 default: shortcuts
 *     responses:
 *       200:
 *         description: Script execution result
 *       400:
 *         description: Invalid script name or unsupported script type
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Script not found
 *       500:
 *         description: Script execution failed
 */
router.post('/:scriptName', requireAuth, requireAdmin, checkScriptDeviceAuth, async (req, res) => {
  const { scriptName } = req.params;
  // Make 'shortcuts' the default category for backward compatibility
  const { params = [], category = 'shortcuts' } = req.body;
  
  // Validate script name to prevent directory traversal
  if (scriptName.includes('/') || scriptName.includes('\\')) {
    return res.status(400).json({ error: 'Invalid script name' });
  }
  
  // Determine script path based on category
  const scriptDir = category === 'main' ? MAIN_SCRIPTS_DIR : SHORTCUTS_DIR;
  const scriptPath = path.join(scriptDir, scriptName);
  
  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    // If script not found in the specified category, log a detailed error
    logApi.warn(`Script ${scriptName} not found in ${category} directory`);
    return res.status(404).json({ 
      error: 'Script not found',
      details: `Script ${scriptName} not found in ${category} directory`
    });
  }
  
  // Prepare command based on script type
  let command;
  if (scriptName.endsWith('.js')) {
    command = `node ${scriptPath}`;
  } else if (scriptName.endsWith('.sh')) {
    command = `bash ${scriptPath}`;
  } else {
    return res.status(400).json({ error: 'Unsupported script type' });
  }
  
  // Add parameters if provided
  if (params && (Array.isArray(params) ? params.length > 0 : Object.keys(params).length > 0)) {
    let paramString;
    
    // Check if params is an array (for shell scripts with positional params)
    if (Array.isArray(params)) {
      paramString = params.join(' ');
    } else {
      // For named parameters (used by JS scripts)
      paramString = Object.entries(params)
        .map(([key, value]) => `--${key}="${value}"`)
        .join(' ');
    }
    
    command += ` ${paramString}`;
  }
  
  logApi.info(`Executing script: ${command}`);
  
  // Execute the script
  exec(command, (error, stdout, stderr) => {
    if (error) {
      logApi.error(`Script execution error: ${error.message}`);
      return res.status(500).json({ 
        error: 'Script execution failed', 
        details: error.message,
        stderr 
      });
    }
    
    res.json({ 
      success: true, 
      output: stdout,
      stderr: stderr || null
    });
  });
});

export default router; 