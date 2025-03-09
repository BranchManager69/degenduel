import { logApi } from '../../utils/logger-suite/logger.js';
import { LeaderboardModel } from '../models/leaderboard.js';

export async function getLeaderboard(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const scores = await LeaderboardModel.getTopScores(limit);
    res.json(scores);
  } catch (error) {
    logApi.error('Controller error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}

export async function addScore(req, res) {
  try {
    const result = await LeaderboardModel.addScore(req.body);
    res.json(result);
  } catch (error) {
    logApi.error('Controller error adding score:', error);
    res.status(500).json({ error: 'Failed to add score' });
  }
}