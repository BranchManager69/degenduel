import { getDatabase } from '../config/database.js';
import logger from '../utils/logger.js';

export class LeaderboardModel {
  static async getTopScores(limit = 100) {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      db.all(
        `SELECT * FROM leaderboard 
         ORDER BY returnPercentage DESC 
         LIMIT ?`,
        [Math.min(limit, 100)],
        (err, rows) => {
          if (err) {
            logger.error('Failed to fetch leaderboard:', err);
            reject(err);
            return;
          }
          resolve(rows);
        }
      );
    });
  }

  static async addScore({ name, finalValue, returnPercentage, bestToken, bestTokenReturn }) {
    return new Promise((resolve, reject) => {
      const db = getDatabase();
      db.run(
        `INSERT INTO leaderboard (
          name, finalValue, returnPercentage, bestToken, bestTokenReturn, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [name, finalValue, returnPercentage, bestToken, bestTokenReturn, Date.now()],
        function(err) {
          if (err) {
            reject(err);
            return;
          }
          resolve({ id: this.lastID });
        }
      );
    });
  }
}