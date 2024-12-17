import express from 'express';
import { exec } from 'child_process';
import jwt from 'jsonwebtoken';

// Middleware to verify Superadmin token
const verifySuperadminToken = (req, res, next) => {
    const token = req.headers['x-superadmin-token'];
    if (!token) return res.status(401).send('Access Denied');

    try {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        if (!verified.isSuperadmin) return res.status(403).send('Superadmin Access Required');
        next();
    } catch (err) {
        res.status(400).send('Invalid Token');
    }
};

// Router
const router = express.Router();

// Generate project tree endpoint
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

export default router;