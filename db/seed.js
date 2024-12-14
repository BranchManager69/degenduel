import { pool } from '../server/config/pg-database.js';
import logger from '../utils/logger.js';

export async function seedData() {
  try {
    await pool.query(`
      INSERT INTO tokens (address, symbol, name) 
      VALUES 
        ('2ru7VX6NnaZ78znCtgGmYs2PdcAQRCr3UaPfRkDUpump', 'DUCK', 'Lemonade Stand Duck'),
        ('6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx', 'RETARDIO', 'RETARDIO')
      ON CONFLICT (address) DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO contests (name, description, start_time, end_time, status)
      VALUES (
        'Testo Contesto',
        'Secret event and you are not invited',
        NOW(),
        NOW() + INTERVAL '2 days',
        'active'
      )
      ON CONFLICT DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO users (wallet_address, nickname)
      VALUES ('0xTestWallet789', 'TestUser')
      ON CONFLICT (wallet_address) DO NOTHING;
    `);

    logger.info('Seed data inserted successfully');
  } catch (error) {
    logger.error('Error seeding data:', error);
    throw error;
  }
}
