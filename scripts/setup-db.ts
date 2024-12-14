import pg from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

console.log('Starting database setup...');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function setupDatabase() {
  try {
    console.log('Reading schema file...');
    const schemaPath = join(__dirname, '../migrations/001_initial_schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    console.log('Creating database tables...');
    await pool.query(schema);
    console.log('Tables created successfully');

    console.log('Adding initial data...');
    await seedDatabase();
    console.log('Initial data added successfully');

  } catch (error) {
    console.error('Error during setup:', error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log('Setup complete!');
  }
}

async function seedDatabase() {
  console.log('Adding token buckets...');
  await pool.query(`
    INSERT INTO token_buckets (name, description) VALUES
    ('High Cap', 'Top market cap tokens'),
    ('Mid Cap', 'Medium market cap tokens'),
    ('Low Cap', 'Low market cap tokens'),
    ('Meme', 'Popular meme tokens'),
    ('Zoo', 'Animal-themed tokens')
    ON CONFLICT DO NOTHING;
  `);

  console.log('Adding contest templates...');
  await pool.query(`
    INSERT INTO contest_templates (name, description, duration_minutes, entry_fee, bucket_requirements) VALUES
    ('Quick 1v1', '15-minute head-to-head battle', 15, 0.1, '{"High Cap": 1, "Mid Cap": 1, "Low Cap": 1}'),
    ('Hour Battle', '1-hour trading competition', 60, 0.25, '{"High Cap": 2, "Mid Cap": 2, "Meme": 1}'),
    ('Daily Duel', '24-hour trading showdown', 1440, 0.5, '{"High Cap": 2, "Mid Cap": 2, "Low Cap": 2, "Meme": 1}')
    ON CONFLICT DO NOTHING;
  `);
}

setupDatabase().catch(console.error);