# DegenDuel Authentication Flow Documentation

## Authentication Methods

DegenDuel supports multiple authentication methods:

1. **Web3 Wallet Authentication** (Primary Method)
   - Direct wallet connection and signature
   - Used for account creation and login
   - Endpoint: `/api/auth/verify-wallet`

2. **Privy Authentication** (Primary/Secondary Method)
   - Email, social login, or passkeys through Privy
   - Can create accounts (if `auto_create_accounts=true`) or link to existing ones
   - Endpoints: 
     - `/api/auth/verify-privy` - Login/registration
     - `/api/auth/link-privy` - Account linking

3. **Twitter Authentication** (Secondary Method)
   - Social authentication via Twitter
   - Only for linking to existing accounts (no direct registration)
   - Endpoints:
     - `/api/auth/twitter/login` - Start Twitter OAuth
     - `/api/auth/twitter/callback` - OAuth callback
     - `/api/auth/twitter/link` - Link Twitter to existing account

4. **Biometric Authentication**
   - Fingerprint/Face ID authentication using WebAuthn
   - Supports cross-device usage via Passkeys
   - Endpoints:
     - `/api/auth/biometric/register-options` - Get registration options
     - `/api/auth/biometric/register-verify` - Verify registration
     - `/api/auth/biometric/auth-options` - Get auth options
     - `/api/auth/biometric/auth-verify` - Verify biometric auth
     
5. **QR Code Authentication**
   - Cross-device authentication using QR codes
   - Allows login on new devices using authenticated mobile device
   - Endpoints:
     - `/api/auth/qr/generate` - Generate QR code
     - `/api/auth/qr/verify/:token` - Verify from mobile device
     - `/api/auth/qr/poll/:token` - Poll status from web
     - `/api/auth/qr/complete/:token` - Complete auth on web

## Authentication Status

All authentication methods are tracked through the unified status endpoint:
- `/api/auth/status` - Returns comprehensive auth status

## Detailed Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     DegenDuel Platform                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Methods                    │
└───────┬─────────────────┬─────────────────┬─────────────────┘
        │                 │                 │         ┌ ─ ─ ─ ─ ─ ─ ─ ┐
        ▼                 ▼                 ▼         ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌ ─ ─ ─ ─ ─ ─ ┐
│  Web3 Wallet  │ │     Privy     │ │    Twitter    │ │  Biometric   │
│ Authentication│ │ Authentication│ │ Authentication│ │  (Upcoming)  │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘ └ ─ ─ ─┬─ ─ ─ ┘
        │                 │                 │               │
        │ /verify-wallet  │ /verify-privy   │ /twitter/login │ /verify-biometric
        │                 │                 │               │ (planned)
        ▼                 ▼                 ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Authentication Verification                │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ JWT Token + Cookie
                            │ Session Creation
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Account Check                           │
└───────┬─────────────────────────────────────┬───────────────┘
        │                                     │
        │ Account Exists                      │ No Account
        │                                     │
        ▼                                     ▼
┌───────────────────┐                 ┌───────────────────────────────────┐
│                   │                 │         Create Account?            │
│     Log In        │                 │                                    │
│                   │                 │  Web3 ✓  Privy ✓  Twitter ✗       │
│                   │                 │                     ┌ ─ ─ ─ ─ ─ ┐  │
│                   │                 │                     │ Biometric ✓│  │
│                   │                 │                     │ (custodial)│  │
└───────┬───────────┘                 └─────────┬───────────└ ─ ─ ─ ─ ─ ┘ ─┘
        │                                       │
        │                                       │ If allowed method
        │                                       │ (auto_create=true for Privy)
        │                                       │ (creates managed wallet for biometric)
        │                                       │
        │                                       ▼
        │                             ┌───────────────────┐
        │                             │                   │
        │                             │  Create Account   │
        │                             │                   │
        │                             └─────────┬─────────┘
        │                                       │
        └───────────────────┬───────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Authenticated User                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            │ Optional: Link Additional
                            │ Authentication Methods
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Account Linking Options                     │
├───────────────────┬───────────────────┬─────────────────────┤
│                   │                   │                     │
│  /link-privy      │  /twitter/link    │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│  Link Privy       │  Link Twitter     │ │ /register-biometric│
│  Account          │  Account          │ │ Link Biometric    │
│                   │                   │ └ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
└───────────────────┴───────────────────┴─────────────────────┘

            │                                    │
            ▼                                    ▼
┌───────────────────────┐            ┌───────────────────────┐
│                       │            │                       │
│   Auth Status Check   │◄───────────│   Use DegenDuel App   │
│   /api/auth/status    │            │                       │
│                       │            │                       │
└───────────────────────┘            └───────────────────────┘
```

## Authentication Method Comparison

| Feature              | Web3 Wallet | Privy         | Twitter      | Biometric (Planned) |
|----------------------|-------------|---------------|--------------|---------------------|
| Account Creation     | ✓ Yes       | ✓ Yes*        | ✗ No         | ✓ Yes‡              |
| Login to Account     | ✓ Yes       | ✓ Yes         | ✓ Yes        | ✓ Yes               |
| Link to Account      | N/A         | ✓ Yes         | ✓ Yes        | ✓ Yes               |
| Required for Account | ✓ Yes**     | ✓ Optional**  | ✗ No         | ✓ Optional**        |
| Custodial Wallet     | ✗ No        | ✗ No          | ✗ No         | ✓ Yes               |
| Device-Specific      | ✗ No        | Varies†       | ✗ No         | ✓ Yes               |

\* *Privy can create accounts if `auto_create_accounts=true` in config*  
\** *One of: Web3 Wallet, Privy, or Biometric is required for account creation*  
\† *Privy can use passkeys which are device-specific, but also supports email which is not*  
\‡ *Creates a custodial wallet managed by DegenDuel*

## Implementation Notes

1. **Cookies and JWT Tokens**
   - All authentication methods set the same JWT cookie (`session`)
   - Cookie is HTTP-only, secure, and same-site for security
   - Standard expiration of 12 hours

2. **Device Authorization**
   - Optional device tracking with all auth methods
   - First device auto-authorized if configured
   - Subsequent devices may require explicit authorization
   - Biometric authentication is inherently tied to specific devices

3. **Security Measures**
   - Wallet signatures are verified against challenge nonces
   - Privy tokens verified through Privy SDK
   - Twitter authentication follows standard OAuth flow
   - Biometric uses WebAuthn with cryptographic attestation
   - All cookies are HTTP-only and secure

4. **Frontend Integration**
   - Check `/api/auth/status` to determine available login options
   - Show "Link account" options only when authenticated
   - Update UI based on linked accounts status

5. **Custodial Wallet Implementation** (Upcoming)
   - Server-side wallet generation for biometric users
   - Encrypted private key storage with HSM protection
   - Transaction signing performed server-side
   - Key rotation and backup procedures
   - Clear wallet recovery mechanisms for users

## Cross-Device Authentication Implementation

DegenDuel implements two powerful methods for cross-device authentication:

### 1. Passkey-Based Biometric Authentication

The biometric authentication is implemented using WebAuthn with Passkey support:

#### Database Schema

```sql
-- Biometric credentials table
CREATE TABLE biometric_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id), -- Uses integer user ID
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  counter BIGINT DEFAULT 0,
  device_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Biometric auth challenges table
CREATE TABLE biometric_auth_challenges (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  challenge TEXT NOT NULL,
  type TEXT NOT NULL,
  credential_id TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### API Endpoints

1. **Register Biometric Passkey**
   ```
   POST /api/auth/biometric/register-options
   POST /api/auth/biometric/register-verify
   ```
   - Configured for Passkey creation with `residentKey: 'required'`
   - Uses `attestationType: 'direct'` for detailed attestation
   - Ensures credential is synced to user's password manager

2. **Authenticate with Biometric Passkey**
   ```
   POST /api/auth/biometric/auth-options
   POST /api/auth/biometric/auth-verify
   ```
   - Verifies biometric assertion
   - Issues JWT tokens upon successful verification
   - Updates credential counter for security

### 2. QR Code Authentication

QR code authentication allows using an authenticated mobile device to log in on other devices:

#### Database Schema

```sql
-- QR authentication sessions table
CREATE TABLE qr_auth_sessions (
  id TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  session_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  user_id INTEGER REFERENCES users(id)
);
```

#### API Endpoints

1. **Generate QR Code**
   ```
   POST /api/auth/qr/generate
   ```
   - Creates a pending QR authentication session
   - Returns a QR code data URL containing the session token
   - Session expires after 5 minutes

2. **Verify QR Code (Mobile Device)**
   ```
   POST /api/auth/qr/verify/:token
   ```
   - Called by the authenticated mobile device
   - Links the user's ID to the session
   - Marks session as "approved"

3. **Poll QR Status (New Device)**
   ```
   GET /api/auth/qr/poll/:token
   ```
   - Allows new device to check authentication status
   - Returns current session status

4. **Complete Authentication (New Device)**
   ```
   POST /api/auth/qr/complete/:token
   ```
   - Completes the authentication on the new device
   - Issues JWT tokens for the new device
   - Marks session as "completed"

### Security Considerations

1. **Passkey Security**
   - Only stores credential IDs and public keys, never biometric data
   - Uses attestation verification to prevent spoofing
   - Ensures proper key management with incremental counters
   - Syncs across devices securely via platform mechanisms

2. **QR Code Security**
   - Short-lived sessions (5 minutes) to prevent replay attacks
   - Two-phase verification process (approve + complete)
   - Session tokens are cryptographically random
   - Sessions tied to specific users and devices
   - Comprehensive logging of all authentication activities