-- Initial Schema for DegenDuel
-- Core Tables
CREATE TABLE users (
    wallet_address TEXT PRIMARY KEY,
    nickname TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP WITH TIME ZONE,
    total_contests INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    total_earnings DECIMAL DEFAULT 0,
    rank_score INTEGER DEFAULT 1000,
    settings JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE user_social_profiles (
    wallet_address TEXT REFERENCES users(wallet_address),
    platform TEXT NOT NULL,
    platform_user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    verified BOOLEAN DEFAULT false,
    verification_date TIMESTAMP WITH TIME ZONE,
    last_verified TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (wallet_address, platform),
    UNIQUE (platform, platform_user_id)
);

CREATE TABLE tokens (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE token_buckets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE token_bucket_memberships (
    token_address TEXT REFERENCES tokens(address),
    bucket_id INTEGER REFERENCES token_buckets(id),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_address, bucket_id)
);

-- Contest System
CREATE TABLE contest_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER,
    entry_fee DECIMAL DEFAULT 0,
    max_participants INTEGER DEFAULT 2,
    bucket_requirements JSONB,
    scoring_rules JSONB,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contests (
    id SERIAL PRIMARY KEY,
    template_id INTEGER REFERENCES contest_templates(id),
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'pending',
    prize_pool DECIMAL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_times CHECK (end_time > start_time)
);

CREATE TABLE contest_participants (
    id SERIAL PRIMARY KEY,
    contest_id INTEGER REFERENCES contests(id),
    wallet_address TEXT REFERENCES users(wallet_address),
    entry_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    lineup JSONB,
    current_score DECIMAL DEFAULT 0,
    final_rank INTEGER,
    prize_amount DECIMAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    UNIQUE (contest_id, wallet_address)
);

-- Price and Performance Tracking
CREATE TABLE token_prices (
    token_address TEXT REFERENCES tokens(address),
    timestamp TIMESTAMP WITH TIME ZONE,
    price DECIMAL,
    volume_24h DECIMAL,
    PRIMARY KEY (token_address, timestamp)
);

CREATE TABLE contest_token_performance (
    contest_id INTEGER REFERENCES contests(id),
    token_address TEXT REFERENCES tokens(address),
    start_price DECIMAL,
    end_price DECIMAL,
    performance_score DECIMAL,
    PRIMARY KEY (contest_id, token_address)
);

-- Financial Tracking
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT REFERENCES users(wallet_address),
    contest_id INTEGER REFERENCES contests(id),
    type TEXT,
    amount DECIMAL,
    status TEXT DEFAULT 'pending',
    tx_signature TEXT UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Stats and Achievements
CREATE TABLE user_stats (
    wallet_address TEXT PRIMARY KEY REFERENCES users(wallet_address),
    contests_entered INTEGER DEFAULT 0,
    contests_won INTEGER DEFAULT 0,
    total_prize_money DECIMAL DEFAULT 0,
    best_score DECIMAL,
    avg_score DECIMAL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_token_stats (
    wallet_address TEXT REFERENCES users(wallet_address),
    token_address TEXT REFERENCES tokens(address),
    times_picked INTEGER DEFAULT 0,
    wins_with_token INTEGER DEFAULT 0,
    avg_score_with_token DECIMAL,
    PRIMARY KEY (wallet_address, token_address)
);

CREATE TABLE user_achievements (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT REFERENCES users(wallet_address),
    achievement_type TEXT NOT NULL,
    value JSONB,
    achieved_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_contests_status ON contests(status);
CREATE INDEX idx_token_prices_recent ON token_prices(token_address, timestamp DESC);
CREATE INDEX idx_participants_wallet ON contest_participants(wallet_address);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_address);
CREATE INDEX idx_user_social_profiles_platform ON user_social_profiles(platform, platform_user_id);
