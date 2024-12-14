import { LeaderboardModel } from '../models/leaderboard.js';
import logger from '../utils/logger.js';

export async function getLeaderboard(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const scores = await LeaderboardModel.getTopScores(limit);
    res.json(scores);
  } catch (error) {
    logger.error('Controller error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}

export async function addScore(req, res) {
  try {
    const result = await LeaderboardModel.addScore(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Controller error adding score:', error);
    res.status(500).json({ error: 'Failed to add score' });
  }
}