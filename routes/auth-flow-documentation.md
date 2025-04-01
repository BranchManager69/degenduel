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

4. **Biometric Authentication** (Upcoming - In Development)
   - Fingerprint/Face ID authentication using WebAuthn
   - Includes custodial wallet generation for users
   - Creates managed wallets for users without existing wallets
   - Endpoints (planned):
     - `/api/auth/register-biometric` - Register new device
     - `/api/auth/biometric-challenge` - Generate challenge
     - `/api/auth/verify-biometric` - Verify biometric auth

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

## Biometric Authentication Implementation (Planned)

### Backend Components

#### Database Schema

```sql
-- Biometric credentials table
CREATE TABLE biometric_credentials (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(wallet_address),
  credential_id TEXT UNIQUE NOT NULL,
  public_key TEXT NOT NULL,
  device_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used TIMESTAMP WITH TIME ZONE,
  custodial_wallet_address TEXT,
  custodial_wallet_encrypted_key TEXT
);

-- Add credential_id column to auth_challenges table
ALTER TABLE auth_challenges ADD COLUMN credential_id TEXT;
```

#### API Endpoints

1. **Register Biometric**
   ```
   POST /api/auth/register-biometric
   ```
   - Registers new biometric credential
   - Creates custodial wallet if needed
   - Links to existing account if authenticated

2. **Biometric Challenge**
   ```
   GET /api/auth/biometric-challenge?credential_id={id}
   ```
   - Generates random challenge for biometric authentication
   - Stores challenge in auth_challenges table

3. **Verify Biometric**
   ```
   POST /api/auth/verify-biometric
   ```
   - Verifies biometric authentication response
   - Validates cryptographic attestation
   - Issues JWT token upon successful verification

### Integration with WebAuthn

The biometric authentication will use the Web Authentication API (WebAuthn) standard:

1. **Registration Flow:**
   - Client: Call `navigator.credentials.create()` with challenge from server
   - Client: Send attestation to server
   - Server: Verify attestation and store credential

2. **Authentication Flow:**
   - Client: Call `navigator.credentials.get()` with challenge from server
   - Client: Send assertion to server
   - Server: Verify assertion and issue JWT

### Security Considerations

1. **Credential Security**
   - Only store non-sensitive credential IDs and public keys
   - Never store actual biometric data
   - Implement strong attestation verification

2. **Custodial Wallet Protection**
   - Encrypt all private keys at rest
   - Use hardware security modules (HSM) for key storage
   - Implement transaction limits for custodial wallets
   - Provide clear recovery mechanisms