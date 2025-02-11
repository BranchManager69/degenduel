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
User referral tracking system.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Referral ID | Primary Key, Auto-increment |
| referrer_address | VARCHAR(44) | Referrer's wallet | Not Null, Foreign Key |
| referred_address | VARCHAR(44) | Referred user's wallet | Not Null, Foreign Key |
| referral_code | TEXT | Unique referral code | Not Null |
| status | TEXT | Referral status | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_referrals_referrer` (referrer_address)
- `idx_referrals_referred` (referred_address)
- `idx_referrals_code` (referral_code)

### Referral Rewards (`referral_rewards`)
Rewards earned through referrals.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Reward ID | Primary Key, Auto-increment |
| referral_id | INTEGER | Reference to referral | Not Null, Foreign Key |
| reward_type | TEXT | Type of reward | Not Null |
| reward_amount | DECIMAL(20,0) | Reward amount | Not Null |
| status | TEXT | Reward status | Not Null |
| claimed_at | TIMESTAMPTZ | Claim timestamp | |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| transaction_hash | TEXT | Blockchain tx hash | |
| metadata | JSONB | Additional data | Default: '{}' |

#### Indexes
- `idx_referral_rewards_referral` (referral_id)
- `idx_referral_rewards_status` (status)

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

### Contest Templates (`contest_templates`)
Reusable contest configurations.

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| id | INTEGER | Template ID | Primary Key, Auto-increment |
| name | TEXT | Template name | Not Null |
| description | TEXT | Template description | |
| duration_hours | INTEGER | Contest duration | Not Null |
| entry_fee | DECIMAL(20,0) | Default entry fee | Not Null |
| min_participants | INTEGER | Minimum participants | Not Null |
| max_participants | INTEGER | Maximum participants | Not Null |
| created_at | TIMESTAMPTZ | Creation time | Default: CURRENT_TIMESTAMP |
| updated_at | TIMESTAMPTZ | Last update | |
| metadata | JSONB | Additional data | Default: '{}' |

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