import { pool } from './pg-database.js';
import logger from './logger.js';
import { Users } from 'lucide-react';

export async function initTables() {
    try {
    // Drop existing tables in correct order
    await pool.query(`
        DROP TABLE IF EXISTS token_prices CASCADE;
        DROP TABLE IF EXISTS token_bucket_memberships CASCADE;
        DROP TABLE IF EXISTS token_buckets CASCADE;
        DROP TABLE IF EXISTS contest_token_prices CASCADE;
        DROP TABLE IF EXISTS contest_participants CASCADE;
        DROP TABLE IF EXISTS contests CASCADE;
        DROP TABLE IF EXISTS tokens CASCADE;
        DROP TABLE IF EXISTS users CASCADE;
      `);
    
      /* Create tables in correct dependency order:
          // 1. Independent tables first
                  - Users
                  - Tokens
                  - Contests
          // 2. Tables that depend on one table
                  - Token Prices
                  - Token Buckets
                  - Contest Participants
          // 3. Tables that have multiple dependencies
                  - Contest Token Prices
                  - Token Bucket Memberships
      */

      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            wallet_address TEXT PRIMARY KEY,
            nickname TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP WITH TIME ZONE,
            total_contests INTEGER DEFAULT 0,
            total_wins INTEGER DEFAULT 0,
            total_earnings NUMERIC(20,0) DEFAULT 0,
            rank_score INTEGER DEFAULT 1000,
            settings JSONB DEFAULT '{}'::jsonb
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS tokens (
          id SERIAL PRIMARY KEY,
          address TEXT NOT NULL UNIQUE,
          symbol TEXT NOT NULL,
          name TEXT NOT NULL,
          decimals INTEGER DEFAULT 18,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS contests (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            start_time TIMESTAMP WITH TIME ZONE,
            end_time TIMESTAMP WITH TIME ZONE,
            entry_fee NUMERIC(20,0) DEFAULT 0,
            prize_pool NUMERIC(20,0) DEFAULT 0,
            status TEXT DEFAULT 'pending',
            settings JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
        
      await pool.query(`
        CREATE TABLE IF NOT EXISTS token_prices (
          token_id INTEGER REFERENCES tokens(id) PRIMARY KEY,
          price NUMERIC(20,8) NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
  
      await pool.query(`
        CREATE TABLE IF NOT EXISTS token_buckets (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS contest_participants (
            contest_id INTEGER REFERENCES contests(id),
            wallet_address TEXT REFERENCES users(wallet_address),
            initial_balance NUMERIC(20,0) DEFAULT 1000000,
            current_balance NUMERIC(20,0) DEFAULT 1000000,
            rank INTEGER,
            joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (contest_id, wallet_address)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS token_bucket_memberships (
          bucket_id INTEGER REFERENCES token_buckets(id),
          token_id INTEGER REFERENCES tokens(id),
          PRIMARY KEY (bucket_id, token_id)
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS contest_token_prices (
            contest_id INTEGER REFERENCES contests(id),
            wallet_address TEXT REFERENCES users(wallet_address),
            token_id INTEGER REFERENCES tokens(id),
            amount NUMERIC(20,0) DEFAULT 0,
            price NUMERIC(20,8) NOT NULL,
            timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (contest_id, wallet_address, token_id, timestamp)
        );
      `);
  
      // Add after contest_token_prices table creation
      await pool.query(`
        CREATE TABLE IF NOT EXISTS contest_token_performance (
          contest_id INTEGER REFERENCES contests(id),
          wallet_address TEXT REFERENCES users(wallet_address),
          token_id INTEGER REFERENCES tokens(id),
          profit_loss NUMERIC(20,8) DEFAULT 0,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (contest_id, wallet_address, token_id, timestamp)
        );
      `);

      // Insert test tokens first
      await pool.query(`
        INSERT INTO tokens (address, symbol, name) 
        VALUES 
          ('2ru7VX6NnaZ78znCtgGmYs2PdcAQRCr3UaPfRkDUpump', 'DUCK', 'Lemonade Stand Duck'),
          ('6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx', 'RETARDIO', 'RETARDIO')
        ON CONFLICT (address) DO NOTHING
        RETURNING id;
      `);
  
      // Insert prices for Lemonade Stand Duck ($DUCK)
      await pool.query(`
        INSERT INTO token_prices (token_id, price)
        SELECT id, 69
        FROM tokens 
        WHERE symbol = 'DUCK'
        ON CONFLICT (token_id) DO UPDATE SET price = 69;
      `);
  
      // Insert prices for RETARDIO ($RETARDIO)
      await pool.query(`
        INSERT INTO token_prices (token_id, price)
        SELECT id, 420 
        FROM tokens 
        WHERE symbol = 'RETARDIO'
        ON CONFLICT (token_id) DO UPDATE SET price = 420;
      `);
  
      // Create bucket
      await pool.query(`
        INSERT INTO token_buckets (id, name, description)
        VALUES (1, 'Main Tokens', 'Primary trading tokens')
        ON CONFLICT (id) DO NOTHING;
      `);
  
      // Add tokens to bucket
      await pool.query(`
        INSERT INTO token_bucket_memberships (bucket_id, token_id)
        SELECT 1, id 
        FROM tokens
        ON CONFLICT DO NOTHING;
      `);

      // Insert test contest
      await pool.query(`
        -- Insert test contest
        INSERT INTO contests (name, description, start_time, end_time, status)
        VALUES (
          'Testo Contesto',
          'Secret event and you are not invited',
          NOW(),
          NOW() + INTERVAL '2 days',
          'active'
        )
        ON CONFLICT DO NOTHING;
      
        -- Insert test user
        INSERT INTO users (wallet_address, nickname)
        VALUES ('0xTestWallet789', 'TestUser')
        ON CONFLICT (wallet_address) DO NOTHING;
      
        -- Add test user to contest
        INSERT INTO contest_participants (contest_id, wallet_address)
        SELECT 
          (SELECT id FROM contests WHERE name = 'Testo Contesto'),
          '0xTestWallet789'
        ON CONFLICT DO NOTHING;
      `);


  
      logger.info('Database tables initialized successfully');
    } catch (error) {
      logger.error('Error initializing tables:', error);
      throw error;
    }
  }