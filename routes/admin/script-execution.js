import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logApi } from '../../utils/logger-suite/logger.js';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the scripts directory (relative to this file)
const SCRIPTS_DIR = path.join(__dirname, '../../scripts/shortcuts');

// Ensure the shortcuts directory exists
if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  logApi.info(`Created shortcuts scripts directory at ${SCRIPTS_DIR}`);
}

/**
 * @swagger
 * /api/admin/scripts:
 *   get:
 *     summary: List available scripts
 *     tags: [Scripts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available scripts
 *       401:
 *         description: Unauthorized
 */
router.get('/', requireAuth, requireSuperAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(SCRIPTS_DIR)
      .filter(file => file.endsWith('.js') || file.endsWith('.sh'))
      .map(file => ({
        name: file,
        path: path.join(SCRIPTS_DIR, file),
        type: file.endsWith('.js') ? 'javascript' : 'shell'
      }));
    
    res.json({ scripts: files });
  } catch (error) {
    logApi.error(`Error listing scripts: ${error.message}`);
    res.status(500).json({ error: 'Failed to list scripts' });
  }
});

/**
 * @swagger
 * /api/admin/scripts/{scriptName}:
 *   post:
 *     summary: Execute a script
 *     tags: [Scripts]
 *     security:
 *       - bearerAuth: []
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
 *                 type: object
 *                 description: Parameters to pass to the script
 *     responses:
 *       200:
 *         description: Script execution result
 *       400:
 *         description: Invalid script name
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Script not found
 *       500:
 *         description: Script execution failed
 */
router.post('/:scriptName', requireAuth, requireSuperAdmin, (req, res) => {
  const { scriptName } = req.params;
  const { params = {} } = req.body;
  
  // Validate script name to prevent directory traversal
  if (scriptName.includes('/') || scriptName.includes('\\')) {
    return res.status(400).json({ error: 'Invalid script name' });
  }
  
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  
  // Check if script exists
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: 'Script not found' });
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
  if (Object.keys(params).length > 0) {
    const paramString = Object.entries(params)
      .map(([key, value]) => `--${key}="${value}"`)
      .join(' ');
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