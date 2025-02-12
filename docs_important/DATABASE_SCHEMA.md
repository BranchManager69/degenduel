## Achievement System

### Achievement Categories (`achievement_categories`)
Categories for user achievements.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Category ID | Primary Key, Auto-increment |
| name | VARCHAR(50) | Category name | Unique |
| description | TEXT | Category description | |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

### Achievement Tiers (`achievement_tiers`)
Tier levels for achievements.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Tier ID | Primary Key, Auto-increment |
| name | VARCHAR(20) | Tier name | Not Null |
| color_hex | VARCHAR(7) | Display color | Not Null |
| points | INTEGER | Points awarded | Not Null |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

### Achievement Tier Requirements (`achievement_tier_requirements`)
Requirements for each achievement tier.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Requirement ID | Primary Key, Auto-increment |
| achievement_type | TEXT | Achievement type | Not Null |
| tier_id | INTEGER | Reference to tier | Not Null |
| requirement_value | JSONB | Requirement criteria | Not Null |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

#### Indexes
- `idx_achievement_tier_requirements_lookup` (achievement_type, tier_id)

## User Progression

### User Levels (`user_levels`)
User level progression system.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Level ID | Primary Key, Auto-increment |
| level_number | INTEGER | Level number | Not Null |
| class_name | VARCHAR(20) | Level class | Not Null |
| title | VARCHAR(50) | Level title | Not Null |
| min_exp | INTEGER | Required experience | Not Null |
| bronze_achievements_required | INTEGER | Required bronze achievements | Not Null |
| silver_achievements_required | INTEGER | Required silver achievements | Not Null |
| gold_achievements_required | INTEGER | Required gold achievements | Not Null |
| platinum_achievements_required | INTEGER | Required platinum achievements | Not Null |
| diamond_achievements_required | INTEGER | Required diamond achievements | Not Null |
| icon_url | VARCHAR(255) | Level icon URL | |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

### Level Rewards (`level_rewards`)
Rewards for reaching user levels.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Reward ID | Primary Key, Auto-increment |
| level_id | INTEGER | Reference to level | Not Null |
| reward_type | VARCHAR(50) | Type of reward | Not Null |
| reward_value | JSONB | Reward details | Not Null |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

## AI Integration

### AI Agents (`ai_agents`)
AI trading agents configuration.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Agent ID | Primary Key, Auto-increment |
| name | VARCHAR | Agent name | Not Null |
| personality | VARCHAR | Agent personality | Not Null |
| risk_tolerance | INTEGER | Risk level | Not Null |
| expertise | VARCHAR[] | Areas of expertise | Not Null |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| is_active | BOOLEAN | Active status | Default: true |

### AI Decisions (`ai_decisions`)
Trading decisions made by AI agents.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Decision ID | Primary Key, Auto-increment |
| agent_id | INTEGER | Reference to agent | Foreign Key |
| contest_id | INTEGER | Reference to contest | Foreign Key |
| decision_type | AIDecisionType | Type of decision | Not Null |
| token_id | INTEGER | Token affected | Foreign Key |
| amount | DECIMAL(20,0) | Decision amount | Not Null |
| reasoning | VARCHAR | Decision rationale | Not Null |
| market_context | JSONB | Market conditions | Default: '{}' |
| external_factors | JSONB | External influences | Default: '{}' |
| timestamp | TIMESTAMPTZ | Decision time | Default: CURRENT_TIMESTAMP |
| success_score | INTEGER | Performance score | |
| price_impact | DECIMAL(10,2) | Price impact % | |

#### Indexes
- `idx_ai_decisions_contest_time` (contest_id, timestamp)
- `idx_ai_decisions_token_time` (token_id, timestamp)

### Participant Influences (`participant_influences`)
User influence on AI decisions.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Influence ID | Primary Key, Auto-increment |
| decision_id | INTEGER | Reference to decision | Foreign Key |
| wallet_address | VARCHAR(44) | User's wallet | Foreign Key |
| persuasion_score | INTEGER | Influence score | Not Null |
| contribution_weight | DECIMAL(5,2) | Weight of influence | Not Null |
| timestamp | TIMESTAMPTZ | Record time | Default: CURRENT_TIMESTAMP |

#### Indexes
- `idx_participant_influences_lookup` (wallet_address, decision_id)

## System Security

### Auth Challenges (`auth_challenges`)
Authentication challenge tracking.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| wallet_address | VARCHAR(44) | User's wallet | Primary Key |
| nonce | TEXT | Challenge nonce | Not Null |
| expires_at | TIMESTAMPTZ | Expiration time | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |

#### Indexes
- `idx_auth_challenges_expires` (expires_at)

### Admin Logs (`admin_logs`)
Administrative action audit log.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Log ID | Primary Key, Auto-increment |
| admin_address | VARCHAR | Admin's wallet | Not Null |
| action | VARCHAR | Action taken | Not Null |
| details | JSONB | Action details | Default: '{}' |
| created_at | TIMESTAMPTZ | Action time | Default: CURRENT_TIMESTAMP |
| ip_address | VARCHAR | Admin's IP | |
| user_agent | VARCHAR | Admin's browser | |

#### Indexes
- `idx_admin_logs_admin` (admin_address)
- `idx_admin_logs_created` (created_at)

## Real-time Communication

### Websocket Messages (`websocket_messages`)
Real-time message queue.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Message ID | Primary Key, Auto-increment |
| type | TEXT | Message type | Not Null |
| data | JSONB | Message content | Not Null |
| wallet_address | TEXT | Recipient wallet | Foreign Key |
| timestamp | TIMESTAMPTZ | Message time | Default: CURRENT_TIMESTAMP |
| delivered | BOOLEAN | Delivery status | Default: false |

#### Indexes
- `idx_websocket_messages_wallet_type` (wallet_address, type)
- `idx_websocket_messages_timestamp` (timestamp)

## Wallet Management

### Seed Wallets (`seed_wallets`)
System seed wallet management.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| wallet_address | TEXT | Wallet address | Primary Key |
| private_key | TEXT | Encrypted key | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| is_active | BOOLEAN | Active status | Default: true |
| purpose | TEXT | Usage purpose | |
| metadata | JSONB | Additional data | |

### Vanity Wallet Pool (`vanity_wallet_pool`)
Custom pattern wallet management.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Pool ID | Primary Key, Auto-increment |
| wallet_address | TEXT | Wallet address | Unique |
| private_key | TEXT | Encrypted key | Not Null |
| pattern | TEXT | Address pattern | Not Null |
| is_used | BOOLEAN | Usage status | Default: false |
| used_at | TIMESTAMPTZ | Assignment time | |
| used_by_contest | INTEGER | Contest reference | Unique, Foreign Key |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |

#### Indexes
- `idx_vanity_wallet_pool_is_used` (is_used)
- `idx_vanity_wallet_pool_pattern` (pattern)

## Referral System

### Referrals (`referrals`)
Core referral tracking table.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Referral ID | Primary Key, Auto-increment |
| referrer_id | VARCHAR(44) | Referrer's wallet | Foreign Key (users) |
| referred_id | VARCHAR(44) | Referred user's wallet | Foreign Key (users) |
| referral_code | VARCHAR(20) | Unique referral code | Not Null |
| status | ReferralStatus | Current status | Default: 'pending' |
| source | VARCHAR(20) | Traffic source | Nullable |
| landing_page | TEXT | Landing page URL | Nullable |
| utm_source | VARCHAR(100) | UTM source | Nullable |
| utm_medium | VARCHAR(100) | UTM medium | Nullable |
| utm_campaign | VARCHAR(100) | UTM campaign | Nullable |
| device | VARCHAR(20) | User device | Nullable |
| browser | VARCHAR(20) | User browser | Nullable |
| ip_address | VARCHAR(45) | IP address | Nullable |
| user_agent | TEXT | Browser user agent | Nullable |
| click_timestamp | TIMESTAMPTZ | Initial click time | Nullable |
| session_id | UUID | Session identifier | Nullable |
| metadata | JSONB | Additional data | Default: '{}' |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| qualified_at | TIMESTAMPTZ | Qualification time | Nullable |
| reward_paid_at | TIMESTAMPTZ | Reward payment time | Nullable |
| reward_amount | DECIMAL(20,0) | Reward amount | Nullable |

#### Indexes
- `referrals_pkey` (id)
- `referrals_referrer_referred_unique` (referrer_id, referred_id)
- `idx_referrals_code` (referral_code)
- `idx_referrals_created` (created_at)

#### Example Queries

```sql
-- Create a new referral
INSERT INTO referrals (
    referrer_id, 
    referred_id, 
    referral_code, 
    source, 
    landing_page
) VALUES (
    'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
    'HN8SvE3UiP9J2QzrWxk1LmTHzF6KjGv4CqY5nBdX3Rw9',
    'BRANCH123',
    'twitter',
    '/contest/123'
);

-- Find all pending referrals for a user
SELECT r.*, u.username as referred_username
FROM referrals r
JOIN users u ON u.wallet_address = r.referred_id
WHERE r.referrer_id = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
AND r.status = 'pending'
ORDER BY r.created_at DESC;

-- Get referral conversion rate by source
SELECT 
    source,
    COUNT(*) as total_referrals,
    COUNT(CASE WHEN status = 'qualified' THEN 1 END) as conversions,
    ROUND(COUNT(CASE WHEN status = 'qualified' THEN 1 END)::numeric / COUNT(*) * 100, 2) as conversion_rate
FROM referrals
GROUP BY source
ORDER BY total_referrals DESC;

### Referral Clicks (`referral_clicks`)
Detailed click tracking for referral analytics.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Click ID | Primary Key, Auto-increment |
| referral_code | VARCHAR(20) | Referral code used | Not Null |
| source | VARCHAR(20) | Traffic source | Not Null |
| landing_page | TEXT | Landing page URL | Not Null |
| utm_source | VARCHAR(100) | UTM source | Nullable |
| utm_medium | VARCHAR(100) | UTM medium | Nullable |
| utm_campaign | VARCHAR(100) | UTM campaign | Nullable |
| device | VARCHAR(20) | User device | Not Null |
| browser | VARCHAR(20) | User browser | Not Null |
| ip_address | VARCHAR(45) | IP address | Not Null |
| user_agent | TEXT | Browser user agent | Not Null |
| session_id | UUID | Session identifier | Not Null |
| timestamp | TIMESTAMPTZ | Click timestamp | Default: CURRENT_TIMESTAMP |
| converted | BOOLEAN | Conversion status | Default: false |
| converted_at | TIMESTAMPTZ | Conversion time | Nullable |
| referrer_id | VARCHAR(44) | Referrer's wallet | Foreign Key (users) |

#### Indexes
- `referral_clicks_pkey` (id)
- `idx_referral_clicks_code` (referral_code)
- `idx_referral_clicks_timestamp` (timestamp)
- `idx_referral_clicks_session` (session_id)

#### Example Queries

```sql
-- Track a new referral click
INSERT INTO referral_clicks (
    referral_code,
    source,
    landing_page,
    device,
    browser,
    ip_address,
    user_agent,
    session_id,
    referrer_id
) VALUES (
    'BRANCH123',
    'twitter',
    '/contest/123',
    'mobile',
    'chrome',
    '192.168.1.1',
    'Mozilla/5.0...',
    'uuid-v4-here',
    'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
);

-- Get click-to-signup conversion rate
WITH click_stats AS (
    SELECT 
        referral_code,
        COUNT(*) as total_clicks,
        COUNT(CASE WHEN converted = true THEN 1 END) as conversions
    FROM referral_clicks
    GROUP BY referral_code
)
SELECT 
    c.*,
    u.username as referrer_username,
    ROUND(c.conversions::numeric / c.total_clicks * 100, 2) as conversion_rate
FROM click_stats c
JOIN users u ON u.referral_code = c.referral_code
ORDER BY conversion_rate DESC;

-- Get device distribution for clicks
SELECT 
    device,
    COUNT(*) as click_count,
    ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER() * 100, 2) as percentage
FROM referral_clicks
GROUP BY device
ORDER BY click_count DESC;

### Referral Rewards (`referral_rewards`)
Tracks referral reward distributions.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Reward ID | Primary Key, Auto-increment |
| wallet_address | VARCHAR(44) | Recipient wallet | Foreign Key (users) |
| reward_type | ReferralRewardType | Type of reward | Not Null |
| amount | DECIMAL(20,0) | Reward amount | Not Null |
| description | TEXT | Reward description | Nullable |
| transaction_id | INTEGER | Transaction reference | Foreign Key (transactions) |
| created_at | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| paid_at | TIMESTAMPTZ | Payment timestamp | Nullable |

#### Indexes
- `referral_rewards_pkey` (id)
- `idx_referral_rewards_wallet` (wallet_address)
- `idx_referral_rewards_created` (created_at)

#### Example Queries

```sql
-- Create a new reward
INSERT INTO referral_rewards (
    wallet_address,
    reward_type,
    amount,
    description
) VALUES (
    'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
    'signup_bonus',
    1000,
    'New user signup reward'
);

-- Get total rewards by type for a user
SELECT 
    reward_type,
    COUNT(*) as reward_count,
    SUM(amount) as total_amount,
    MIN(created_at) as first_reward,
    MAX(created_at) as last_reward
FROM referral_rewards
WHERE wallet_address = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
GROUP BY reward_type
ORDER BY total_amount DESC;

-- Find unpaid rewards
SELECT 
    rr.*,
    u.username
FROM referral_rewards rr
JOIN users u ON u.wallet_address = rr.wallet_address
WHERE rr.paid_at IS NULL
ORDER BY rr.created_at ASC;

## Enums

#### ReferralStatus
- `pending`: Initial state
- `qualified`: Met qualification criteria
- `rewarded`: Reward distributed
- `expired`: No longer valid

#### ReferralRewardType
- `signup_bonus`: New user signup reward
- `contest_bonus`: Contest participation reward
- `special_event`: Special promotion reward

## Blockchain Integration

### Blockchain Transactions (`blockchain_transactions`)
Record of blockchain transactions.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Transaction ID | Primary Key, Auto-increment |
| tx_hash | TEXT | Transaction hash | Not Null |
| from_address | TEXT | Sender address | Not Null |
| to_address | TEXT | Recipient address | Not Null |
| value | DECIMAL(20,0) | Transaction amount | Not Null |
| gas_price | DECIMAL(20,0) | Gas price in wei | Not Null |
| gas_limit | INTEGER | Gas limit | Not Null |
| nonce | INTEGER | Transaction nonce | Not Null |
| data | TEXT | Transaction data | |
| status | TEXT | Transaction status | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| error | TEXT | Error message | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_blockchain_transactions_hash` (tx_hash)
- `idx_blockchain_transactions_from` (from_address)
- `idx_blockchain_transactions_to` (to_address)
- `idx_blockchain_transactions_status` (status)

### Managed Wallets (`managed_wallets`)
System-managed wallet tracking.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Wallet ID | Primary Key, Auto-increment |
| wallet_address | TEXT | Wallet address | Not Null, Unique |
| private_key | TEXT | Encrypted key | Not Null |
| wallet_type | TEXT | Type of wallet | Not Null |
| status | TEXT | Wallet status | Not Null |
| balance | DECIMAL(20,0) | Current balance | Not Null |
| last_nonce | INTEGER | Last used nonce | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_managed_wallets_address` (wallet_address)
- `idx_managed_wallets_type` (wallet_type)
- `idx_managed_wallets_status` (status)

## Contest System

### Contests (`contests`)
Main contest table.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Contest ID | Primary Key, Auto-increment |
| name | TEXT | Contest name | Not Null |
| description | TEXT | Contest description | |
| start_time | TIMESTAMPTZ | Start time | Not Null |
| end_time | TIMESTAMPTZ | End time | Not Null |
| entry_fee | DECIMAL(20,0) | Entry fee amount | Not Null |
| min_participants | INTEGER | Minimum participants | Not Null |
| max_participants | INTEGER | Maximum participants | Not Null |
| status | TEXT | Contest status | Not Null |
| prize_pool | DECIMAL(20,0) | Total prize pool | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| template_id | INTEGER | Reference to template | Foreign Key |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_contests_status` (status)
- `idx_contests_time` (start_time, end_time)

#### Example Queries
```sql
-- Create a new contest
INSERT INTO contests (
    name,
    description,
    start_time,
    end_time,
    entry_fee,
    min_participants,
    max_participants,
    prize_pool
) VALUES (
    'Weekend Warriors #123',
    'Weekend trading competition with 100x leverage',
    NOW() + INTERVAL '1 day',
    NOW() + INTERVAL '3 days',
    1000,
    10,
    100,
    100000
);

-- Find active contests with available slots
SELECT 
    c.*,
    COUNT(cp.id) as current_participants,
    c.max_participants - COUNT(cp.id) as slots_remaining,
    EXTRACT(EPOCH FROM (c.start_time - NOW()))/3600 as hours_until_start
FROM contests c
LEFT JOIN contest_participants cp ON cp.contest_id = c.id
WHERE c.status = 'active'
AND c.start_time > NOW()
GROUP BY c.id
HAVING COUNT(cp.id) < c.max_participants
ORDER BY c.start_time ASC;

-- Get contest performance metrics
WITH contest_stats AS (
    SELECT 
        c.id,
        c.name,
        COUNT(cp.id) as total_participants,
        SUM(cp.prize_amount) as total_prizes_paid,
        AVG(cp.final_rank) as avg_rank,
        MIN(cp.joined_at) as first_join,
        MAX(cp.joined_at) as last_join
    FROM contests c
    LEFT JOIN contest_participants cp ON cp.contest_id = c.id
    WHERE c.status = 'completed'
    GROUP BY c.id, c.name
)
SELECT 
    cs.*,
    ROUND(cs.total_prizes_paid::numeric / cs.total_participants, 2) as avg_prize_per_player,
    EXTRACT(EPOCH FROM (cs.last_join - cs.first_join))/3600 as signup_window_hours
FROM contest_stats cs
ORDER BY cs.total_participants DESC;

### Contest Participants (`contest_participants`)
Contest participation tracking.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Participant ID | Primary Key, Auto-increment |
| contest_id | INTEGER | Reference to contest | Not Null, Foreign Key |
| wallet_address | VARCHAR(44) | Participant's wallet | Not Null, Foreign Key |
| entry_time | TIMESTAMPTZ | Join timestamp | Not Null |
| status | TEXT | Participation status | Not Null |
| rank | INTEGER | Final ranking | |
| score | DECIMAL(10,2) | Performance score | |
| winnings | DECIMAL(20,0) | Prize amount | |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_contest_participants_contest` (contest_id)
- `idx_contest_participants_wallet` (wallet_address)
- `idx_contest_participants_status` (status)

#### Example Queries
```sql
-- Track new participant entry
INSERT INTO contest_participants (
    contest_id,
    wallet_address,
    initial_dxd_points,
    current_dxd_points
) VALUES (
    123,
    'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
    1000,
    1000
);

-- Get user's contest history with performance
SELECT 
    c.name as contest_name,
    cp.joined_at,
    cp.initial_dxd_points,
    cp.current_dxd_points,
    cp.final_rank,
    cp.prize_amount,
    ROUND((cp.current_dxd_points - cp.initial_dxd_points)::numeric / 
          NULLIF(cp.initial_dxd_points, 0) * 100, 2) as roi_percentage
FROM contest_participants cp
JOIN contests c ON c.id = cp.contest_id
WHERE cp.wallet_address = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
ORDER BY cp.joined_at DESC;

-- Get contest leaderboard
WITH participant_stats AS (
    SELECT 
        cp.contest_id,
        cp.wallet_address,
        u.username,
        cp.current_dxd_points,
        cp.initial_dxd_points,
        ROUND((cp.current_dxd_points - cp.initial_dxd_points)::numeric / 
              NULLIF(cp.initial_dxd_points, 0) * 100, 2) as roi_percentage,
        ROW_NUMBER() OVER (
            PARTITION BY cp.contest_id 
            ORDER BY cp.current_dxd_points DESC
        ) as current_rank
    FROM contest_participants cp
    JOIN users u ON u.wallet_address = cp.wallet_address
)
SELECT 
    ps.*,
    CASE 
        WHEN current_rank = 1 THEN '🥇'
        WHEN current_rank = 2 THEN '🥈'
        WHEN current_rank = 3 THEN '🥉'
        ELSE ''
    END as medal
FROM participant_stats ps
WHERE contest_id = 123
ORDER BY current_rank ASC;

### Contest Portfolios (`contest_portfolios`)
Participant portfolio tracking.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Portfolio ID | Primary Key, Auto-increment |
| contest_id | INTEGER | Reference to contest | Not Null, Foreign Key |
| participant_id | INTEGER | Reference to participant | Not Null, Foreign Key |
| total_value | DECIMAL(20,0) | Portfolio value | Not Null |
| cash_balance | DECIMAL(20,0) | Available cash | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_contest_portfolios_contest` (contest_id)
- `idx_contest_portfolios_participant` (participant_id)

#### Example Queries
```sql
-- Get portfolio composition
WITH portfolio_value AS (
    SELECT 
        cp.contest_id,
        cp.wallet_address,
        SUM(cp.weight * t.current_price) as total_value
    FROM contest_portfolios cp
    JOIN tokens t ON t.id = cp.token_id
    GROUP BY cp.contest_id, cp.wallet_address
)
SELECT 
    t.symbol,
    cp.weight,
    t.current_price as token_price,
    cp.weight * t.current_price as position_value,
    ROUND((cp.weight * t.current_price / pv.total_value) * 100, 2) as portfolio_percentage
FROM contest_portfolios cp
JOIN tokens t ON t.id = cp.token_id
JOIN portfolio_value pv ON pv.contest_id = cp.contest_id 
    AND pv.wallet_address = cp.wallet_address
WHERE cp.contest_id = 123
AND cp.wallet_address = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
ORDER BY position_value DESC;

-- Track portfolio performance over time
WITH hourly_snapshots AS (
    SELECT 
        cp.contest_id,
        cp.wallet_address,
        DATE_TRUNC('hour', ctp.timestamp) as snapshot_time,
        SUM(ctp.profit_loss) as hourly_pnl
    FROM contest_portfolios cp
    JOIN contest_token_performance ctp ON 
        ctp.contest_id = cp.contest_id AND
        ctp.wallet_address = cp.wallet_address AND
        ctp.token_id = cp.token_id
    GROUP BY cp.contest_id, cp.wallet_address, DATE_TRUNC('hour', ctp.timestamp)
)
SELECT 
    snapshot_time,
    hourly_pnl,
    SUM(hourly_pnl) OVER (
        PARTITION BY contest_id, wallet_address
        ORDER BY snapshot_time
    ) as cumulative_pnl
FROM hourly_snapshots
WHERE contest_id = 123
AND wallet_address = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
ORDER BY snapshot_time;

### Contest Portfolio Trades (`contest_portfolio_trades`)
Trading activity within contests.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Trade ID | Primary Key, Auto-increment |
| portfolio_id | INTEGER | Reference to portfolio | Not Null, Foreign Key |
| token_id | INTEGER | Reference to token | Not Null, Foreign Key |
| trade_type | TEXT | Buy/Sell indicator | Not Null |
| amount | DECIMAL(20,0) | Trade amount | Not Null |
| price | DECIMAL(20,0) | Token price | Not Null |
| timestamp | TIMESTAMPTZ | Trade time | Not Null |
| status | TEXT | Trade status | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_contest_portfolio_trades_portfolio` (portfolio_id)
- `idx_contest_portfolio_trades_token` (token_id)
- `idx_contest_portfolio_trades_time` (timestamp)

#### Example Queries
```sql
-- Get recent trades with performance impact
SELECT 
    cpt.executed_at,
    t.symbol as token_symbol,
    cpt.type as trade_type,
    cpt.old_weight as weight_before,
    cpt.new_weight as weight_after,
    cpt.price_at_trade,
    t.current_price,
    CASE 
        WHEN cpt.type = 'BUY' THEN 
            ROUND((t.current_price - cpt.price_at_trade) / cpt.price_at_trade * 100, 2)
        ELSE 
            ROUND((cpt.price_at_trade - t.current_price) / cpt.price_at_trade * 100, 2)
    END as trade_roi
FROM contest_portfolio_trades cpt
JOIN tokens t ON t.id = cpt.token_id
WHERE cpt.contest_id = 123
AND cpt.wallet_address = 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
ORDER BY cpt.executed_at DESC;

-- Get trading statistics
WITH trade_metrics AS (
    SELECT 
        wallet_address,
        type as trade_type,
        COUNT(*) as trade_count,
        AVG(EXTRACT(EPOCH FROM (executed_at - created_at))) as avg_execution_time_seconds,
        SUM(virtual_amount) as total_volume
    FROM contest_portfolio_trades
    WHERE contest_id = 123
    GROUP BY wallet_address, type
)
SELECT 
    u.username,
    tm.trade_type,
    tm.trade_count,
    ROUND(tm.avg_execution_time_seconds, 2) as avg_execution_time,
    tm.total_volume,
    ROUND(tm.total_volume::numeric / SUM(tm.total_volume) OVER () * 100, 2) as volume_percentage
FROM trade_metrics tm
JOIN users u ON u.wallet_address = tm.wallet_address
ORDER BY tm.total_volume DESC;
```

## Token System

### Tokens (`tokens`)
Supported trading tokens.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Token ID | Primary Key, Auto-increment |
| symbol | TEXT | Token symbol | Not Null, Unique |
| name | TEXT | Token name | Not Null |
| decimals | INTEGER | Token decimals | Not Null |
| contract_address | TEXT | Token contract | Not Null |
| chain_id | INTEGER | Blockchain ID | Not Null |
| is_active | BOOLEAN | Trading status | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_tokens_symbol` (symbol)
- `idx_tokens_contract` (contract_address, chain_id)
- `idx_tokens_active` (is_active)

### Token Prices (`token_prices`)
Historical token price data.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Price ID | Primary Key, Auto-increment |
| token_id | INTEGER | Reference to token | Not Null, Foreign Key |
| price | DECIMAL(20,0) | Token price | Not Null |
| timestamp | TIMESTAMPTZ | Price timestamp | Not Null |
| source | TEXT | Price source | Not Null |

#### Indexes
- `idx_token_prices_token_time` (token_id, timestamp)
- `idx_token_prices_source` (source)

### Token Buckets (`token_buckets`)
Token grouping categories.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Bucket ID | Primary Key, Auto-increment |
| name | TEXT | Bucket name | Not Null |
| description | TEXT | Bucket description | |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

### Token Bucket Memberships (`token_bucket_memberships`)
Token bucket assignments.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Membership ID | Primary Key, Auto-increment |
| bucket_id | INTEGER | Reference to bucket | Not Null, Foreign Key |
| token_id | INTEGER | Reference to token | Not Null, Foreign Key |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |

#### Indexes
- `idx_token_bucket_memberships_bucket` (bucket_id)
- `idx_token_bucket_memberships_token` (token_id)

## User System

### Users (`users`)
User account information.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| wallet_address | VARCHAR(44) | User's wallet | Primary Key |
| username | TEXT | Display name | Unique |
| email | TEXT | Email address | Unique |
| avatar_url | TEXT | Profile image | |
| is_active | BOOLEAN | Account status | Not Null |
| role | TEXT | User role | Not Null |
| exp_points | INTEGER | Experience points | Not Null |
| current_level | INTEGER | User level | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_users_username` (username)
- `idx_users_email` (email)
- `idx_users_level` (current_level)

### User Social Profiles (`user_social_profiles`)
User social media links.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Profile ID | Primary Key, Auto-increment |
| wallet_address | VARCHAR(44) | User's wallet | Not Null, Foreign Key |
| platform | TEXT | Social platform | Not Null |
| username | TEXT | Platform username | Not Null |
| profile_url | TEXT | Profile URL | Not Null |
| verified | BOOLEAN | Verification status | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_user_social_profiles_wallet` (wallet_address)
- `idx_user_social_profiles_platform` (platform)

### User Stats (`user_stats`)
User performance statistics.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| wallet_address | VARCHAR(44) | User's wallet | Primary Key |
| contests_entered | INTEGER | Total contests | Not Null |
| contests_won | INTEGER | Winning contests | Not Null |
| total_winnings | DECIMAL(20,0) | Total earnings | Not Null |
| win_rate | DECIMAL(5,2) | Win percentage | Not Null |
| avg_rank | DECIMAL(5,2) | Average ranking | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_user_stats_winnings` (total_winnings)
- `idx_user_stats_win_rate` (win_rate)

### User Token Stats (`user_token_stats`)
Token-specific performance stats.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Stat ID | Primary Key, Auto-increment |
| wallet_address | VARCHAR(44) | User's wallet | Not Null, Foreign Key |
| token_id | INTEGER | Reference to token | Not Null, Foreign Key |
| trades_count | INTEGER | Total trades | Not Null |
| profitable_trades | INTEGER | Winning trades | Not Null |
| total_profit_loss | DECIMAL(20,0) | Net P/L | Not Null |
| avg_hold_time | INTEGER | Avg hold duration | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_user_token_stats_wallet` (wallet_address)
- `idx_user_token_stats_token` (token_id)
- `idx_user_token_stats_profit` (total_profit_loss)

### User Achievements (`user_achievements`)
User achievement tracking.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Achievement ID | Primary Key, Auto-increment |
| wallet_address | VARCHAR(44) | User's wallet | Not Null, Foreign Key |
| achievement_type | TEXT | Achievement type | Not Null |
| tier_id | INTEGER | Reference to tier | Not Null, Foreign Key |
| achieved_at | TIMESTAMPTZ | Completion time | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_user_achievements_wallet` (wallet_address)
- `idx_user_achievements_type` (achievement_type)
- `idx_user_achievements_tier` (tier_id)

## Transaction System

### Transactions (`transactions`)
Platform financial transaction records.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Transaction ID | Primary Key, Auto-increment |
| wallet_address | VARCHAR(44) | User's wallet | Foreign Key |
| type | transaction_type | Transaction type | Not Null |
| amount | DECIMAL(20,0) | Transaction amount | Not Null |
| balance_before | DECIMAL(20,0) | Previous balance | Not Null |
| balance_after | DECIMAL(20,0) | New balance | Not Null |
| contest_id | INTEGER | Related contest | Foreign Key |
| description | TEXT | Transaction details | |
| status | transaction_status | Processing status | Default: completed |
| metadata | JSONB | Additional data | Default: '{}' |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| processed_at | TIMESTAMPTZ | Processing time | |

#### Indexes
- `idx_transactions_wallet` (wallet_address)
- `idx_transactions_contest` (contest_id)
- `idx_transactions_type_created` (type, created_at)

#### Transaction Types
- `CONTEST_ENTRY`: Contest participation fee
- `PRIZE_PAYOUT`: Contest winnings
- `DEPOSIT`: User deposits
- `WITHDRAWAL`: User withdrawals
- `REFERRAL_BONUS`: Referral rewards
- `PROMOTION`: Promotional credits

#### Transaction Status
- `pending`: Being processed
- `completed`: Successfully processed
- `failed`: Processing failed
- `reversed`: Transaction reversed

## Query Cookbook

### Basic Referral Analytics

```sql
-- Get complete referral funnel metrics
WITH funnel AS (
    SELECT
        r.source,
        COUNT(DISTINCT rc.id) as total_clicks,
        COUNT(DISTINCT r.id) as total_referrals,
        COUNT(DISTINCT CASE WHEN r.status = 'qualified' THEN r.id END) as qualified_referrals,
        COUNT(DISTINCT CASE WHEN r.status = 'rewarded' THEN r.id END) as rewarded_referrals,
        SUM(CASE WHEN r.status = 'rewarded' THEN rr.amount ELSE 0 END) as total_rewards
    FROM referral_clicks rc
    LEFT JOIN referrals r ON r.referral_code = rc.referral_code
    LEFT JOIN referral_rewards rr ON rr.wallet_address = r.referrer_id
    GROUP BY r.source
)
SELECT
    source,
    total_clicks,
    total_referrals,
    qualified_referrals,
    rewarded_referrals,
    total_rewards,
    ROUND(total_referrals::numeric / NULLIF(total_clicks, 0) * 100, 2) as click_to_referral_rate,
    ROUND(qualified_referrals::numeric / NULLIF(total_referrals, 0) * 100, 2) as qualification_rate,
    ROUND(rewarded_referrals::numeric / NULLIF(qualified_referrals, 0) * 100, 2) as reward_rate
FROM funnel
ORDER BY total_clicks DESC;

-- Get top referrers with their stats
SELECT 
    u.username,
    COUNT(r.id) as total_referrals,
    COUNT(DISTINCT CASE WHEN r.status = 'qualified' THEN r.id END) as successful_referrals,
    SUM(rr.amount) as total_rewards,
    ROUND(COUNT(DISTINCT CASE WHEN r.status = 'qualified' THEN r.id END)::numeric / 
          NULLIF(COUNT(r.id), 0) * 100, 2) as success_rate,
    MIN(r.created_at) as first_referral,
    MAX(r.created_at) as last_referral
FROM users u
LEFT JOIN referrals r ON r.referrer_id = u.wallet_address
LEFT JOIN referral_rewards rr ON rr.wallet_address = u.wallet_address
GROUP BY u.username
HAVING COUNT(r.id) > 0
ORDER BY total_rewards DESC NULLS LAST;

-- Get conversion timeline analysis
WITH timeline AS (
    SELECT
        r.id,
        rc.timestamp as click_time,
        r.created_at as signup_time,
        r.qualified_at,
        r.reward_paid_at,
        EXTRACT(EPOCH FROM (r.created_at - rc.timestamp))/3600 as hours_to_signup,
        EXTRACT(EPOCH FROM (r.qualified_at - r.created_at))/3600 as hours_to_qualify,
        EXTRACT(EPOCH FROM (r.reward_paid_at - r.qualified_at))/3600 as hours_to_reward
    FROM referrals r
    JOIN referral_clicks rc ON rc.referral_code = r.referral_code
    WHERE r.status = 'rewarded'
)
SELECT
    COUNT(*) as total_conversions,
    ROUND(AVG(hours_to_signup), 2) as avg_signup_hours,
    ROUND(AVG(hours_to_qualify), 2) as avg_qualification_hours,
    ROUND(AVG(hours_to_reward), 2) as avg_reward_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_to_signup), 2) as median_signup_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_to_qualify), 2) as median_qualification_hours,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_to_reward), 2) as median_reward_hours
FROM timeline;
```

### Contest Analytics

```sql
-- Get contest participation trends
WITH monthly_stats AS (
    SELECT
        DATE_TRUNC('month', c.start_time) as month,
        COUNT(DISTINCT c.id) as contests_held,
        COUNT(DISTINCT cp.wallet_address) as unique_participants,
        SUM(c.prize_pool) as total_prize_pool,
        SUM(cp.prize_amount) as total_prizes_paid,
        AVG(c.participant_count) as avg_participants_per_contest
    FROM contests c
    LEFT JOIN contest_participants cp ON cp.contest_id = c.id
    WHERE c.status = 'completed'
    GROUP BY DATE_TRUNC('month', c.start_time)
)
SELECT
    month,
    contests_held,
    unique_participants,
    total_prize_pool,
    total_prizes_paid,
    ROUND(avg_participants_per_contest, 2) as avg_participants,
    ROUND(unique_participants::numeric / contests_held, 2) as participants_per_contest,
    ROUND(total_prizes_paid::numeric / NULLIF(total_prize_pool, 0) * 100, 2) as payout_percentage
FROM monthly_stats
ORDER BY month DESC;

-- Get contest profitability analysis
WITH contest_economics AS (
    SELECT
        c.id,
        c.name,
        c.entry_fee,
        c.participant_count,
        c.prize_pool,
        SUM(cp.prize_amount) as total_payouts,
        c.entry_fee * c.participant_count as total_entry_fees,
        (c.entry_fee * c.participant_count) - SUM(cp.prize_amount) as platform_revenue
    FROM contests c
    LEFT JOIN contest_participants cp ON cp.contest_id = c.id
    WHERE c.status = 'completed'
    GROUP BY c.id, c.name, c.entry_fee, c.participant_count, c.prize_pool
)
SELECT
    name as contest_name,
    participant_count,
    entry_fee,
    prize_pool,
    total_payouts,
    platform_revenue,
    ROUND(platform_revenue::numeric / NULLIF(total_entry_fees, 0) * 100, 2) as profit_margin_percentage,
    ROUND(total_payouts::numeric / participant_count, 2) as avg_payout_per_participant
FROM contest_economics
ORDER BY platform_revenue DESC;

-- Get user retention in contests
WITH user_contest_history AS (
    SELECT
        cp.wallet_address,
        COUNT(DISTINCT cp.contest_id) as contests_entered,
        COUNT(DISTINCT CASE WHEN cp.final_rank = 1 THEN cp.contest_id END) as contests_won,
        SUM(cp.prize_amount) as total_winnings,
        MIN(cp.joined_at) as first_contest,
        MAX(cp.joined_at) as last_contest,
        NOW() - MAX(cp.joined_at) as time_since_last_contest
    FROM contest_participants cp
    GROUP BY cp.wallet_address
)
SELECT
    CASE
        WHEN contests_entered = 1 THEN 'One-time'
        WHEN contests_entered BETWEEN 2 AND 5 THEN 'Casual'
        WHEN contests_entered BETWEEN 6 AND 20 THEN 'Regular'
        ELSE 'Power User'
    END as user_category,
    COUNT(*) as user_count,
    ROUND(AVG(contests_entered), 2) as avg_contests_per_user,
    ROUND(AVG(contests_won), 2) as avg_wins_per_user,
    ROUND(AVG(total_winnings), 2) as avg_winnings_per_user,
    ROUND(AVG(EXTRACT(EPOCH FROM (last_contest - first_contest))/86400), 2) as avg_engagement_days
FROM user_contest_history
GROUP BY
    CASE
        WHEN contests_entered = 1 THEN 'One-time'
        WHEN contests_entered BETWEEN 2 AND 5 THEN 'Casual'
        WHEN contests_entered BETWEEN 6 AND 20 THEN 'Regular'
        ELSE 'Power User'
    END
ORDER BY avg_contests_per_user DESC;

### Portfolio Performance

```sql
-- Get token performance by contest
WITH token_metrics AS (
    SELECT
        c.id as contest_id,
        c.name as contest_name,
        t.symbol as token_symbol,
        COUNT(DISTINCT cp.wallet_address) as times_selected,
        AVG(ctp.profit_loss) as avg_profit_loss,
        MIN(ctp.profit_loss) as worst_performance,
        MAX(ctp.profit_loss) as best_performance,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ctp.profit_loss) as median_performance
    FROM contests c
    JOIN contest_token_performance ctp ON ctp.contest_id = c.id
    JOIN tokens t ON t.id = ctp.token_id
    JOIN contest_portfolios cp ON 
        cp.contest_id = c.id AND 
        cp.token_id = t.id
    WHERE c.status = 'completed'
    GROUP BY c.id, c.name, t.symbol
)
SELECT
    contest_name,
    token_symbol,
    times_selected,
    ROUND(avg_profit_loss::numeric, 4) as avg_profit_loss,
    ROUND(worst_performance::numeric, 4) as worst_performance,
    ROUND(best_performance::numeric, 4) as best_performance,
    ROUND(median_performance::numeric, 4) as median_performance,
    ROUND(times_selected::numeric / SUM(times_selected) OVER (PARTITION BY contest_id) * 100, 2) as selection_percentage
FROM token_metrics
ORDER BY contest_id DESC, times_selected DESC;

-- Get portfolio diversity impact
WITH portfolio_metrics AS (
    SELECT
        cp.contest_id,
        cp.wallet_address,
        COUNT(DISTINCT cp.token_id) as unique_tokens,
        SUM(cp.weight) as total_weight,
        cp2.final_rank,
        cp2.prize_amount
    FROM contest_portfolios cp
    JOIN contest_participants cp2 ON 
        cp2.contest_id = cp.contest_id AND 
        cp2.wallet_address = cp.wallet_address
    GROUP BY cp.contest_id, cp.wallet_address, cp2.final_rank, cp2.prize_amount
)
SELECT
    unique_tokens as portfolio_size,
    COUNT(*) as participant_count,
    ROUND(AVG(final_rank), 2) as avg_final_rank,
    ROUND(AVG(CASE WHEN prize_amount > 0 THEN 1 ELSE 0 END) * 100, 2) as win_rate_percentage,
    ROUND(AVG(prize_amount), 2) as avg_prize_amount
FROM portfolio_metrics
GROUP BY unique_tokens
ORDER BY unique_tokens;

-- Get trading strategy analysis
WITH trade_patterns AS (
    SELECT
        cpt.wallet_address,
        cpt.contest_id,
        COUNT(*) as total_trades,
        COUNT(CASE WHEN cpt.type = 'BUY' THEN 1 END) as buy_trades,
        COUNT(CASE WHEN cpt.type = 'SELL' THEN 1 END) as sell_trades,
        AVG(EXTRACT(EPOCH FROM (cpt.executed_at - cpt.created_at))) as avg_execution_time,
        cp.final_rank,
        cp.prize_amount
    FROM contest_portfolio_trades cpt
    JOIN contest_participants cp ON 
        cp.contest_id = cpt.contest_id AND 
        cp.wallet_address = cpt.wallet_address
    GROUP BY cpt.wallet_address, cpt.contest_id, cp.final_rank, cp.prize_amount
)
SELECT
    CASE
        WHEN total_trades < 5 THEN 'Conservative'
        WHEN total_trades BETWEEN 5 AND 15 THEN 'Moderate'
        ELSE 'Active'
    END as trading_style,
    COUNT(*) as strategy_count,
    ROUND(AVG(total_trades), 2) as avg_trades,
    ROUND(AVG(buy_trades::numeric / NULLIF(total_trades, 0)) * 100, 2) as buy_percentage,
    ROUND(AVG(avg_execution_time), 2) as avg_execution_seconds,
    ROUND(AVG(final_rank), 2) as avg_final_rank,
    ROUND(AVG(prize_amount), 2) as avg_prize_amount
FROM trade_patterns
GROUP BY
    CASE
        WHEN total_trades < 5 THEN 'Conservative'
        WHEN total_trades BETWEEN 5 AND 15 THEN 'Moderate'
        ELSE 'Active'
    END
ORDER BY avg_prize_amount DESC;

### User Engagement Metrics

```sql
-- Get user activity patterns
WITH user_activity AS (
    SELECT
        u.wallet_address,
        u.created_at as join_date,
        COUNT(DISTINCT cp.contest_id) as contests_participated,
        COUNT(DISTINCT cpt.id) as total_trades,
        COUNT(DISTINCT DATE_TRUNC('day', cp.joined_at)) as active_days,
        NOW() - MAX(cp.joined_at) as days_since_last_activity,
        SUM(cp.prize_amount) as total_earnings,
        COUNT(DISTINCT r.id) as referrals_made
    FROM users u
    LEFT JOIN contest_participants cp ON cp.wallet_address = u.wallet_address
    LEFT JOIN contest_portfolio_trades cpt ON cpt.wallet_address = u.wallet_address
    LEFT JOIN referrals r ON r.referrer_id = u.wallet_address
    GROUP BY u.wallet_address, u.created_at
)
SELECT
    CASE
        WHEN days_since_last_activity < INTERVAL '7 days' THEN 'Active'
        WHEN days_since_last_activity < INTERVAL '30 days' THEN 'Recent'
        WHEN days_since_last_activity < INTERVAL '90 days' THEN 'Inactive'
        ELSE 'Dormant'
    END as user_status,
    COUNT(*) as user_count,
    ROUND(AVG(contests_participated), 2) as avg_contests,
    ROUND(AVG(total_trades), 2) as avg_trades,
    ROUND(AVG(active_days), 2) as avg_active_days,
    ROUND(AVG(total_earnings), 2) as avg_earnings,
    ROUND(AVG(referrals_made), 2) as avg_referrals
FROM user_activity
GROUP BY
    CASE
        WHEN days_since_last_activity < INTERVAL '7 days' THEN 'Active'
        WHEN days_since_last_activity < INTERVAL '30 days' THEN 'Recent'
        WHEN days_since_last_activity < INTERVAL '90 days' THEN 'Inactive'
        ELSE 'Dormant'
    END
ORDER BY user_count DESC;

-- Get user progression analysis
WITH user_progression AS (
    SELECT
        u.wallet_address,
        u.created_at,
        ul.level_number,
        COUNT(ua.id) as achievements_earned,
        COUNT(DISTINCT cp.contest_id) as contests_joined,
        SUM(cp.prize_amount) as total_earnings,
        EXTRACT(EPOCH FROM (NOW() - u.created_at))/86400 as account_age_days
    FROM users u
    LEFT JOIN user_levels ul ON ul.id = u.user_level_id
    LEFT JOIN user_achievements ua ON ua.wallet_address = u.wallet_address
    LEFT JOIN contest_participants cp ON cp.wallet_address = u.wallet_address
    GROUP BY u.wallet_address, u.created_at, ul.level_number
)
SELECT
    level_number,
    COUNT(*) as users_at_level,
    ROUND(AVG(achievements_earned), 2) as avg_achievements,
    ROUND(AVG(contests_joined), 2) as avg_contests,
    ROUND(AVG(total_earnings), 2) as avg_earnings,
    ROUND(AVG(account_age_days), 2) as avg_days_to_reach
FROM user_progression
GROUP BY level_number
ORDER BY level_number;

-- Get social engagement impact
WITH social_metrics AS (
    SELECT
        u.wallet_address,
        COUNT(DISTINCT usp.platform) as connected_platforms,
        COUNT(DISTINCT r.id) as referrals_made,
        COUNT(DISTINCT cp.contest_id) as contests_joined,
        SUM(cp.prize_amount) as total_earnings
    FROM users u
    LEFT JOIN user_social_profiles usp ON usp.wallet_address = u.wallet_address
    LEFT JOIN referrals r ON r.referrer_id = u.wallet_address
    LEFT JOIN contest_participants cp ON cp.wallet_address = u.wallet_address
    GROUP BY u.wallet_address
)
SELECT
    connected_platforms,
    COUNT(*) as user_count,
    ROUND(AVG(referrals_made), 2) as avg_referrals,
    ROUND(AVG(contests_joined), 2) as avg_contests,
    ROUND(AVG(total_earnings), 2) as avg_earnings,
    ROUND(SUM(referrals_made)::numeric / COUNT(*), 2) as referrals_per_user
FROM social_metrics
GROUP BY connected_platforms
ORDER BY connected_platforms;
```

[Continue with more cookbook examples...] 