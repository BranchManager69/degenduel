import { pool } from "../config/pg-database.js";

export async function createOrUpdateUser(walletAddress, nickname) {
  const result = await pool.query(`
    INSERT INTO users (
      wallet_address,
      nickname,
      rank_score,
      settings
    ) VALUES (
      $1, 
      $2,
      1000,
      '{}'::jsonb
    )
    ON CONFLICT (wallet_address) 
    DO UPDATE SET 
      last_login = CURRENT_TIMESTAMP,
      nickname = COALESCE($2, users.nickname)
    RETURNING *;
  `, [walletAddress, nickname || null]);

  return result.rows[0];
}

export async function getUserProfile(walletAddress) {
  const result = await pool.query(`
    SELECT * FROM users WHERE wallet_address = $1
  `, [walletAddress]);

  return result.rows[0] || null;
}

export async function updateUserStats(walletAddress, stats) {
  const result = await pool.query(`
    UPDATE users 
    SET 
      total_contests = total_contests + 1,
      total_wins = total_wins + $1,
      total_earnings = total_earnings + $2,
      rank_score = rank_score + $3
    WHERE wallet_address = $4
    RETURNING *;
  `, [
    stats.contest_result === 'win' ? 1 : 0,
    stats.contest_result === 'win' ? stats.won : 0,
    stats.contest_result === 'win' ? 10 : -5,
    walletAddress
  ]);

  return result.rows[0];
}

export async function updateUserSettings(walletAddress, settings) {
  const result = await pool.query(`
    UPDATE users 
    SET settings = settings || $1::jsonb
    WHERE wallet_address = $2
    RETURNING *;
  `, [JSON.stringify(settings), walletAddress]);

  return result.rows[0];
}
