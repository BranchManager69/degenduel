-- Drop views first
DROP MATERIALIZED VIEW IF EXISTS contest_leaderboard CASCADE;
DROP VIEW IF EXISTS user_contest_summary CASCADE;
-- Drop triggers
DROP TRIGGER IF EXISTS check_portfolio_weight ON contest_portfolios CASCADE;
DROP TRIGGER IF EXISTS refresh_leaderboard_trigger ON contest_participants CASCADE;
DROP TRIGGER IF EXISTS contest_status_update ON contests CASCADE;
DROP TRIGGER IF EXISTS update_user_audit ON users CASCADE;
DROP TRIGGER IF EXISTS update_contest_audit ON contests CASCADE;
DROP TRIGGER IF EXISTS validate_portfolio_buckets ON contest_portfolios CASCADE;
-- Drop functions
DROP FUNCTION IF EXISTS update_audit_fields() CASCADE;
DROP FUNCTION IF EXISTS check_portfolio_total_weight() CASCADE;
DROP FUNCTION IF EXISTS update_contest_status() CASCADE;
DROP FUNCTION IF EXISTS validate_portfolio_buckets() CASCADE;
DROP FUNCTION IF EXISTS refresh_leaderboard() CASCADE;
-- Drop indexes first
DROP INDEX IF EXISTS idx_contest_portfolios_contest;
DROP INDEX IF EXISTS idx_contest_portfolios_wallet;
DROP INDEX IF EXISTS idx_transactions_wallet;
DROP INDEX IF EXISTS idx_transactions_contest;
DROP INDEX IF EXISTS idx_transactions_type_created;
DROP INDEX IF EXISTS idx_contest_participants_joined;
DROP INDEX IF EXISTS idx_contests_status_start;
DROP INDEX IF EXISTS idx_users_balance;
DROP INDEX IF EXISTS idx_tokens_symbol;
DROP INDEX IF EXISTS idx_tokens_active;
DROP INDEX IF EXISTS idx_token_prices_updated;
DROP INDEX IF EXISTS idx_token_bucket_memberships_token;
-- Drop tables in correct dependency order
DROP TABLE IF EXISTS contest_portfolios CASCADE;
DROP TABLE IF EXISTS contest_token_performance CASCADE;
DROP TABLE IF EXISTS contest_token_prices CASCADE;
DROP TABLE IF EXISTS token_bucket_memberships CASCADE;
DROP TABLE IF EXISTS token_buckets CASCADE;
DROP TABLE IF EXISTS token_prices CASCADE;
DROP TABLE IF EXISTS contest_participants CASCADE;
DROP TABLE IF EXISTS contests CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
-- Drop types
DROP TYPE IF EXISTS transaction_type CASCADE;
DROP TYPE IF EXISTS contest_status CASCADE;
DROP TYPE IF EXISTS transaction_status CASCADE;


-- Create types
CREATE TYPE transaction_type AS ENUM (
    'CONTEST_ENTRY',
    'PRIZE_PAYOUT',
    'DEPOSIT',
    'WITHDRAWAL',
    'REFERRAL_BONUS',
    'PROMOTION'
);
CREATE TYPE contest_status AS ENUM (
    'pending',
    'active',
    'completed',
    'cancelled'
);
CREATE TYPE transaction_status AS ENUM (
    'pending',
    'completed',
    'failed',
    'reversed'
);


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
-- Add columns to users table
ALTER TABLE users 
ADD COLUMN balance NUMERIC(20,0) DEFAULT 0 CHECK (balance >= 0),
ADD COLUMN is_banned BOOLEAN DEFAULT false,
ADD COLUMN ban_reason TEXT,
ADD COLUMN last_deposit_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN last_withdrawal_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN kyc_status TEXT,
ADD COLUMN risk_level INTEGER DEFAULT 0 CHECK (risk_level BETWEEN 0 AND 100),
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;

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
-- Add unique constraint for token symbols
ALTER TABLE tokens
ADD CONSTRAINT unique_token_symbol UNIQUE (symbol);
-- Add market data columns to tokens table
ALTER TABLE tokens
ADD COLUMN market_cap NUMERIC(20,0),
ADD COLUMN change_24h NUMERIC(5,2),
ADD COLUMN volume_24h NUMERIC(20,0);

-- Create contests table
CREATE TABLE IF NOT EXISTS contests (
    id SERIAL PRIMARY KEY,
    contest_code TEXT UNIQUE NOT NULL,  -- for my purposes, this is a contest's unique identifier
    name TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    entry_fee NUMERIC(20,0) DEFAULT 0,
    prize_pool NUMERIC(20,0) DEFAULT 0,
    status contest_status DEFAULT 'pending'::contest_status,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Add columns to contests table
ALTER TABLE contests 
ADD COLUMN current_prize_pool NUMERIC(20,0) DEFAULT 0,
ADD COLUMN allowed_buckets INTEGER[],
ADD COLUMN participant_count INTEGER DEFAULT 0 CHECK (participant_count >= 0),
ADD COLUMN last_entry_time TIMESTAMP WITH TIME ZONE,
ADD COLUMN min_participants INTEGER DEFAULT 2 CHECK (min_participants >= 2),
ADD COLUMN max_participants INTEGER,
ADD COLUMN entry_deadline TIMESTAMP WITH TIME ZONE,
ADD COLUMN cancelled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN cancellation_reason TEXT,
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;
-- Add constraints to contests table
ALTER TABLE contests
ADD CONSTRAINT valid_contest_dates CHECK (
    start_time < end_time 
    AND (entry_deadline IS NULL OR entry_deadline <= start_time)
),
ADD CONSTRAINT valid_participant_range CHECK (
    min_participants <= max_participants
),
ADD CONSTRAINT valid_contest_code CHECK (
    contest_code ~ '^[A-Z0-9-]{3,20}$'
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
    bucket_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_bucket_code CHECK (bucket_code ~ '^[A-Z0-9-]{2,20}$')
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

-- Create contest_portfolios table
CREATE TABLE IF NOT EXISTS contest_portfolios (
    contest_id INTEGER REFERENCES contests(id),
    wallet_address TEXT REFERENCES users(wallet_address),
    token_id INTEGER REFERENCES tokens(id),
    weight INTEGER NOT NULL CHECK (weight > 0),  -- Just ensure positive weights
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contest_id, wallet_address, token_id)
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT REFERENCES users(wallet_address),
    type transaction_type NOT NULL,
    amount NUMERIC(20,0) NOT NULL,
    balance_before NUMERIC(20,0) NOT NULL,
    balance_after NUMERIC(20,0) NOT NULL,
    contest_id INTEGER REFERENCES contests(id),
    description TEXT,
    status transaction_status DEFAULT 'completed'::transaction_status,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT valid_balance_change CHECK (balance_after >= 0),
    CONSTRAINT valid_amount CHECK (amount != 0)
);

-- Add columns related to transactions to contest_participants table
ALTER TABLE contest_participants 
ADD COLUMN entry_transaction_id INTEGER REFERENCES transactions(id),
ADD COLUMN entry_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN final_rank INTEGER,
ADD COLUMN prize_amount NUMERIC(20,0),
ADD COLUMN prize_paid_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN prize_transaction_id INTEGER REFERENCES transactions(id);

-- Add indexes for performance
CREATE INDEX idx_contest_portfolios_contest ON contest_portfolios(contest_id);
CREATE INDEX idx_contest_portfolios_wallet ON contest_portfolios(wallet_address);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX idx_transactions_contest ON transactions(contest_id);
CREATE INDEX idx_transactions_type_created ON transactions(type, created_at);
CREATE INDEX idx_contest_participants_joined ON contest_participants(joined_at);
CREATE INDEX idx_contests_code ON contests(contest_code);
CREATE INDEX idx_contests_status_start ON contests(status, start_time);
CREATE INDEX idx_users_balance ON users(balance);
CREATE INDEX idx_tokens_symbol ON tokens(symbol);
CREATE INDEX idx_tokens_active ON tokens(is_active) WHERE is_active = true;
CREATE INDEX idx_token_bucket_memberships_token ON token_bucket_memberships(token_id);

-- Add audit trigger function
CREATE OR REPLACE FUNCTION update_audit_fields()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add total weight constraint for portfolios
CREATE OR REPLACE FUNCTION check_portfolio_total_weight()
RETURNS TRIGGER AS $$
BEGIN
    IF (
        SELECT SUM(weight)
        FROM contest_portfolios
        WHERE contest_id = NEW.contest_id 
        AND wallet_address = NEW.wallet_address
    ) > 100 THEN
        RAISE EXCEPTION 'Total portfolio weight cannot exceed 100%%';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_portfolio_weight
    BEFORE INSERT OR UPDATE ON contest_portfolios
    FOR EACH ROW
    EXECUTE FUNCTION check_portfolio_total_weight();

-- Add index for token price queries
CREATE INDEX idx_token_prices_updated 
ON token_prices(updated_at DESC);

-- Function for updating contest status
CREATE OR REPLACE FUNCTION update_contest_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.start_time <= CURRENT_TIMESTAMP AND NEW.status = 'pending' THEN
        NEW.status := 'active';
    ELSIF NEW.end_time <= CURRENT_TIMESTAMP AND NEW.status = 'active' THEN
        NEW.status := 'completed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_portfolio_buckets()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if the NEW token is in any of the allowed buckets
    IF EXISTS (
        SELECT 1
        FROM token_bucket_memberships tbm
        WHERE tbm.token_id = NEW.token_id  -- Check NEW token
        AND tbm.bucket_id = ANY(
            SELECT unnest(allowed_buckets) 
            FROM contests 
            WHERE id = NEW.contest_id
        )
    ) THEN
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Token not in allowed buckets for this contest';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get a contest by its code
CREATE OR REPLACE FUNCTION get_contest_by_code(p_contest_code TEXT)
RETURNS contests AS $$
BEGIN
    RETURN (SELECT * FROM contests WHERE contest_code = p_contest_code);
END;
$$ LANGUAGE plpgsql;

-- Function to check if a contest code is valid
CREATE OR REPLACE FUNCTION is_valid_contest_code(p_contest_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM contests WHERE contest_code = p_contest_code);
END;
$$ LANGUAGE plpgsql;

-- Function to get a bucket by its code
CREATE OR REPLACE FUNCTION get_bucket_by_code(p_bucket_code TEXT)
RETURNS token_buckets AS $$
BEGIN
    RETURN (SELECT * FROM token_buckets WHERE bucket_code = p_bucket_code);
END;
$$ LANGUAGE plpgsql;

-- Function to refresh the leaderboard
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY contest_leaderboard;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for leaderboard refresh
CREATE TRIGGER refresh_leaderboard_trigger
    AFTER INSERT OR UPDATE ON contest_participants
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_leaderboard();

-- Add trigger for contest status update
CREATE TRIGGER contest_status_update
    BEFORE UPDATE ON contests
    FOR EACH ROW
    EXECUTE FUNCTION update_contest_status();

-- Add audit triggers
CREATE TRIGGER update_user_audit
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_audit_fields();
CREATE TRIGGER update_contest_audit
    BEFORE UPDATE ON contests
    FOR EACH ROW
    EXECUTE FUNCTION update_audit_fields();

-- Add trigger for portfolio bucket validation
CREATE TRIGGER validate_portfolio_buckets
    BEFORE INSERT OR UPDATE ON contest_portfolios
    FOR EACH ROW
    EXECUTE FUNCTION validate_portfolio_buckets();

-- Add helpful views
CREATE OR REPLACE VIEW user_contest_summary AS
SELECT 
    u.wallet_address,
    u.nickname,
    COUNT(cp.contest_id) as total_contests_entered,
    SUM(cp.prize_amount) as total_prizes_won,
    MAX(c.end_time) as last_contest_date,
    COUNT(CASE WHEN cp.final_rank = 1 THEN 1 END) as first_place_wins,
    -- Add these lines for contest details
    array_agg(c.contest_code ORDER BY c.end_time DESC) as recent_contests,
    array_agg(c.name ORDER BY c.end_time DESC) as recent_contest_names
FROM users u
LEFT JOIN contest_participants cp ON u.wallet_address = cp.wallet_address
LEFT JOIN contests c ON cp.contest_id = c.id
GROUP BY u.wallet_address, u.nickname;

-- Create materialized view for contest leaderboard
\echo 'About to create materialized view'
CREATE MATERIALIZED VIEW contest_leaderboard AS
SELECT 
    cp.contest_id,
    c.contest_code,
    cp.wallet_address,
    u.nickname,
    cp.current_balance,
    cp.rank,
    ROW_NUMBER() OVER (PARTITION BY cp.contest_id ORDER BY cp.current_balance DESC) as live_rank
FROM contest_participants cp
JOIN users u ON cp.wallet_address = u.wallet_address
JOIN contests c ON cp.contest_id = c.id
WITH DATA;
\echo 'Materialized view created'

-- Create indexes for the materialized view
\echo 'About to create indexes'
CREATE UNIQUE INDEX ON contest_leaderboard (contest_id, wallet_address);
CREATE INDEX idx_contest_leaderboard_balance ON contest_leaderboard(current_balance DESC);
-- Create index on token_buckets
CREATE INDEX idx_token_buckets_code ON token_buckets(bucket_code);
\echo 'Indexes created'
