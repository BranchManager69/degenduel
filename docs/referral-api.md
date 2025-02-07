# DegenDuel Referral System API

The referral system allows users to invite others to DegenDuel and earn rewards for successful referrals.

## Endpoints

### Get Referral Code
```http
GET /api/referrals/code
```

Retrieves or generates a referral code for the authenticated user.

**Authentication Required**: Yes

**Response**:
```json
{
    "referral_code": "USERNAME123"
}
```

### Get Referral Statistics
```http
GET /api/referrals/stats
```

Retrieves referral statistics and history for the authenticated user.

**Authentication Required**: Yes

**Response**:
```json
{
    "total_referrals": 10,
    "qualified_referrals": 5,
    "pending_referrals": 3,
    "total_rewards": 1000,
    "recent_referrals": [
        {
            "username": "user123",
            "status": "qualified",
            "joined_at": "2024-03-21T00:00:00Z"
        }
    ],
    "recent_rewards": [
        {
            "type": "signup_bonus",
            "amount": 100,
            "date": "2024-03-21T00:00:00Z",
            "description": "New user signup bonus"
        }
    ]
}
```

### Apply Referral Code
```http
POST /api/referrals/apply
```

Applies a referral code during user registration.

**Authentication Required**: No

**Request Body**:
```json
{
    "referral_code": "USERNAME123",
    "wallet_address": "solana_wallet_address"
}
```

**Response**:
```json
{
    "success": true,
    "message": "Referral code applied successfully"
}
```

## Referral Status Types

- `pending`: User has signed up but hasn't met qualification criteria
- `qualified`: User has met the qualification criteria (e.g., joined first contest)
- `rewarded`: Referral reward has been paid to the referrer
- `expired`: Referral expired without meeting qualification criteria

## Reward Types

- `signup_bonus`: Initial reward for referring a new user
- `contest_bonus`: Bonus when referred users participate in contests
- `special_event`: Rewards from special promotional events

## Error Responses

All endpoints may return the following error responses:

```json
{
    "error": "Error message description"
}
```

Common error status codes:
- `400`: Bad Request (missing or invalid parameters)
- `401`: Unauthorized (authentication required)
- `404`: Not Found (invalid referral code)
- `500`: Internal Server Error

## Implementation Notes

1. Referral codes can be either:
   - User's username (uppercase, max 16 chars)
   - Random generated code (8 chars)

2. Each user can only be referred once

3. Referral link format:
   ```
   https://degenduel.me/join?ref=REFERRAL_CODE
   ```

4. The referral system is integrated with the transaction system for reward payouts

5. Indexes are optimized for:
   - Referral code lookups
   - User referral history
   - Reward tracking

## Database Schema

The referral system uses three main database components:

1. User referral fields:
   - `referral_code`: Unique code for referring others
   - `referred_by_code`: Code used when signing up

2. Referrals table:
   - Tracks referral relationships
   - Maintains referral status
   - Records qualification and reward details

3. Referral rewards table:
   - Tracks all referral-related rewards
   - Links to transaction system
   - Supports multiple reward types 