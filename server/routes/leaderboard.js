import express from 'express';
import { getLeaderboard, addScore } from '../controllers/leaderboard.js';
import { validateScore, validateGetLeaderboard } from '../middleware/validation.js';

const router = express.Router();

router.get('/', validateGetLeaderboard, getLeaderboard);
router.post('/', validateScore, addScore);

export default router;