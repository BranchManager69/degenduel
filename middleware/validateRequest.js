import { validationResult } from 'express-validator';
import { logApi } from '../utils/logger-suite/logger.js';

// Middleware to check for validation errors
export const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logApi.warn('Request validation failed:', {
            path: req.path,
            errors: errors.array()
        });
        return res.status(400).json({
            success: false,
            errors: errors.array(),
            message: 'Invalid request parameters'
        });
    }
    next();
}; 