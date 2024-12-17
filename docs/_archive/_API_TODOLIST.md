
# API Endpoints Checklist for DegenDuel

## Tokens
- [x] **Add a token** (`POST /api/tokens`)
- [x] **Get all tokens** (`GET /api/tokens`)
- [x] **Get token by ID** (`GET /api/tokens/{tokenId}`)
- [x] **Update token** (`PUT /api/tokens/{tokenId}`)
- [x] **Update token status** (`PATCH /api/tokens/{tokenId}/status`)

## Token Buckets
- [x] **Create a bucket** (`POST /api/token-buckets`)
- [x] **Get all buckets** (`GET /api/token-buckets`)
- [x] **Add tokens to a bucket** (`POST /api/token-buckets/{bucketId}/tokens`)
- [x] **Remove a token from a bucket** (`DELETE /api/token-buckets/{bucketId}/tokens/{tokenId}`)

## Contests
- [x] **CRUD for contests** (create, read, update, delete)
- [x] **Enter a contest** (`POST /api/contests/{contestId}/enter`)
- [x] **Contest leaderboard** (`GET /api/contests/{contestId}/leaderboard`)

## Token Prices
- [ ] **Fetch token prices** (`GET /api/token-prices`)
- [ ] **Update token price** (`PATCH /api/token-prices/{tokenId}`)

## Contest Token Prices
- [ ] **Get token prices for a contest** (`GET /api/contests/{contestId}/token-prices`)
- [ ] **Update token prices for a contest** (`POST /api/contests/{contestId}/token-prices`)

## Contest Participants
- [ ] **Get all participants for a contest** (`GET /api/contests/{contestId}/participants`)
- [ ] **Get details for a specific participant** (`GET /api/contests/{contestId}/participants/{walletAddress}`)

## Contest Token Performance
- [ ] **Fetch contest token performance** (`GET /api/contests/{contestId}/performance`)
- [ ] **Fetch specific user performance in a contest** (`GET /api/contests/{contestId}/performance/{walletAddress}`)
