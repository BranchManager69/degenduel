// /routes/status.js

import express from 'express';
import prisma from '../config/prisma.js';

const router = express.Router();

/**
 * @route GET /api/status
 * @description Public endpoint to check system operational status (maintenance mode)
 * @access Public
 */
router.get('/', async (req, res) => {
    try {
        const setting = await prisma.system_settings.findUnique({
            where: { key: 'maintenance_mode' }
        });

        if (setting?.value?.enabled) {
            return res.status(503).json({
                maintenance: true,
                message: "System is under maintenance"
            });
        }

        return res.status(200).json({
            maintenance: false
        });
    } catch (error) {
        // If we can't check maintenance status, assume system is not operational
        return res.status(503).json({
            maintenance: true,
            message: "Unable to determine system status"
        });
    }
});

export default router; 