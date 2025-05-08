# Contest API Endpoints

This document provides a comprehensive guide to all contest-related API endpoints available in the DegenDuel platform.

## Table of Contents

1. [Base Endpoints](#base-endpoints)
2. [Participation Endpoints](#participation-endpoints)
3. [Admin Endpoints](#admin-endpoints)
4. [Leaderboard Endpoints](#leaderboard-endpoints)
5. [Portfolio Endpoints](#portfolio-endpoints)
6. [Schedule Endpoints](#schedule-endpoints)
7. [Error Handling](#error-handling)
8. [Response Formats](#response-formats)

## Base Endpoints

### List All Contests
```
GET /api/contests
```

Retrieves a paginated list of contests with optional filters.

**Query Parameters:**
- `status` (optional): Filter by contest status (`pending`, `active`, `completed`, `cancelled`)
- `limit` (optional): Number of contests to return (default: 10)
- `offset` (optional): Number of contests to skip (default: 0)
- `wallet_address` (optional): Adds an `is_participating` flag to each contest for the specified wallet

**Response:**
```json
{
  "contests": [
    {
      "id": 123,
      "name": "Weekly Trading Contest",
      "contest_code": "WTC-001",
      "description": "Compete in our weekly trading contest",
      "start_time": "2025-05-10T00:00:00Z",
      "end_time": "2025-05-17T23:59:59Z",
      "entry_fee": "1.00",
      "prize_pool": "100.00",
      "status": "pending",
      "min_participants": 2,
      "max_participants": 50,
      "allowed_buckets": [1, 2, 3, 4],
      "visibility": "public",
      "is_participating": false
    }
  ],
  "pagination": {
    "total": 45,
    "limit": 10,
    "offset": 0
  }
}
```

### Get Contest Details
```
GET /api/contests/:id
```

Retrieves detailed information about a specific contest.

**URL Parameters:**
- `id`: Contest ID

**Response:**
```json
{
  "id": 123,
  "name": "Weekly Trading Contest",
  "contest_code": "WTC-001",
  "description": "Compete in our weekly trading contest",
  "start_time": "2025-05-10T00:00:00Z",
  "end_time": "2025-05-17T23:59:59Z",
  "entry_fee": "1.00",
  "prize_pool": "100.00",
  "status": "pending",
  "min_participants": 2,
  "max_participants": 50,
  "allowed_buckets": [1, 2, 3, 4],
  "visibility": "public",
  "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
  "contest_participants": [
    {
      "wallet_address": "8xdJJ4fFeE...",
      "initial_balance": "1.00",
      "current_balance": "1.23",
      "rank": 3,
      "users": {
        "nickname": "CryptoWhale",
        "wallet_address": "8xdJJ4fFeE..."
      }
    }
  ],
  "contest_portfolios": [
    {
      "wallet_address": "8xdJJ4fFeE...",
      "token_id": 45,
      "weight": 50,
      "tokens": {
        "id": 45,
        "symbol": "SOL",
        "name": "Solana"
      }
    }
  ]
}
```

### Create Contest
```
POST /api/contests
```

Creates a new contest.

**Authentication:** Required

**Request Body:**
```json
{
  "name": "Weekly Trading Contest",
  "contest_code": "WTC-2025-05",
  "description": "Join our weekly trading competition",
  "entry_fee": "1.00",
  "start_time": "2025-05-10T00:00:00Z",
  "end_time": "2025-05-17T23:59:59Z",
  "min_participants": 2,
  "max_participants": 100,
  "allowed_buckets": [1, 2, 3],
  "visibility": "public"
}
```

**Response:**
```json
{
  "id": 123,
  "name": "Weekly Trading Contest",
  "contest_code": "WTC-2025-05",
  "description": "Join our weekly trading competition",
  "entry_fee": "1.00",
  "prize_pool": "1.00",
  "start_time": "2025-05-10T00:00:00Z",
  "end_time": "2025-05-17T23:59:59Z",
  "status": "pending",
  "min_participants": 2,
  "max_participants": 100,
  "allowed_buckets": [1, 2, 3],
  "visibility": "public",
  "created_by": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
  "created_at": "2025-05-08T10:30:45Z",
  "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo"
}
```

### Update Contest
```
PUT /api/contests/:id
```

Updates an existing contest.

**Authentication:** Required (SuperAdmin only)

**URL Parameters:**
- `id`: Contest ID

**Request Body:**
```json
{
  "name": "Updated Contest Name",
  "description": "Updated contest description",
  "entry_fee": "2.00",
  "start_time": "2025-05-15T00:00:00Z",
  "end_time": "2025-05-22T23:59:59Z",
  "min_participants": 5,
  "max_participants": 200,
  "allowed_buckets": [1, 2, 3, 4],
  "visibility": "public"
}
```

**Response:**
```json
{
  "contest": {
    "id": 123,
    "name": "Updated Contest Name",
    "description": "Updated contest description",
    "entry_fee": "2.00",
    "prize_pool": "1.00",
    "start_time": "2025-05-15T00:00:00Z",
    "end_time": "2025-05-22T23:59:59Z",
    "status": "pending",
    "min_participants": 5,
    "max_participants": 200,
    "allowed_buckets": [1, 2, 3, 4],
    "visibility": "public",
    "updated_at": "2025-05-08T11:45:30Z",
    "updated_by": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo"
  },
  "message": "Contest updated successfully"
}
```

## Participation Endpoints

### Enter Contest
```
POST /api/contests/:id/enter
```

Enter a contest by paying the entry fee.

**Authentication:** Required

**URL Parameters:**
- `id`: Contest ID

**Request Body:**
```json
{
  "transaction_signature": "5KtP9UcATixsA98XpuJL9YQHxiLZdPQsYSGRYSQZ98jxGVLHXv7QS4pUuQUfXKJPZNhwBxgJrz4dGFgZmh9mNfhf",
  "referral_code": "REF123" 
}
```

**Response:**
```json
{
  "participation": {
    "id": 456,
    "contest_id": 123,
    "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
    "initial_balance": "0",
    "current_balance": "0",
    "rank": 0,
    "entry_transaction": "5KtP9UcATixsA98XpuJL9YQHxiLZdPQsYSGRYSQZ98jxGVLHXv7QS4pUuQUfXKJPZNhwBxgJrz4dGFgZmh9mNfhf",
    "referral_code": "REF123",
    "status": "active",
    "created_at": "2025-05-08T12:30:15Z"
  },
  "message": "Successfully entered contest"
}
```

### Join Contest (Free)
```
POST /api/contests/:id/join
```

Join a free contest without paying an entry fee.

**Authentication:** Required

**URL Parameters:**
- `id`: Contest ID

**Request Body:**
```json
{
  "referral_code": "REF123" 
}
```

**Response:**
```json
{
  "participation": {
    "id": 456,
    "contest_id": 123,
    "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
    "initial_balance": "0",
    "current_balance": "0",
    "rank": 0,
    "referral_code": "REF123",
    "status": "active",
    "created_at": "2025-05-08T12:35:20Z"
  },
  "message": "Successfully joined contest"
}
```

### Check Participation
```
GET /api/contests/:id/check-participation?wallet_address=93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo
```

Check if a user is already participating in a contest.

**URL Parameters:**
- `id`: Contest ID

**Query Parameters:**
- `wallet_address`: Wallet address to check

**Response (if participating):**
```json
{
  "participating": true,
  "participation": {
    "id": 456,
    "contest_id": 123,
    "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
    "initial_balance": "0",
    "current_balance": "0",
    "rank": 0,
    "status": "active",
    "created_at": "2025-05-08T12:35:20Z"
  },
  "message": "User is participating in this contest"
}
```

**Response (if not participating):**
```json
{
  "participating": false,
  "can_participate": true,
  "message": "User can join this contest"
}
```

### Get User Participations
```
GET /api/contests/user-participations?wallet_address=93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo
```

Get all contests a user is participating in.

**Query Parameters:**
- `wallet_address`: Wallet address to check
- `status` (optional): Filter by contest status

**Response:**
```json
{
  "participations": [
    {
      "contest_id": 123,
      "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
      "initial_balance": "0",
      "current_balance": "0",
      "rank": 0,
      "final_rank": null,
      "prize_amount": null,
      "status": "active",
      "created_at": "2025-05-08T12:35:20Z",
      "contest": {
        "id": 123,
        "name": "Weekly Trading Contest",
        "description": "Join our weekly trading competition",
        "contest_code": "WTC-2025-05",
        "start_time": "2025-05-10T00:00:00Z",
        "end_time": "2025-05-17T23:59:59Z",
        "status": "pending",
        "entry_fee": "1.00",
        "prize_pool": "1.00",
        "participant_count": 3
      }
    }
  ],
  "total": 1
}
```

### Get Wallet Participations
```
GET /api/contests/participations/:wallet
```

Get all contest participations for a specific wallet.

**URL Parameters:**
- `wallet`: Wallet address

**Query Parameters:**
- `status` (optional): Filter by contest status

**Response:**
Same as `user-participations`

## Admin Endpoints

### Start Contest
```
POST /api/contests/:id/start
```

Start a contest in pending status.

**Authentication:** Required (Admin only)

**URL Parameters:**
- `id`: Contest ID

**Response:**
```json
{
  "contest": {
    "id": 123,
    "name": "Weekly Trading Contest",
    "status": "active",
    "started_at": "2025-05-08T14:00:00Z",
    "started_by": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo"
  },
  "message": "Contest started successfully"
}
```

### End Contest
```
POST /api/contests/:id/end
```

End an active contest and calculate final rankings.

**Authentication:** Required (Admin only)

**URL Parameters:**
- `id`: Contest ID

**Response:**
```json
{
  "contest": {
    "id": 123,
    "name": "Weekly Trading Contest",
    "status": "completed",
    "ended_at": "2025-05-08T14:30:00Z",
    "ended_by": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo"
  },
  "message": "Contest ended successfully"
}
```

## Leaderboard Endpoints

### Get Contest Leaderboard
```
GET /api/contests/:id/leaderboard
```

Get the leaderboard for a specific contest.

**URL Parameters:**
- `id`: Contest ID

**Query Parameters:**
- `limit` (optional): Number of entries to return (default: 100)
- `offset` (optional): Number of entries to skip (default: 0)

**Response:**
```json
{
  "contest": {
    "id": 123,
    "name": "Weekly Trading Contest",
    "status": "active",
    "participant_count": 25
  },
  "leaderboard": [
    {
      "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
      "initial_balance": "1.00",
      "current_balance": "1.35",
      "rank": 1,
      "final_rank": null,
      "prize_amount": null,
      "nickname": "CryptoWhale",
      "profile_image_url": "https://example.com/profile.jpg",
      "portfolio": [
        {
          "token_id": 45,
          "weight": 50,
          "token": {
            "id": 45,
            "symbol": "SOL",
            "name": "Solana",
            "logo_url": "https://example.com/sol.png"
          }
        }
      ]
    }
  ],
  "pagination": {
    "total": 25,
    "limit": 100,
    "offset": 0
  }
}
```

## Portfolio Endpoints

### Create/Update Portfolio
```
POST /api/contests/:id/portfolio
```

Create or update a portfolio for a contest.

**Authentication:** Required

**URL Parameters:**
- `id`: Contest ID

**Request Body:**
```json
{
  "selections": [
    {
      "token_id": 45,
      "weight": 50
    },
    {
      "token_id": 67,
      "weight": 30
    },
    {
      "token_id": 89,
      "weight": 20
    }
  ]
}
```

**Response:**
```json
{
  "portfolio": [
    {
      "contest_id": 123,
      "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
      "token_id": 45,
      "weight": 50,
      "tokens": {
        "id": 45,
        "symbol": "SOL",
        "name": "Solana"
      }
    },
    {
      "contest_id": 123,
      "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
      "token_id": 67,
      "weight": 30,
      "tokens": {
        "id": 67,
        "symbol": "JUP",
        "name": "Jupiter"
      }
    },
    {
      "contest_id": 123,
      "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
      "token_id": 89,
      "weight": 20,
      "tokens": {
        "id": 89,
        "symbol": "BONK",
        "name": "Bonk"
      }
    }
  ],
  "message": "Portfolio updated successfully"
}
```

### Get Portfolio
```
GET /api/contests/:id/portfolio/:wallet
```

Get a user's portfolio for a contest.

**Authentication:** Required

**URL Parameters:**
- `id`: Contest ID
- `wallet`: Wallet address

**Response:**
```json
{
  "wallet_address": "93kLpG8owoQwRUXcEftGujHR6K9ruQs4xFHK6Qmgg6Jo",
  "contest_id": 123,
  "initial_balance": "1.00",
  "current_balance": "1.35",
  "rank": 1,
  "portfolio": [
    {
      "token_id": 45,
      "weight": 50,
      "token": {
        "id": 45,
        "symbol": "SOL",
        "name": "Solana",
        "logo_url": "https://example.com/sol.png",
        "price": "150.75",
        "price_change_24h": "3.5"
      }
    },
    {
      "token_id": 67,
      "weight": 30,
      "token": {
        "id": 67,
        "symbol": "JUP",
        "name": "Jupiter",
        "logo_url": "https://example.com/jup.png",
        "price": "1.25",
        "price_change_24h": "-0.8"
      }
    },
    {
      "token_id": 89,
      "weight": 20,
      "token": {
        "id": 89,
        "symbol": "BONK",
        "name": "Bonk",
        "logo_url": "https://example.com/bonk.png",
        "price": "0.000012",
        "price_change_24h": "12.5"
      }
    }
  ]
}
```

## Schedule Endpoints

### Get Contest Schedules
```
GET /api/contests/schedules
```

Get all public contest schedules.

**Response:**
```json
{
  "schedules": [
    {
      "id": 1,
      "name": "Weekly Trading Contest",
      "description": "Recurring weekly trading contest",
      "frequency": "weekly",
      "day_of_week": 1,
      "hour": 0,
      "minute": 0,
      "duration_hours": 168,
      "entry_fee": "1.00",
      "min_participants": 2,
      "max_participants": 100,
      "allowed_buckets": [1, 2, 3, 4],
      "visibility": "public",
      "active": true,
      "created_at": "2025-05-01T12:00:00Z",
      "next_occurrences": [
        {
          "id": 5,
          "schedule_id": 1,
          "scheduled_start_time": "2025-05-12T00:00:00Z",
          "scheduled_end_time": "2025-05-19T00:00:00Z",
          "contest_id": null,
          "status": "pending"
        }
      ]
    }
  ],
  "total": 1
}
```

### Get Schedule Details
```
GET /api/contests/schedules/:id
```

Get details of a specific contest schedule.

**URL Parameters:**
- `id`: Schedule ID

**Response:**
```json
{
  "schedule": {
    "id": 1,
    "name": "Weekly Trading Contest",
    "description": "Recurring weekly trading contest",
    "frequency": "weekly",
    "day_of_week": 1,
    "hour": 0,
    "minute": 0,
    "duration_hours": 168,
    "entry_fee": "1.00",
    "min_participants": 2,
    "max_participants": 100,
    "allowed_buckets": [1, 2, 3, 4],
    "visibility": "public",
    "active": true,
    "created_at": "2025-05-01T12:00:00Z",
    "next_occurrences": [
      {
        "id": 5,
        "schedule_id": 1,
        "scheduled_start_time": "2025-05-12T00:00:00Z",
        "scheduled_end_time": "2025-05-19T00:00:00Z",
        "contest_id": null,
        "status": "pending"
      }
    ],
    "contest_count": 12
  }
}
```

## Error Handling

All endpoints follow a consistent error format:

```json
{
  "error": "error_code",
  "message": "Human-readable error message",
  "details": "Additional error details (optional)"
}
```

Common error codes:
- `not_found`: Resource not found
- `invalid_request`: Invalid request parameters
- `unauthorized`: Authentication required
- `forbidden`: Insufficient permissions
- `contest_full`: Contest has reached maximum participants
- `already_participating`: User is already participating in this contest
- `invalid_status`: Contest is in wrong status for operation
- `invalid_token`: Token verification failed
- `invalid_transaction`: Transaction verification failed
- `insufficient_credits`: Not enough credits to create contest

## Response Formats

All successful responses follow these patterns:

### List Endpoints
```json
{
  "items": [...],  // Array of items with specific name (e.g., "contests")
  "pagination": {
    "total": 100,
    "limit": 10,
    "offset": 0
  }
}
```

### Detail Endpoints
Either returns the object directly or with a wrapper:

```json
{
  "id": 123,
  "name": "Item Name",
  "other_properties": "values"
}
```

Or:

```json
{
  "item": {        // Named appropriately (e.g., "contest")
    "id": 123,
    "name": "Item Name",
    "other_properties": "values"
  },
  "message": "Success message"  // Optional
}
```

### Action Endpoints
```json
{
  "item": {        // The affected item
    "id": 123,
    "updated_property": "new value" 
  },
  "message": "Success message"
}
```

---

This API documentation covers all available contest endpoints. For any questions or issues, please contact the backend team.