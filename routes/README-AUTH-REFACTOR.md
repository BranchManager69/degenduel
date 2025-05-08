# Authentication System Refactoring Guide

This document describes the refactoring of the DegenDuel authentication system from a monolithic file to a modular architecture.

## Refactoring Goals

1. **Modularity**: Break down the 3400+ line auth.js file into smaller, focused modules
2. **Consistency**: Standardize authentication patterns across all methods
3. **Security**: Include user.id in JWT payloads and implement refresh tokens throughout
4. **Maintainability**: Improve code organization and reusability

## New Structure

### Helper Module
- `utils/auth-helpers.js`: Central utilities for all auth operations

### Auth Route Modules
- `routes/auth.js`: Main router that combines all auth modules
- `routes/auth-wallet.js`: Wallet-based authentication
- `routes/auth-session.js`: Session management (refresh, logout, etc.)
- `routes/auth-privy.js`: Privy-based authentication
- `routes/auth-social.js`: Social authentication (Twitter, Discord)
- `routes/auth-dev.js`: Development-only auth endpoints
- `routes/auth-biometric.js`: Biometric authentication

## Implementation Steps

1. Create auth-helpers.js with centralized authentication utilities
2. Create each auth module with relevant routes from the original file
3. Update the main auth.js to mount all modular routers
4. Test each module independently
5. Replace the old auth.js with the refactored version

## Guidelines for Adding Routes

1. Each route should go in the most appropriate module file
2. Use the auth helpers consistently for token generation and cookie management
3. Maintain the same API contract for backward compatibility
4. Include user.id in all token payloads
5. Implement refresh tokens for all authentication methods

## API Changes

- All authentication responses now include user.id in the returned user object
- JWT tokens now consistently include user.id in the payload
- No changes to endpoint URLs or request formats

## Refresh Token Implementation

Each authentication method now:
1. Creates a refresh token on successful authentication
2. Stores the hashed token in the database
3. Sets both access token and refresh token cookies

## Testing

Test the following scenarios after refactoring:
1. All authentication methods (wallet, Privy, Twitter, biometric)
2. Token refresh flow for each method
3. Logout and token revocation
4. Session expiration handling