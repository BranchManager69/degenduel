
# DegenDuel API Endpoints Cheatsheet

A concise reference of all implemented API endpoints for the DegenDuel platform, complete with syntax and descriptions.

## Authentication

- **POST** `/api/auth/verify-wallet`  
  Verify a wallet signature to confirm user identity.

- **POST** `/api/auth/connect`  
  Connect a wallet and create or update a user in the system.

- **POST** `/api/auth/disconnect`  
  Disconnect a wallet from the user's session.

## Contests

- **GET** `/api/contests`  
  Retrieve all contests with optional filters (e.g., status).

- **POST** `/api/contests`  
  Create a new contest with details such as name, entry fee, and prize pool.

- **GET** `/api/contests/summary`  
  Get a summary of contest data along with participation details.

- **GET** `/api/contests/active`  
  Fetch all currently active contests.

- **GET** `/api/contests/{contestId}`  
  Retrieve details for a specific contest by ID.

- **DELETE** `/api/contests/{contestId}`  
  Delete a contest by its ID.

- **PATCH** `/api/contests/{contestId}`  
  Update contest details such as status or description.

- **POST** `/api/contests/{contestId}/enter`  
  Enter a contest by providing the contest ID and user wallet.

- **GET** `/api/contests/{contestId}/leaderboard`  
  Fetch the leaderboard for a specific contest.

## Leaderboard

- **GET** `/api/leaderboard`  
  Retrieve the global leaderboard showing top-ranked users.

- **POST** `/api/leaderboard`  
  Add a new score entry to the global leaderboard.

## Statistics

- **GET** `/api/stats/{wallet}`  
  Fetch overall statistics for a user by wallet address.

- **GET** `/api/stats/{wallet}/history`  
  Retrieve a user's trading history.

- **GET** `/api/stats/{wallet}/achievements`  
  Get a user's achievements and milestones.

## Test

- **POST** `/api/test/test-user`  
  Create a test user for development purposes.

- **PUT** `/api/test/test-user/{wallet}`  
  Update the rank score for a specific test user.

- **PUT** `/api/test/test-user/{wallet}/settings`  
  Update settings for a specific test user.

- **PUT** `/api/test/test-user/{wallet}/profile`  
  Update multiple fields for a test user's profile.

## Token Buckets

- **POST** `/api/token-buckets`  
  Create a new token bucket.

- **GET** `/api/token-buckets`  
  Retrieve all token buckets and their associated tokens.

- **POST** `/api/token-buckets/{bucketId}/tokens`  
  Add tokens to a specific bucket.

- **DELETE** `/api/token-buckets/{bucketId}/tokens/{tokenId}`  
  Remove a token from a specific bucket.

## Tokens

- **POST** `/api/tokens`  
  Add a new token to the system.

- **GET** `/api/tokens`  
  Fetch all tokens with optional filters.

- **GET** `/api/tokens/{tokenId}`  
  Retrieve details for a specific token by its ID.

- **PUT** `/api/tokens/{tokenId}`  
  Update details for a specific token.

- **PATCH** `/api/tokens/{tokenId}/status`  
  Enable or disable a specific token.

## Trades

- **POST** `/api/trades/{contestId}`  
  Submit a new trade for a specific contest.

- **GET** `/api/trades/{contestId}`  
  Retrieve all trades made by a user in a specific contest.

## Users

- **GET** `/api/users`  
  Retrieve all users.

- **POST** `/api/users`  
  Create a new user.

- **GET** `/api/users/{wallet}`  
  Retrieve details for a user by their wallet address.

- **PUT** `/api/users/{wallet}`  
  Update a user's profile details.

- **PUT** `/api/users/{wallet}/settings`  
  Update settings for a specific user.
