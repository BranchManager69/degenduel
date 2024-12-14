import { body, query, validationResult } from 'express-validator';
import { VALIDATION } from '../config/constants.js';

const { NAME, LEADERBOARD } = VALIDATION;

export const validateScore = [
  body('name')
    .trim()
    .isLength({ min: NAME.MIN_LENGTH, max: NAME.MAX_LENGTH })
    .matches(NAME.PATTERN)
    .withMessage(`Name must be ${NAME.MIN_LENGTH}-${NAME.MAX_LENGTH} characters long and contain only letters, numbers, and underscores`),
  body('finalValue')
    .isFloat({ min: 0 })
    .withMessage('Final value must be a positive number'),
  body('returnPercentage')
    .isFloat()
    .withMessage('Return percentage must be a number'),
  
  validateRequest
];

export const validateGetLeaderboard = [
  query('limit')
    .optional()
    .isInt({ min: LEADERBOARD.MIN_LIMIT, max: LEADERBOARD.MAX_LIMIT })
    .withMessage(`Limit must be between ${LEADERBOARD.MIN_LIMIT} and ${LEADERBOARD.MAX_LIMIT}`),
    
  validateRequest
];

export const validateLeaderboardEntry = [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('finalValue').isFloat({ min: 0 }).withMessage('Final value must be a positive number'),
  body('returnPercentage').isFloat().withMessage('Return percentage must be a number'),
  body('bestToken').optional().isString().withMessage('Best token must be a string'),
  body('bestTokenReturn').optional().isFloat().withMessage('Best token return must be a number')
];

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array() 
    });
  }
  next();
}