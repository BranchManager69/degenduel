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
INSERT INTO contests (name, description, start_time, end_time, entry_fee, prize_pool, status, settings) VALUES
('Ancient History Contest', 'A relic of a contest completed long ago.', 
    '1994-10-03T00:00:00Z', '1994-10-04T23:59:59Z', 1003, 1004, 'completed', '{"max_participants": 14}'),
('Bah Humbug Contest', 'A miserable December contest for the Scrooges who like to buy shitcoins on Christmas.', 
    NOW() - INTERVAL '3 days', NOW() + INTERVAL '2 days', 420, 1069, 'active', '{"max_participants": 69}'),
('Happy New Year Contest', 'A future contest to celebrate the arrival of 2025.', 
    NOW() + INTERVAL '5 days', NOW() + INTERVAL '10 days', 100, 1000, 'pending', '{"max_participants": 20}');

-- Insert Participants to Contests
INSERT INTO contest_participants (contest_id, wallet_address) VALUES
(1, 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'),
(2, 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'),
(2, 'GayGuy2222222222222222222222222222222'),
(2, 'GigaChad33333333333333333333333333333'),
(2, 'BasedDev44444444444444444444444444444'),
(2, 'ExitLiq555555555555555555555555555555');

-- Insert Token Buckets
INSERT INTO token_buckets (name, description) VALUES
('AI', 'Just AI tokens.'),
('Animals', 'Just animal tokens.'),
('Blue Chips', 'Just $100M+ market cap tokens.'),
('Branch Bags', 'Just tokens Branch Manager likes subjectively.'),
('Cabal', 'Just cabal tokens.'),
('DAO', 'Just decentralized autonomous organization tokens.'),
('Gen Z', 'Just Gen Z tokens.'),
('Low Cap Gems', 'Just sub-$1M market cap tokens.'),
('Meme Tokens', 'A bucket of meme tokens like BONK.'),
('Stablecoins', 'A collection of stablecoins for safe trading.'),
('Tik-Tok', 'Just Tik-Tok tokens.'),
('Utility', 'Just utility and governance tokens.'),
('Washed-Up', 'Just washed-up has-been tokens.');

-- Link Tokens to Buckets
INSERT INTO token_bucket_memberships (bucket_id, token_id) VALUES
((SELECT id FROM token_buckets WHERE name = 'AI'), (SELECT id FROM tokens WHERE symbol = 'GOAT')),
((SELECT id FROM token_buckets WHERE name = 'Blue Chips'), (SELECT id FROM tokens WHERE symbol = 'SOL')),
((SELECT id FROM token_buckets WHERE name = 'Stablecoins'), (SELECT id FROM tokens WHERE symbol = 'USDC')),
((SELECT id FROM token_buckets WHERE name = 'Animals'), (SELECT id FROM tokens WHERE symbol = 'Pnut')),
((SELECT id FROM token_buckets WHERE name = 'Branch Bags'), (SELECT id FROM tokens WHERE symbol = 'BONKFA')),
((SELECT id FROM token_buckets WHERE name = 'Utility'), (SELECT id FROM tokens WHERE symbol = 'PRINT')),
((SELECT id FROM token_buckets WHERE name = 'Animals'), (SELECT id FROM tokens WHERE symbol = 'PLATRICK')),
((SELECT id FROM token_buckets WHERE name = 'Blue Chips'), (SELECT id FROM tokens WHERE symbol = 'BLUECOIN')),
((SELECT id FROM token_buckets WHERE name = 'Branch Bags'), (SELECT id FROM tokens WHERE symbol = 'PIGSKIN')),
((SELECT id FROM token_buckets WHERE name = 'Cabal'), (SELECT id FROM tokens WHERE symbol = 'KABAL')),
((SELECT id FROM token_buckets WHERE name = 'DAO'), (SELECT id FROM tokens WHERE symbol = 'MYLEG')),
((SELECT id FROM token_buckets WHERE name = 'Gen Z'), (SELECT id FROM tokens WHERE symbol = 'ZOOM')),
((SELECT id FROM token_buckets WHERE name = 'Low Cap Gems'), (SELECT id FROM tokens WHERE symbol = 'LOKAP')),
((SELECT id FROM token_buckets WHERE name = 'Meme Tokens'), (SELECT id FROM tokens WHERE symbol = 'MEMARS')),
((SELECT id FROM token_buckets WHERE name = 'Stablecoins'), (SELECT id FROM tokens WHERE symbol = 'fUSD')),
((SELECT id FROM token_buckets WHERE name = 'Tik-Tok'), (SELECT id FROM tokens WHERE symbol = 'DIKDOK')),
((SELECT id FROM token_buckets WHERE name = 'Utility'), (SELECT id FROM tokens WHERE symbol = 'iBUYuTIL')),
((SELECT id FROM token_buckets WHERE name = 'Washed-Up'), (SELECT id FROM tokens WHERE symbol = 'WHAT'));


-- HAVENT TESTED THESE BELOW THIS LINE YET.
-- PLEASE MAKE YOUR BEST JUDGMENT ABOUT WHETHER TO COMMENT THEM OUT OR NOT:

-- Insert Contest Token Prices
INSERT INTO contest_token_prices (contest_id, wallet_address, token_id, amount, price) VALUES
((SELECT id FROM contests WHERE name = 'Ancient History Contest'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'BONKFA'), 1000, 0.05),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'GOAT'), 10, 0.51),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'GayGuy2222222222222222222222222222222', (SELECT id FROM tokens WHERE symbol = 'USDC'), 500, 1.00),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'GigaChad33333333333333333333333333333', (SELECT id FROM tokens WHERE symbol = 'BONK'), 1000, 0.01);

-- Insert Contest Token Performance
INSERT INTO contest_token_performance (contest_id, wallet_address, token_id, profit_loss) VALUES
((SELECT id FROM contests WHERE name = 'Ancient History Contest'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'BONKFA'), 4.20),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp', (SELECT id FROM tokens WHERE symbol = 'GOAT'), 0.69),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'GayGuy2222222222222222222222222222222', (SELECT id FROM tokens WHERE symbol = 'USDC'), 0.05),
((SELECT id FROM contests WHERE name = 'Bah Humbug Contest'), 
 'GigaChad33333333333333333333333333333', (SELECT id FROM tokens WHERE symbol = 'BONK'), -0.02);

