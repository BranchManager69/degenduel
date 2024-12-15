-- Clean existing data
TRUNCATE TABLE contest_token_performance CASCADE;
TRUNCATE TABLE contest_token_prices CASCADE;
TRUNCATE TABLE token_bucket_memberships CASCADE;
TRUNCATE TABLE token_buckets CASCADE;
TRUNCATE TABLE contest_participants CASCADE;
TRUNCATE TABLE contests CASCADE;
TRUNCATE TABLE tokens CASCADE;
TRUNCATE TABLE users CASCADE;

-- Insert Users
INSERT INTO users (wallet_address, nickname, created_at, total_contests, total_wins) VALUES
('BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', 'branchManager', NOW() - INTERVAL '90 days', 33, 32),
('GayGuy2222222222222222222222222222222', 'gayGuy', NOW() - INTERVAL '30 days', 10, 4),
('GigaChad33333333333333333333333333333', 'gigaChad', NOW() - INTERVAL '15 days', 3, 1),
('BasedDev44444444444444444444444444444', 'basedDev', NOW() - INTERVAL '5 days', 7, 3),
('ExitLiq555555555555555555555555555555', 'exitLiq', NOW() - INTERVAL '2 days', 1, 0);

-- Insert Tokens
INSERT INTO tokens (address, symbol, name, decimals) VALUES
('So11111111111111111111111111111111111111111', 'SOL', 'Solana', 9),
('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 'USD Coin', 6),
('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK', 'Bonk', 5),
('6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx', 'RETARDIO', 'RETARDIO', 8),
('CfgmB9iTWABdYh3CHQQDUGtWy18rMNAEEqyp4GrJpump', 'ASS', 'WE LOVE ASS', 8),
('23CTZMjEYNNZUE4itfn3iv6kgM4xn7X7dx1kVX1Gr8Xi', 'TITS', 'We Love Tits', 8),
('8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn', 'ZEREBRO', 'zerebro', 8),
('CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump', 'GOAT', 'Goatseus Maximus', 8),
('HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC', 'ai16z', 'ai16z', 8),
('8wXtPeU6557ETkp9WHFY1n1EcU6NxDvbAggHGsMYiHsB', 'GME', 'GameStop', 8),
('DoxsC4PpVHiUxCKYeKSkPXVVVSJYzidZZJxW4XCFF2t', 'BONKFA', 'Bonk of America', 9),
('8stssUiCFbcB2LqCS62EuU2x1K2NWbJJo1YPgskpftWK', 'PRINT', 'Print Protocol', 8),
('5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump', 'SIGMA', 'SIGMA', 8),
('Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump', 'CHILLGUY', 'Just a chill guy', 8),
('ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', 'MOODENG', 'Moo Deng', 8),
('2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', 'Pnut', 'Peanut the Squirrel', 8),
('CNvitvFnSM5ed6K28RUNSaAjqqz5tX1rA5HgaBN9pump', 'FRED', 'First Convicted RACCON', 8),
('CBdCxKo9QavR9hfShgpEBG3zekorAeD7W1jfq2o3pump', 'LUCE', 'Official Mascot of the Holy Year', 8),
('fAkEg23YS8cfNCBbZx7GTxQWvJmzAiDwTeDxxxGOAT', 'FLOAT', 'Floatseus Faximus', 8),
('fAkEa8LiCf2MVoYZNp9LWJbxJq3N12xxAnimals', 'LOVEDUX', 'Duck Lovers Anonymous', 8),
('fAkEsUiCFbcB2LqCS62EuU2x1K2NWbJJo1xxxAnimals', 'PLATRICK', 'Platrick the Trans Platypus', 8),
('fAkEs7gyqzLk2DjEcbN6dXJx1A7nwB3HpXxxBlueChips', 'BLUECOIN', 'Seriously Amazing Coin', 8),
('fAkEsk2DjEcbN6dXJx1A7nwB3H7gyqzLXxxBranchBags', 'PIGSKIN', 'Peppa Pigskin', 8),
('fAkEZuNxMKLJo9YRxJbpW62xxCabal', 'ILLBUCKS', 'Currency of the Illuminati', 8),
('fAkEGswNMK8LyzDzMv6KNR12xJo9wwxxCabal', 'KABAL', 'Bundled Cabal Heist', 8),
('fAkEaMZKLY9JoBCWRXNpJ12xxDAO', 'MYLEG', 'DAO My Leg', 8),
('fAkENMpZJL9YRWCXBKo12xxGenZ', 'ZOOM', 'Zoomer Coin', 8),
('fAkEYZWJbRKoL9CMXpN12xxLowCapGems', 'LOKAP', 'Lokap Shidder', 8),
('fAkEZWMK9RJoCYLBpNxJ12xxMemeTokens', 'MEMARS', 'Mars Memes', 8),
('fAkEWBNpZM9LJoCYRKWxJ12xxStablecoins', 'fUSD', 'fakeUSD', 8),
('fAkEYpKMJoLBWNZxJCR12xxTikTok', 'DIKDOK', 'DikDok Token', 8),
('fAkEWJZoBp9LRYXCMNK12xxUtility', 'iBUYuTIL', 'I Buy You Tility', 8),
('fAkEYKMJoLpWNxBCR9XZ12xxWashedUp', 'WHAT', 'That One Coin You Forgot About', 8);

-- Insert Token Prices
INSERT INTO token_prices (token_id, price) VALUES
((SELECT id FROM tokens WHERE symbol = 'SOL'), 223.50),
((SELECT id FROM tokens WHERE symbol = 'USDC'), 1.00),
((SELECT id FROM tokens WHERE symbol = 'BONK'), 0.15),
((SELECT id FROM tokens WHERE symbol = 'RETARDIO'), 0.09),
((SELECT id FROM tokens WHERE symbol = 'ASS'), 0.03),
((SELECT id FROM tokens WHERE symbol = 'TITS'), 0.45),
((SELECT id FROM tokens WHERE symbol = 'ZEREBRO'), 0.42),
((SELECT id FROM tokens WHERE symbol = 'GOAT'), 0.85),
((SELECT id FROM tokens WHERE symbol = 'ai16z'), 0.94),
((SELECT id FROM tokens WHERE symbol = 'GME'), 0.03),
((SELECT id FROM tokens WHERE symbol = 'BONKFA'), 0.02),
((SELECT id FROM tokens WHERE symbol = 'PRINT'), 0.01),
((SELECT id FROM tokens WHERE symbol = 'SIGMA'), 0.75),
((SELECT id FROM tokens WHERE symbol = 'CHILLGUY'), 0.41),
((SELECT id FROM tokens WHERE symbol = 'MOODENG'), 0.76),
((SELECT id FROM tokens WHERE symbol = 'Pnut'), 1.02),
((SELECT id FROM tokens WHERE symbol = 'FRED'), 0.21),
((SELECT id FROM tokens WHERE symbol = 'LUCE'), 0.55),
((SELECT id FROM tokens WHERE symbol = 'FLOAT'), 0.01),
((SELECT id FROM tokens WHERE symbol = 'LOVEDUX'), 0.02),
((SELECT id FROM tokens WHERE symbol = 'PLATRICK'), 0.03),
((SELECT id FROM tokens WHERE symbol = 'BLUECOIN'), 0.04),
((SELECT id FROM tokens WHERE symbol = 'PIGSKIN'), 0.05),
((SELECT id FROM tokens WHERE symbol = 'ILLBUCKS'), 0.06),
((SELECT id FROM tokens WHERE symbol = 'KABAL'), 0.07),
((SELECT id FROM tokens WHERE symbol = 'MYLEG'), 0.08),
((SELECT id FROM tokens WHERE symbol = 'ZOOM'), 0.09),
((SELECT id FROM tokens WHERE symbol = 'LOKAP'), 0.10),
((SELECT id FROM tokens WHERE symbol = 'MEMARS'), 0.11),
((SELECT id FROM tokens WHERE symbol = 'fUSD'), 0.12),
((SELECT id FROM tokens WHERE symbol = 'DIKDOK'), 0.13),
((SELECT id FROM tokens WHERE symbol = 'iBUYuTIL'), 0.14),
((SELECT id FROM tokens WHERE symbol = 'WHAT'), 0.15);

-- Insert Contests
INSERT INTO contests (contest_code, name, description, start_time, end_time, entry_fee, prize_pool, status, settings) VALUES
('ANCIENT-001', 'Ancient History Contest', 'A relic of a contest completed long ago.', 
    '1994-10-03T00:00:00Z', '1994-10-04T23:59:59Z', ***REMOVED***, 1004, 'completed', '{"max_participants": 14}'),
('XMAS-2024', 'Bah Humbug Contest', 'A miserable December contest for the Scrooges who like to buy shitcoins on Christmas.', 
    NOW() - INTERVAL '3 days', NOW() + INTERVAL '2 days', 420, 1069, 'active', '{"max_participants": 69}'),
('NYE-2025', 'Happy New Year Contest', 'A future contest to celebrate the arrival of 2025.', 
    NOW() + INTERVAL '5 days', NOW() + INTERVAL '10 days', 100, 1000, 'pending', '{"max_participants": 20}');

-- Insert Participants to Contests
INSERT INTO contest_participants (contest_id, wallet_address) VALUES
((SELECT id FROM contests WHERE contest_code = 'ANCIENT-001'), 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 'GayGuy2222222222222222222222222222222'),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 'GigaChad33333333333333333333333333333'),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 'BasedDev44444444444444444444444444444'),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 'ExitLiq555555555555555555555555555555');

-- Insert token buckets
INSERT INTO token_buckets (bucket_code, name, description) VALUES
('AI', 'AI', 'Just AI tokens.'),
('ANIMALS', 'Animals', 'Just animal tokens.'),
('BLUE-CHIPS', 'Blue Chips', 'Just $100M+ market cap tokens.'),
('BRANCH-BAGS', 'Branch Bags', 'Just tokens Branch Manager likes subjectively.'),
('CABAL', 'Cabal', 'Just cabal tokens.'),
('DAO', 'DAO', 'Just decentralized autonomous organization tokens.'),
('GEN-Z', 'Gen Z', 'Just Gen Z tokens.'),
('LOW-CAP', 'Low Cap Gems', 'Just sub-$1M market cap tokens.'),
('MEME', 'Meme Tokens', 'A bucket of meme tokens like BONK.'),
('STABLE', 'Stablecoins', 'A collection of stablecoins for safe trading.'),
('TIKTOK', 'Tik-Tok', 'Just Tik-Tok tokens.'),
('UTILITY', 'Utility', 'Just utility and governance tokens.'),
('WASHED', 'Washed-Up', 'Just washed-up has-been tokens.');

-- Assign tokens to buckets
INSERT INTO token_bucket_memberships (bucket_id, token_id) VALUES
((SELECT id FROM token_buckets WHERE bucket_code = 'AI'), (SELECT id FROM tokens WHERE symbol = 'GOAT')),
((SELECT id FROM token_buckets WHERE bucket_code = 'BLUE-CHIPS'), (SELECT id FROM tokens WHERE symbol = 'SOL')),
((SELECT id FROM token_buckets WHERE bucket_code = 'STABLE'), (SELECT id FROM tokens WHERE symbol = 'USDC')),
((SELECT id FROM token_buckets WHERE bucket_code = 'ANIMALS'), (SELECT id FROM tokens WHERE symbol = 'Pnut')),
((SELECT id FROM token_buckets WHERE bucket_code = 'BRANCH-BAGS'), (SELECT id FROM tokens WHERE symbol = 'BONKFA')),
((SELECT id FROM token_buckets WHERE bucket_code = 'UTILITY'), (SELECT id FROM tokens WHERE symbol = 'PRINT')),
((SELECT id FROM token_buckets WHERE bucket_code = 'ANIMALS'), (SELECT id FROM tokens WHERE symbol = 'PLATRICK')),
((SELECT id FROM token_buckets WHERE bucket_code = 'BLUE-CHIPS'), (SELECT id FROM tokens WHERE symbol = 'BLUECOIN')),
((SELECT id FROM token_buckets WHERE bucket_code = 'BRANCH-BAGS'), (SELECT id FROM tokens WHERE symbol = 'PIGSKIN')),
((SELECT id FROM token_buckets WHERE bucket_code = 'CABAL'), (SELECT id FROM tokens WHERE symbol = 'KABAL')),
((SELECT id FROM token_buckets WHERE bucket_code = 'DAO'), (SELECT id FROM tokens WHERE symbol = 'MYLEG')),
((SELECT id FROM token_buckets WHERE bucket_code = 'GEN-Z'), (SELECT id FROM tokens WHERE symbol = 'ZOOM')),
((SELECT id FROM token_buckets WHERE bucket_code = 'LOW-CAP'), (SELECT id FROM tokens WHERE symbol = 'LOKAP')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'MEMARS')),
((SELECT id FROM token_buckets WHERE bucket_code = 'STABLE'), (SELECT id FROM tokens WHERE symbol = 'fUSD')),
((SELECT id FROM token_buckets WHERE bucket_code = 'TIKTOK'), (SELECT id FROM tokens WHERE symbol = 'DIKDOK')),
((SELECT id FROM token_buckets WHERE bucket_code = 'UTILITY'), (SELECT id FROM tokens WHERE symbol = 'iBUYuTIL')),
((SELECT id FROM token_buckets WHERE bucket_code = 'WASHED'), (SELECT id FROM tokens WHERE symbol = 'WHAT')),
-- AI Tokens
((SELECT id FROM token_buckets WHERE bucket_code = 'AI'), (SELECT id FROM tokens WHERE symbol = 'ai16z')),
((SELECT id FROM token_buckets WHERE bucket_code = 'AI'), (SELECT id FROM tokens WHERE symbol = 'ZEREBRO')),

-- Animal Tokens (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'ANIMALS'), (SELECT id FROM tokens WHERE symbol = 'LOVEDUX')),
((SELECT id FROM token_buckets WHERE bucket_code = 'ANIMALS'), (SELECT id FROM tokens WHERE symbol = 'FRED')),

-- Blue Chips (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'BLUE-CHIPS'), (SELECT id FROM tokens WHERE symbol = 'GME')),

-- Branch Bags (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'BRANCH-BAGS'), (SELECT id FROM tokens WHERE symbol = 'BONK')),
((SELECT id FROM token_buckets WHERE bucket_code = 'BRANCH-BAGS'), (SELECT id FROM tokens WHERE symbol = 'MOODENG')),

-- Meme Tokens
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'BONK')), -- Also in Branch Bags
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'ASS')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'TITS')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'RETARDIO')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'CHILLGUY')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'FLOAT')),
((SELECT id FROM token_buckets WHERE bucket_code = 'MEME'), (SELECT id FROM tokens WHERE symbol = 'LUCE')),

-- Gen Z Tokens (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'GEN-Z'), (SELECT id FROM tokens WHERE symbol = 'TITS')), -- Also in Meme
((SELECT id FROM token_buckets WHERE bucket_code = 'GEN-Z'), (SELECT id FROM tokens WHERE symbol = 'ASS')),  -- Also in Meme

-- Low Cap Gems (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'LOW-CAP'), (SELECT id FROM tokens WHERE symbol = 'RETARDIO')), -- Also in Meme
((SELECT id FROM token_buckets WHERE bucket_code = 'LOW-CAP'), (SELECT id FROM tokens WHERE symbol = 'CHILLGUY')), -- Also in Meme

-- Utility Tokens (some already assigned)
((SELECT id FROM token_buckets WHERE bucket_code = 'UTILITY'), (SELECT id FROM tokens WHERE symbol = 'SIGMA')),
((SELECT id FROM token_buckets WHERE bucket_code = 'UTILITY'), (SELECT id FROM tokens WHERE symbol = 'ZEREBRO')); -- Also in AI


-- Update contests with allowed buckets
UPDATE contests 
SET allowed_buckets = ARRAY(
    SELECT id FROM token_buckets 
    WHERE bucket_code IN ('AI', 'ANIMALS', 'BLUE-CHIPS', 'BRANCH-BAGS', 'CABAL', 
                         'DAO', 'GEN-Z', 'LOW-CAP', 'MEME', 'STABLE', 
                         'TIKTOK', 'UTILITY', 'WASHED')
)
WHERE contest_code IN ('ANCIENT-001', 'XMAS-2024', 'NYE-2025');

-- Insert Contest Portfolios
INSERT INTO contest_portfolios (contest_id, wallet_address, token_id, weight) VALUES
-- For Ancient History Contest (completed)
((SELECT id FROM contests WHERE contest_code = 'ANCIENT-001'),
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
 (SELECT id FROM tokens WHERE symbol = 'SOL'),
 50),
((SELECT id FROM contests WHERE contest_code = 'ANCIENT-001'),
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
 (SELECT id FROM tokens WHERE symbol = 'BONK'),
 50),
-- For Bah Humbug Contest (active)
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
 (SELECT id FROM tokens WHERE symbol = 'GOAT'),
 40),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
 (SELECT id FROM tokens WHERE symbol = 'USDC'),
 60),
-- For Happy New Year Contest (pending)
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'GayGuy2222222222222222222222222222222',
 (SELECT id FROM tokens WHERE symbol = 'BONK'),
 30),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'GayGuy2222222222222222222222222222222',
 (SELECT id FROM tokens WHERE symbol = 'USDC'),
 70),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'GigaChad33333333333333333333333333333',
 (SELECT id FROM tokens WHERE symbol = 'Pnut'),
 51),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'GigaChad33333333333333333333333333333',
 (SELECT id FROM tokens WHERE symbol = 'LUCE'),
 49),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'BasedDev44444444444444444444444444444',
 (SELECT id FROM tokens WHERE symbol = 'CHILLGUY'),
 69),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'BasedDev44444444444444444444444444444',
 (SELECT id FROM tokens WHERE symbol = 'SIGMA'),
 31),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'ExitLiq555555555555555555555555555555',
 (SELECT id FROM tokens WHERE symbol = 'RETARDIO'),
 95),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'),
 'ExitLiq555555555555555555555555555555',
 (SELECT id FROM tokens WHERE symbol = 'SOL'),
 5);



-- TESTING EVERYTHING BELOW THIS LINE.



-- Insert Contest Token Prices
INSERT INTO contest_token_prices (contest_id, wallet_address, token_id, amount, price) VALUES
((SELECT id FROM contests WHERE contest_code = 'ANCIENT-001'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'BONKFA'), 1000, 0.05),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'GOAT'), 10, 0.51),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'GayGuy2222222222222222222222222222222', (SELECT id FROM tokens WHERE symbol = 'USDC'), 500, 1.00),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'GigaChad33333333333333333333333333333', (SELECT id FROM tokens WHERE symbol = 'BONK'), 1000, 0.01);

-- Insert Contest Token Performance
INSERT INTO contest_token_performance (contest_id, wallet_address, token_id, profit_loss) VALUES
((SELECT id FROM contests WHERE contest_code = 'ANCIENT-001'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'BONKFA'), 4.20),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'GOAT'), 0.69),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'GayGuy2222222222222222222222222222222', (SELECT id FROM tokens WHERE symbol = 'USDC'), 0.05),
((SELECT id FROM contests WHERE contest_code = 'XMAS-2024'), 
 'GigaChad33333333333333333333333333333', (SELECT id FROM tokens WHERE symbol = 'BONK'), -0.02);




-- NOW *REALLY* TESTING EVERYTHING BELOW THIS LINE.



-- Update contests with proper settings
UPDATE contests SET 
settings = jsonb_build_object(
    'difficulty', CASE id % 6
        WHEN 0 THEN 'guppy'
        WHEN 1 THEN 'tadpole'
        WHEN 2 THEN 'squid'
        WHEN 3 THEN 'dolphin'
        WHEN 4 THEN 'shark'
        ELSE 'whale'
    END,
    'min_trades', CASE id % 6
        WHEN 0 THEN 3  -- Guppy: Beginner friendly
        WHEN 1 THEN 5  -- Tadpole: Still easy
        WHEN 2 THEN 10 -- Squid: Getting harder
        WHEN 3 THEN 15 -- Dolphin: Intermediate
        WHEN 4 THEN 25 -- Shark: Professional
        ELSE 40        -- Whale: Expert level
    END,
    'max_participants', CASE id % 6
        WHEN 0 THEN 50    -- Guppy: Small pools
        WHEN 1 THEN 100   -- Tadpole: Growing
        WHEN 2 THEN 200   -- Squid: Medium
        WHEN 3 THEN 500   -- Dolphin: Large
        WHEN 4 THEN 1000  -- Shark: Very large
        ELSE 2000         -- Whale: Massive pools
    END,
    'rules', ARRAY[
        'No wash trading',
        'Must use allowed tokens only',
        'Portfolio must remain balanced',
        'Minimum holding period: 1 hour',
        CASE id % 6
            WHEN 0 THEN 'Max 3 tokens per portfolio'
            WHEN 1 THEN 'Max 4 tokens per portfolio'
            WHEN 2 THEN 'Max 5 tokens per portfolio'
            WHEN 3 THEN 'Max 6 tokens per portfolio'
            WHEN 4 THEN 'Max 8 tokens per portfolio'
            ELSE 'Max 10 tokens per portfolio'
        END
    ],
    'token_types', CASE id % 4
        WHEN 0 THEN ARRAY['meme', 'defi']
        WHEN 1 THEN ARRAY['defi', 'gaming']
        WHEN 2 THEN ARRAY['meme', 'gaming', 'defi']
        ELSE ARRAY['meme', 'defi', 'gaming', 'nft']
    END,
    'min_participants', CASE id % 6
        WHEN 0 THEN 10
        WHEN 1 THEN 20
        WHEN 2 THEN 30
        WHEN 3 THEN 50
        WHEN 4 THEN 100
        ELSE 200
    END,
    'entry_deadline', NOW() + INTERVAL '1 day'
);

-- Update users with more detailed settings
UPDATE users SET
settings = jsonb_build_object(
    'preferred_difficulty', CASE nickname
        WHEN 'branchManager' THEN 'whale'
        WHEN 'gayGuy' THEN 'dolphin'
        WHEN 'gigaChad' THEN 'shark'
        WHEN 'basedDev' THEN 'squid'
        ELSE 'guppy'
    END,
    'notification_preferences', jsonb_build_object(
        'email', true,
        'discord', true,
        'telegram', false,
        'push', true,
        'contest_start', true,
        'contest_end', true,
        'portfolio_alerts', true
    ),
    'display_preferences', jsonb_build_object(
        'dark_mode', true,
        'compact_view', false,
        'show_24h_change', true,
        'default_sort', 'market_cap',
        'favorite_buckets', ARRAY[1, 2, 3]
    ),
    'trading_preferences', jsonb_build_object(
        'default_slippage', '1.0',
        'auto_rebalance', false,
        'preferred_buckets', ARRAY['meme', 'defi']
    ),
    'is_admin', nickname = 'branchManager'
);

-- Update tokens with more realistic market data
UPDATE tokens SET
market_cap = CASE 
    WHEN symbol IN ('SOL', 'USDC') THEN 
        random() * 50000000000 + 10000000000  -- $10B to $60B
    WHEN symbol IN ('BONK', 'GOAT') THEN 
        random() * 900000000 + 100000000      -- $100M to $1B
    ELSE 
        random() * 90000000 + 10000000        -- $10M to $100M
END,
change_24h = CASE
    WHEN symbol = 'USDC' THEN random() * 0.1 - 0.05  -- Stablecoin: -0.05% to +0.05%
    ELSE random() * 40 - 20                          -- Others: -20% to +20%
END,
volume_24h = CASE
    WHEN symbol IN ('SOL', 'USDC') THEN 
        random() * 900000000 + 100000000      -- $100M to $1B
    WHEN symbol IN ('BONK', 'GOAT') THEN 
        random() * 9000000 + 1000000          -- $1M to $10M
    ELSE 
        random() * 900000 + 100000            -- $100K to $1M
END;


-- Update user balances with realistic values and related fields
UPDATE users SET
    balance = CASE nickname
        WHEN 'branchManager' THEN 1000000000  -- $1,000,000 (whale)
        WHEN 'gayGuy' THEN 250000000         -- $250,000 (dolphin)
        WHEN 'gigaChad' THEN 500000000       -- $500,000 (shark)
        WHEN 'basedDev' THEN 100000000       -- $100,000 (squid)
        WHEN 'exitLiq' THEN 10000000         -- $10,000 (guppy)
    END,
    is_banned = false,
    kyc_status = CASE nickname
        WHEN 'branchManager' THEN 'verified'
        WHEN 'gayGuy' THEN 'verified'
        WHEN 'gigaChad' THEN 'pending'
        WHEN 'basedDev' THEN 'verified'
        WHEN 'exitLiq' THEN 'not_submitted'
    END,
    risk_level = CASE nickname
        WHEN 'branchManager' THEN 10  -- Trusted admin
        WHEN 'gayGuy' THEN 20
        WHEN 'gigaChad' THEN 30
        WHEN 'basedDev' THEN 15
        WHEN 'exitLiq' THEN 75       -- High risk due to name!
    END,
    last_deposit_at = CASE nickname
        WHEN 'branchManager' THEN NOW() - INTERVAL '1 day'
        WHEN 'gayGuy' THEN NOW() - INTERVAL '5 days'
        WHEN 'gigaChad' THEN NOW() - INTERVAL '2 days'
        WHEN 'basedDev' THEN NOW() - INTERVAL '7 days'
        WHEN 'exitLiq' THEN NOW() - INTERVAL '1 hour'  -- Sus...
    END,
    last_withdrawal_at = CASE nickname
        WHEN 'branchManager' THEN NOW() - INTERVAL '10 days'
        WHEN 'gayGuy' THEN NOW() - INTERVAL '15 days'
        WHEN 'gigaChad' THEN NOW() - INTERVAL '5 days'
        WHEN 'basedDev' THEN NOW() - INTERVAL '30 days'
        WHEN 'exitLiq' THEN NULL  -- Never withdrawn...
    END;

-- Add some sample transactions
INSERT INTO transactions (wallet_address, type, amount, balance_before, balance_after, status, description, created_at) VALUES
-- branchManager's transactions
('BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', 'DEPOSIT', 500000000, 500000000, 1000000000, 'completed', 'Initial deposit', NOW() - INTERVAL '1 day'),
('BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', 'CONTEST_ENTRY', 10000000, 1000000000, 990000000, 'completed', 'Entry to Whale Contest #1', NOW() - INTERVAL '12 hours'),
('BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', 'PRIZE_PAYOUT', 50000000, 990000000, 1040000000, 'completed', 'Winner of Shark Contest #5', NOW() - INTERVAL '5 days'),

-- gayGuy's transactions
('GayGuy2222222222222222222222222222222', 'DEPOSIT', 250000000, 0, 250000000, 'completed', 'Initial deposit', NOW() - INTERVAL '5 days'),
('GayGuy2222222222222222222222222222222', 'CONTEST_ENTRY', 5000000, 250000000, 245000000, 'completed', 'Entry to Dolphin Contest #3', NOW() - INTERVAL '3 days'),

-- gigaChad's transactions
('GigaChad33333333333333333333333333333', 'DEPOSIT', 500000000, 0, 500000000, 'completed', 'Initial deposit', NOW() - INTERVAL '2 days'),
('GigaChad33333333333333333333333333333', 'CONTEST_ENTRY', 20000000, 500000000, 480000000, 'completed', 'Entry to Shark Contest #7', NOW() - INTERVAL '1 day'),

-- basedDev's transactions
('BasedDev44444444444444444444444444444', 'DEPOSIT', 100000000, 0, 100000000, 'completed', 'Initial deposit', NOW() - INTERVAL '7 days'),
('BasedDev44444444444444444444444444444', 'CONTEST_ENTRY', 1000000, 100000000, 99000000, 'completed', 'Entry to Squid Contest #2', NOW() - INTERVAL '6 days'),
('BasedDev44444444444444444444444444444', 'PRIZE_PAYOUT', 3000000, 99000000, 102000000, 'completed', 'Third place in Squid Contest #2', NOW() - INTERVAL '4 days'),

-- exitLiq's suspicious transactions
('ExitLiq555555555555555555555555555555', 'DEPOSIT', 10000000, 0, 10000000, 'completed', 'Initial deposit', NOW() - INTERVAL '1 hour'),
('ExitLiq555555555555555555555555555555', 'CONTEST_ENTRY', 1000000, 10000000, 9000000, 'pending', 'Entry to Guppy Contest #1', NOW() - INTERVAL '30 minutes');




