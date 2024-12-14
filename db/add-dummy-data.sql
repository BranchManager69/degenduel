-- First, clean existing data if needed
DELETE FROM contest_token_performance;
DELETE FROM contest_token_prices;
DELETE FROM token_bucket_memberships;
DELETE FROM contest_participants;
DELETE FROM token_prices;
DELETE FROM contests;
DELETE FROM tokens;
DELETE FROM users;

-- 1. Insert Users
INSERT INTO users (wallet_address, nickname, created_at, total_contests, total_wins) VALUES
('Admin11111111111111111111111111111111', 'AdminUser', NOW() - INTERVAL '30 days', 5, 2),
('Whale11111111111111111111111111111111', 'WhaleTrader', NOW() - INTERVAL '60 days', 10, 4),
('Dolpn11111111111111111111111111111111', 'DolphinDan', NOW() - INTERVAL '45 days', 3, 1),
('Shark11111111111111111111111111111111', 'SharkSarah', NOW() - INTERVAL '20 days', 7, 3),
('Noob111111111111111111111111111111111', 'NewbieTester', NOW() - INTERVAL '2 days', 1, 0);

-- 2. Insert Tokens
WITH inserted_tokens AS (
    INSERT INTO tokens (address, symbol, name) VALUES
    ('So11111111111111111111111111111111111111111', 'SOL', 'Solana'),
    ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 'USD Coin'),
    ('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK', 'Bonk')
    RETURNING id, symbol
)
INSERT INTO token_prices (token_id, price)
SELECT id,
    CASE 
        WHEN symbol = 'SOL' THEN 101.50
        WHEN symbol = 'USDC' THEN 1.00
        WHEN symbol = 'BONK' THEN 0.00001
    END
FROM inserted_tokens;

-- 3. Insert Contests with settings
INSERT INTO contests (name, description, start_time, end_time, entry_fee, prize_pool, status, settings) VALUES 
('Dolphin Trading Sprint', 'Quick trading competition for intermediate traders', 
    NOW() - INTERVAL '1 hour', NOW() + INTERVAL '23 hours', 100000000, 1000000000, 'active', 
    '{"difficulty": "dolphin", "maxParticipants": 20, "min_trades": 3}'::jsonb),
('Shark Week Challenge', 'High stakes trading competition', 
    NOW() - INTERVAL '2 hours', NOW() + INTERVAL '22 hours', 500000000, 5000000000, 'active',
    '{"difficulty": "shark", "maxParticipants": 50, "min_trades": 5}'::jsonb),
('Whale Watchers Elite', 'Premium trading contest for experienced traders',
    NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days', 1000000000, 10000000000, 'pending',
    '{"difficulty": "whale", "maxParticipants": 100, "min_trades": 10}'::jsonb),
('Past Shark Challenge', 'Previous high stakes competition',
    NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', 500000000, 5000000000, 'completed',
    '{"difficulty": "shark", "maxParticipants": 50, "min_trades": 5}'::jsonb);

-- 4. Insert Contest Participants
INSERT INTO contest_participants (contest_id, wallet_address, initial_balance, current_balance)
SELECT c.id, u.wallet_address, 1000000,
    CASE 
        WHEN u.nickname LIKE 'Whale%' THEN 1300000
        WHEN u.nickname LIKE 'Shark%' THEN 1250000
        WHEN u.nickname LIKE 'Dolphin%' THEN 1100000
        ELSE 950000
    END
FROM contests c
CROSS JOIN users u
WHERE (c.name = 'Dolphin Trading Sprint' AND u.nickname IN ('DolphinDan', 'NewbieTester'))
   OR (c.name = 'Shark Week Challenge' AND u.nickname IN ('SharkSarah', 'WhaleTrader'));

-- 5. Insert Contest Token Prices
INSERT INTO contest_token_prices (contest_id, wallet_address, token_id, amount, price)
SELECT 
    cp.contest_id,
    cp.wallet_address,
    t.id,
    CASE 
        WHEN u.nickname LIKE 'Whale%' THEN 300000000
        WHEN u.nickname LIKE 'Shark%' THEN 200000000
        WHEN u.nickname LIKE 'Dolphin%' THEN 100000000
        ELSE 50000000
    END,
    CASE 
        WHEN u.nickname LIKE 'Whale%' THEN 101.00
        WHEN u.nickname LIKE 'Shark%' THEN 101.25
        WHEN u.nickname LIKE 'Dolphin%' THEN 101.50
        ELSE 101.75
    END
FROM contest_participants cp
JOIN users u ON cp.wallet_address = u.wallet_address
CROSS JOIN (SELECT id FROM tokens WHERE symbol = 'SOL') t;

-- 6. Insert Contest Token Performance
INSERT INTO contest_token_performance (contest_id, wallet_address, token_id, profit_loss)
SELECT 
    cp.contest_id,
    cp.wallet_address,
    t.id,
    CASE 
        WHEN u.nickname LIKE 'Whale%' THEN 0.10
        WHEN u.nickname LIKE 'Shark%' THEN 0.08
        WHEN u.nickname LIKE 'Dolphin%' THEN 0.05
        ELSE -0.02
    END
FROM contest_participants cp
JOIN users u ON cp.wallet_address = u.wallet_address
CROSS JOIN (SELECT id FROM tokens WHERE symbol = 'SOL') t;