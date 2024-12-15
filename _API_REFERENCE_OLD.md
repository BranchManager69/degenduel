
# API Cheatsheet

This cheatsheet provides an overview of the API endpoints for authentication, contests, leaderboard, statistics, trades, and user management. Each section includes endpoint descriptions, request parameters, and response details.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Contests](#contests)
3. [Leaderboard](#leaderboard)
4. [User Statistics](#user-statistics)
5. [Trades](#trades)
6. [Users](#users)

---

## 1. Authentication

### POST `/api/auth/verify-wallet`
**Description:** Verify a wallet signature.
**Request Body:**
```json
{
  "wallet": "string",
  "signature": "string",
  "message": "string"
}
```
**Responses:**
- `200`: Signature verified successfully.
- `500`: Server error during verification.

---

### POST `/api/auth/connect`
**Description:** Connect wallet and create/update user.
**Request Body:**
```json
{
  "wallet_address": "string",
  "nickname": "string"
}
```
**Responses:**
- `200`: User connected successfully.
- `500`: Server error.

---

### POST `/api/auth/disconnect`
**Description:** Disconnect wallet.
**Request Body:**
```json
{
  "wallet": "string"
}
```
**Responses:**
- `200`: Wallet disconnected successfully.
- `500`: Server error.

---

## 2. Contests

### GET `/api/contests/active`
**Description:** Get all active contests.
**Query Parameters:**
- `wallet` *(optional)*: User's wallet address.
**Responses:**
- `200`: List of active contests.
- `500`: Server error.

---

### GET `/api/contests/{contestId}`
**Description:** Get contest details by ID.
**Path Parameters:**
- `contestId`: ID of the contest.
**Responses:**
- `200`: Contest details.
- `404`: Contest not found.
- `500`: Server error.

---

### POST `/api/contests/{contestId}/enter`
**Description:** Enter a contest.
**Path Parameters:**
- `contestId`: ID of the contest.
**Request Body:**
```json
{
  "wallet": "string"
}
```
**Responses:**
- `200`: Successfully entered contest.
- `500`: Contest already started or server error.

---

### GET `/api/contests/{contestId}/leaderboard`
**Description:** Get contest leaderboard.
**Path Parameters:**
- `contestId`: ID of the contest.
**Responses:**
- `200`: Leaderboard data.
- `500`: Server error.

---

## 3. Leaderboard

### GET `/api/leaderboard`
**Description:** Get global leaderboard.
**Query Parameters:**
- `timeframe` *(default: `all`)*: Allowed values: `all`, `month`, `week`.
- `limit` *(default: `10`)*: Number of records to return.
- `offset` *(default: `0`)*: Number of skipped records.
**Responses:**
- `200`: List of top performers.
- `400`: Invalid parameters.
- `500`: Server error.

---

### POST `/api/leaderboard`
**Description:** Add a new score to the leaderboard.
**Request Body:**
```json
{
  "wallet_address": "string",
  "score": 0,
  "contest_id": "string"
}
```
**Responses:**
- `201`: Score added successfully.
- `400`: Invalid score data.
- `401`: Unauthorized.
- `500`: Server error.

---

## 4. User Statistics

### GET `/api/stats/{wallet}`
**Description:** Get a user's overall statistics.
**Path Parameters:**
- `wallet`: User's wallet address.
**Responses:**
- `200`: User statistics.
- `404`: User not found.
- `500`: Server error.

---

### GET `/api/stats/{wallet}/history`
**Description:** Get a user's trading history.
**Path Parameters:**
- `wallet`: User's wallet address.
**Query Parameters:**
- `limit` *(default: `10`)*: Number of records.
- `offset` *(default: `0`)*: Number of skipped records.
**Responses:**
- `200`: User's contest history.
- `500`: Server error.

---

### GET `/api/stats/{wallet}/achievements`
**Description:** Get a user's achievements.
**Path Parameters:**
- `wallet`: User's wallet address.
**Responses:**
- `200`: Achievements data.
- `500`: Server error.

---

## 5. Trades

### POST `/api/trades/{contestId}`
**Description:** Submit a new trade for a contest.
**Path Parameters:**
- `contestId`: ID of the contest.
**Request Body:**
```json
{
  "wallet": "string",
  "token_id": "string",
  "type": "buy",
  "amount": 0
}
```
**Responses:**
- `200`: Trade submitted successfully.
- `400`: Invalid parameters.
- `500`: Server error.

---

## 6. Users

### GET `/api/users`
**Description:** Get all users.
**Responses:**
- `200`: List of users.

---

### POST `/api/users`
**Description:** Create a new user.
**Request Body:**
```json
{
  "wallet_address": "string",
  "nickname": "string"
}
```
**Responses:**
- `201`: User created successfully.
- `400`: Missing required fields.

---

### GET `/api/users/{wallet}`
**Description:** Get a user by wallet address.
**Path Parameters:**
- `wallet`: Wallet address of the user.
**Responses:**
- `200`: User data.
- `404`: User not found.

---

### PUT `/api/users/{wallet}`
**Description:** Update a user profile.
**Path Parameters:**
- `wallet`: Wallet address of the user.
**Request Body:**
```json
{
  "nickname": "string"
}
```
**Responses:**
- `200`: Profile updated successfully.
- `404`: User not found.

---

### PUT `/api/users/{wallet}/settings`
**Description:** Update a user's settings.
**Path Parameters:**
- `wallet`: Wallet address of the user.
**Request Body:**
```json
{
  "settings": {}
}
```
**Responses:**
- `200`: Settings updated successfully.
- `404`: User not found.

---
