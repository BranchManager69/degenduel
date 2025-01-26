// /routes/superadmin.js
import { exec } from 'child_process';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import logApi from '../utils/logger-suite/logger.js';

const LOG_DIR = path.join(process.cwd(), 'logs');

// Router
const router = express.Router();

// Get available log files (SUPERADMIN ONLY)
router.get('/logs/available', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(file => file.endsWith('.log'));
        const logFilesWithStats = await Promise.all(
            logFiles.map(async (file) => {
                const stats = await fs.stat(path.join(LOG_DIR, file));
                return {
                    name: file,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            })
        );
        res.json(logFilesWithStats);
    } catch (error) {
        logApi.error('Error reading log directory:', error);
        res.status(500).json({ 
            error: 'Error reading log directory',
            details: error.message 
        });
    }
});

// Get specific log file content (SUPERADMIN ONLY)
router.get('/logs/:filename', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(LOG_DIR, filename);
        
        // Validate the file path is within LOG_DIR
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(LOG_DIR))) {
            return res.status(403).json({ 
                error: 'Access denied: Invalid log file path!'
            });
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({
                error: 'Log file not found'
            });
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.json({ content });
    } catch (error) {
        logApi.error('Error reading log file:', error);
        res.status(500).json({ 
            error: 'Error reading log file',
            details: error.message 
        });
    }
});

// Novelty generate-tree endpoint (SUPERADMIN ONLY)
router.post('/generate-tree', requireAuth, requireSuperAdmin, (req, res) => {
    exec('/home/websites/degenduel/scripts/tree.sh', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ 
            message: 'Project tree generated successfully',
            output: stdout,
            timestamp: new Date().toISOString()
        });
    });
});

export default router;