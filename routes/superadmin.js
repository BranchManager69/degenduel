// /routes/superadmin.js
import { exec } from 'child_process';
import express from 'express';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import logApi from '../utils/logger-suite/logger.js';

const LOG_FILES = [
  '/home/branchmanager/websites/degenduel/logs/api-error-0.log',
  '/home/branchmanager/websites/degenduel/logs/api-out-0.log',
  '/home/branchmanager/websites/degenduel/error.log',
  '/home/branchmanager/websites/degenduel/combined.log',
];

// Middleware to verify Superadmin token
const verifySuperadminToken = (req, res, next) => {
    const token = req.headers['x-superadmin-token'];
    
    if (!token) {
        logApi.warn('Superadmin access attempted without token');
        return res.status(401).json({
            error: 'Access Denied',
            message: 'No superadmin token provided'
        });
    }

    try {
        // Use the same secret that was used to generate the token
        ////const verified = jwt.verify(token, config.jwt.secret);
        const verified_superadmin = jwt.verify(token, config.jwt.superadmin_secret);
        
        if (!verified_superadmin.isSuperadmin) {
            logApi.warn('Non-superadmin token used for superadmin access');
            return res.status(403).json({
                error: 'Access Denied',
                message: 'Token is valid but lacks superadmin privileges'
            });
        }
        
        // Log successful superadmin access
        logApi.info(`Superadmin access granted for request to ${req.originalUrl}`);
        next();
    } catch (err) {
        logApi.error('Invalid superadmin token:', err);
        res.status(400).json({
            error: 'Invalid Token',
            message: 'The provided superadmin token is invalid or expired'
        });
    }
};

// Router
const router = express.Router();

// Generate superadmin token endpoint
router.post('/generate-superadmin-token', async (req, res) => {
    const { secretKey } = req.body;
    
    // Use a simple check for now
    if (secretKey !== '[REDACTED]') {
        return res.status(403).json({
            error: 'Invalid setup key'
        });
    }

    try {
        const token = jwt.sign(
            { 
                isSuperadmin: true,
                createdAt: new Date().toISOString()
            },
            config.jwt.secret,  // Use the main JWT secret
            { expiresIn: '1y' }
        );

        res.json({ token });
        
        // Log token generation
        logApi.info('New superadmin token generated');
    } catch (error) {
        logApi.error('Failed to generate superadmin token:', error);
        res.status(500).json({ error: 'Token generation failed' });
    }
});

// Novelty generate-tree endpoint
router.post('/generate-tree', verifySuperadminToken, (req, res) => {
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

// New logs endpoint
router.get('/logs', verifySuperadminToken, async (req, res) => {
    try {
        const filePath = req.query.file || '';
        
        // Validate the file path is one of the allowed log files
        if (!LOG_FILES.includes(filePath)) {
            return res.status(403).json({ 
                error: 'Access denied: Invalid log file path!'
            });
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Error reading log file:', error);
        res.status(500).json({ 
            error: 'Error reading log file',
            details: error.message 
        });
    }
});

export default router;