# Dialect Blinks Implementation Guide for DegenDuel

## Overview

This document describes the implementation of [Dialect Blinks](https://docs.dialect.to/blinks) (Solana Actions) for the DegenDuel platform. Blinks provides a standardized way to enable one-click actions for Solana dApps.

## Implementation Structure

The implementation consists of the following components:

1. **Blinks Registry Service**: A service for registering and managing blinks
2. **Blinks Routes**: API endpoints for serving blink metadata and handling transactions
3. **Database Schema**: Tables for tracking blink usage and authentication

## Component Details

### 1. Dialect Service

- **Location**: `/services/dialect/index.js`
- **Purpose**: Manages Dialect SDK integration and blinks registry
- **Features**:
  - Initializes Dialect SDK and provider registration
  - Registers default blinks
  - Tracks blink usage
  - Handles OAuth authentication flow

### 2. Blinks Registry

- **Location**: `/services/dialect/blinks-registry.js`
- **Purpose**: Core implementation of blinks registry functionality
- **Features**:
  - Register, update, and delete blinks
  - Find blinks by ID
  - Cache blinks for performance

### 3. Blinks Routes

- **Location**: `/routes/blinks/index.js`
- **Purpose**: API endpoints for blinks
- **Endpoints**:
  - `GET /api/blinks/join-contest`: Metadata for contest entry blink
  - `POST /api/blinks/join-contest`: Transaction generation for contest entry
  
### 4. Blinks Auth Routes

- **Location**: `/routes/blinks/auth.js`
- **Purpose**: Handle authentication for Dialect integration
- **Endpoints**:
  - `POST /api/blinks/auth/init`: Initialize OAuth flow
  - `GET /api/blinks/auth/callback`: Handle OAuth callback
  - `GET /api/blinks/auth/status`: Check authentication status

### 5. Database Schema

Two new tables have been added to the database:

- **dialect_auth_tokens**: Stores authentication tokens for Dialect
- **dialect_blinks_usage**: Tracks usage of blinks for analytics

## Registered Blinks

DegenDuel registers the following blinks by default:

1. **Join Contest**: Allows users to join a contest with an AI-selected portfolio
2. **View Contest**: Opens a contest for viewing
3. **View Results**: Shows contest results
4. **Place Token Bet**: Places a bet on a specific token

## Configuration

Configuration is stored in `config/config.js` under the `dialect` section:

```javascript
dialect: {
  // Wallet private key for signing Dialect provider registration
  walletPrivateKey: process.env.DIALECT_WALLET_PRIVATE_KEY || process.env.WALLET_ENCRYPTION_KEY,
  // Dialect API key
  apiKey: process.env.DIALECT_API_KEY || '',
  // Environment (development or production)
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  // Provider configuration
  provider: {
    name: 'DegenDuel',
    description: 'DegenDuel Contest & Trading Platform',
    websiteUrl: 'https://degenduel.me',
    iconUrl: 'https://degenduel.me/images/logo192.png',
    termsUrl: 'https://degenduel.me/terms',
    oauthRedirectUrl: 'https://degenduel.me/api/blinks/auth/callback',
    blinksInstructionsUrl: 'https://degenduel.me/docs/blinks'
  }
},
```

## Integration with Frontend

Frontend applications can use the blinks by adding data attributes to HTML elements:

```html
<button
  onClick={handleJoinContest}
  data-solana-action="true"
  data-action-title="Join Contest with AI Portfolio"
  data-action-url="https://degenduel.me/api/blinks/join-contest?contest_id=${contest.id}"
  className="w-full relative group overflow-hidden text-sm py-4 shadow-lg shadow-brand-500/20 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-bold"
>
  <span className="font-medium">Join with AI Portfolio</span>
</button>
```

## Future Enhancements

1. **Additional Blinks**: Add more blinks for common actions like token swaps
2. **Analytics Dashboard**: Create an admin dashboard for blink usage analytics
3. **Wallet-Specific Actions**: Customize blinks based on user wallet activity
4. **Deep Integration**: Integrate with wallet-connect protocols for better mobile experience

## Troubleshooting

Common issues:

1. **SDK Import Errors**: The Dialect SDK may have compatibility issues with ES modules. We've implemented a graceful fallback to mock implementations if imports fail.
2. **Authentication Errors**: OAuth flow errors can occur if redirects aren't properly configured.
3. **Transaction Errors**: Ensure the wallet has enough SOL for transactions.

## References

- [Dialect Blinks Documentation](https://docs.dialect.to/blinks)
- [Solana Actions Documentation](https://www.solana.com/actions)
- [DegenDuel API Documentation](https://degenduel.me/api-docs)