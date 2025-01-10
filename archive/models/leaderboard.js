import { getDatabase } from '../../config/database.js';
import { logApi } from '../../utils/logger-suite/logger.js';

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
            logApi.error('Failed to fetch leaderboard:', err);
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
            logApi.error('Failed to add score:', err);
            reject(err);
            return;
          }
          resolve({ id: this.lastID });
        }
      );
    });
  }
}