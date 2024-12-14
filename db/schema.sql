-- Drop tables in correct dependency order (if necessary for reinitialization)
DROP TABLE IF EXISTS contest_token_performance CASCADE;
DROP TABLE IF EXISTS contest_token_prices CASCADE;
DROP TABLE IF EXISTS token_bucket_memberships CASCADE;
DROP TABLE IF EXISTS token_buckets CASCADE;
DROP TABLE IF EXISTS token_prices CASCADE;
DROP TABLE IF EXISTS contest_participants CASCADE;
DROP TABLE IF EXISTS contests CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
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

-- Create tokens table
CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER DEFAULT 18,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create contests table
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

-- Create token_prices table
CREATE TABLE IF NOT EXISTS token_prices (
    token_id INTEGER REFERENCES tokens(id) PRIMARY KEY,
    price NUMERIC(20,8) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create token_buckets table
CREATE TABLE IF NOT EXISTS token_buckets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create contest_participants table
CREATE TABLE IF NOT EXISTS contest_participants (
    contest_id INTEGER REFERENCES contests(id),
    wallet_address TEXT REFERENCES users(wallet_address),
    initial_balance NUMERIC(20,0) DEFAULT 1000000,
    current_balance NUMERIC(20,0) DEFAULT 1000000,
    rank INTEGER,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, wallet_address)
);

-- Create token_bucket_memberships table
CREATE TABLE IF NOT EXISTS token_bucket_memberships (
    bucket_id INTEGER REFERENCES token_buckets(id),
    token_id INTEGER REFERENCES tokens(id),
    PRIMARY KEY (bucket_id, token_id)
);

-- Create contest_token_prices table
CREATE TABLE IF NOT EXISTS contest_token_prices (
    contest_id INTEGER REFERENCES contests(id),
    wallet_address TEXT REFERENCES users(wallet_address),
    token_id INTEGER REFERENCES tokens(id),
    amount NUMERIC(20,0) DEFAULT 0,
    price NUMERIC(20,8) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, wallet_address, token_id, timestamp)
);

-- Create contest_token_performance table
CREATE TABLE IF NOT EXISTS contest_token_performance (
    contest_id INTEGER REFERENCES contests(id),
    wallet_address TEXT REFERENCES users(wallet_address),
    token_id INTEGER REFERENCES tokens(id),
    profit_loss NUMERIC(20,8) DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, wallet_address, token_id, timestamp)
);
