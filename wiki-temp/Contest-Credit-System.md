# Contest Credit System

## Overview

The Contest Credit System in DegenDuel is a mechanism that controls who can create contests and how often. Credits represent the ability to create a new contest and must be consumed when creating one. This system allows for better control over contest creation, enables monetization, and prevents abuse.

## Core Components

### Database Schema

The system revolves around the `contest_creation_credits` table:

```prisma
model contest_creation_credits {
  id                     Int       @id @default(autoincrement())
  user_id                String    @db.VarChar(44) // Wallet address of user who owns this credit
  source                 String    @db.VarChar(50) // Where the credit came from: "admin_grant", "purchase", "achievement"
  status                 String    @default("active") @db.VarChar(20) // active, used, expired, revoked
  created_at             DateTime  @default(now()) @db.Timestamptz(6)
  used_at                DateTime? @db.Timestamptz(6)
  expires_at             DateTime? @db.Timestamptz(6)
  price_paid             Decimal?  @db.Decimal(20, 8) // If purchased, how much was paid
  transaction_id         String?   @db.VarChar(64) // Transaction ID if purchased
  granted_by             String?   @db.VarChar(44) // Admin who granted this credit if admin_grant
  metadata               Json?     @default("{}")
  
  // Extra fields for receipt/record-keeping
  purchase_txn_signature String?   @db.VarChar(100) // Solana transaction signature if purchased
  receipt_number         String?   @db.VarChar(30) // Receipt number for accounting
  contest_settings       Json?     @default("{}") // Pre-configured settings for contests created with this credit
  
  // Relations
  user     users      @relation("UserContestCredits", fields: [user_id], references: [wallet_address], onDelete: Cascade)
  contest  contests[]

  @@index([user_id])
  @@index([status])
  @@index([expires_at])
  @@index([source])
  @@map("contest_creation_credits")
}
```

The `contests` table has a relationship to credits:

```prisma
model contests {
  // Other fields...
  creator_credit_used    Int?
  // ...
  
  // Relations
  creation_credit        contest_creation_credits? @relation(fields: [creator_credit_used], references: [id])
}
```

### Credit Verifier Utility

The core functionality is implemented in `utils/contest-credit-verifier.js` with four main functions:

1. **verifyUserHasCredit**: Checks if a user has an available credit
2. **consumeCredit**: Marks a credit as used when a contest is created
3. **linkCreditToContest**: Associates a credit with a contest
4. **grantCredit**: Creates a new credit for a user

## How Credits Work

### Credit Lifecycle

1. **Creation**: Credits are created through:
   - Admin grants
   - User purchases
   - Achievement rewards

2. **Verification**: When a user attempts to create a contest, the system verifies they have an available credit:
   - Checks credit status (must be 'active')
   - Verifies expiration (must not be expired)
   - Prioritizes older credits (FIFO)

3. **Consumption**: When a contest is created:
   - Credit is marked as 'used'
   - `used_at` timestamp is set
   - Credit is linked to the contest
   - Contest is updated with `creator_credit_used`

4. **Expiration**: Credits can optionally have an expiration date:
   - Expired credits are not usable
   - System automatically skips expired credits

### Admin Override

Admins have the ability to bypass the credit requirement when creating contests:

```javascript
// Skip credit verification for admin users if requireCredit is false
if ((user.role === 'admin' || user.role === 'superadmin') && !requireCredit) {
  return { hasCredit: true, credit: null, error: null };
}
```

### Credit Sources

Credits can come from three sources:
- `admin_grant`: Granted by an administrator
- `purchase`: Purchased by a user
- `achievement`: Earned through platform achievements

Each source is tracked and can be reported on separately.

## API Endpoints

### User Endpoints

There are no direct user endpoints for credits in the standard API routes. Instead:

1. **Credit Verification** happens automatically during contest creation:
   ```
   POST /api/contests
   ```
   The API will check for valid credits and return an error if none are available.

### Admin Endpoints

Admins have full control over credits through these endpoints:

1. **View All Credits**:
   ```
   GET /api/admin/contest-management/credits
   ```

2. **View Specific Credit**:
   ```
   GET /api/admin/contest-management/credits/:id
   ```

3. **Grant Credit**:
   ```
   POST /api/admin/contest-management/credits/grant
   {
     "user_id": "wallet_address",
     "source": "admin_grant", // or "purchase", "achievement"
     "expires_at": "ISO_DATE", // optional
     "metadata": { /* additional data */ } // optional
   }
   ```

4. **Revoke Credit**:
   ```
   POST /api/admin/contest-management/credits/:id/revoke
   {
     "reason": "Reason for revoking"
   }
   ```

5. **Credit Statistics by User**:
   ```
   GET /api/admin/contest-management/credits/stats/users
   ```

6. **Overall Credit Usage Statistics**:
   ```
   GET /api/admin/contest-management/credits/stats/usage
   ```

## Integration with Contest Creation

Credits are verified and consumed during contest creation:

```javascript
// From contestService.js
export async function createContest(contestData, userData, options = {}) {
  // Import the credit verifier utility
  const { verifyUserHasCredit, consumeCredit } = await import('../utils/contest-credit-verifier.js');
  
  // ...
  
  // For non-admin users, verify they have a credit
  let creditResult = { hasCredit: true, credit: null };
  if (!isAdmin) {
    creditResult = await verifyUserHasCredit(userId);
    if (!creditResult.hasCredit) {
      throw new Error(creditResult.error || 'No available contest creation credits');
    }
  }
  
  // ... create contest ...
  
  // For non-admin users, consume a credit
  if (!isAdmin && creditResult.credit) {
    const creditUsed = await consumeCredit(creditResult.credit.id, contest.id, tx);
    
    // ... handle errors ...
    
    // Update the contest with the credit used
    await tx.contests.update({
      where: { id: contest.id },
      data: {
        creator_credit_used: creditResult.credit.id
      }
    });
  }
}
```

# Frontend Integration Guide

## Checking Credit Availability

Before showing the contest creation UI, check if the user has available credits:

```javascript
// Example frontend code
async function checkCredits() {
  try {
    // When attempting to create a contest, the backend will verify credits
    // You can add a specific endpoint if needed for just checking
    const response = await fetch('/api/contests/check-credits', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });
    
    const data = await response.json();
    return {
      hasCredits: data.hasCredits,
      credits: data.credits || []
    };
  } catch (error) {
    console.error('Error checking credits:', error);
    return { hasCredits: false, credits: [] };
  }
}
```

## Handling No Credits

When a user doesn't have credits, provide options to acquire them:

```javascript
function NoCreditsView() {
  return (
    <div className="no-credits-container">
      <h2>You need credits to create a contest</h2>
      
      <div className="options">
        <button onClick={handlePurchaseCredit}>Purchase Credit</button>
        <button onClick={handleViewAchievements}>Earn Through Achievements</button>
      </div>
      
      <p>Credits allow you to create custom contests with your own settings.</p>
    </div>
  );
}
```

## Displaying Credit Status

Show users their current credit status in their profile or dashboard:

```javascript
function CreditStatusView({ credits }) {
  const activeCredits = credits.filter(c => c.status === 'active');
  
  return (
    <div className="credit-status">
      <h3>Contest Creation Credits</h3>
      
      <div className="credit-count">
        <span className="count">{activeCredits.length}</span>
        <span className="label">Available Credits</span>
      </div>
      
      {activeCredits.map(credit => (
        <div key={credit.id} className="credit-item">
          <div className="source">{formatSource(credit.source)}</div>
          {credit.expires_at && (
            <div className="expiry">
              Expires: {formatDate(credit.expires_at)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

## Creating a Contest

When creating a contest, handle potential credit errors:

```javascript
async function createContest(contestData) {
  try {
    const response = await fetch('/api/contests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify(contestData)
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Handle credit-specific errors
      if (data.error?.includes('No available contest creation credits')) {
        showNoCreditsMessage();
        return null;
      }
      
      throw new Error(data.error || 'Failed to create contest');
    }
    
    return data.contest;
  } catch (error) {
    console.error('Error creating contest:', error);
    showErrorMessage(error.message);
    return null;
  }
}
```

## Admin Dashboard Integration

For admin interfaces, provide credit management capabilities:

```javascript
async function grantCredit(userId, source, expiresAt, metadata) {
  try {
    const response = await fetch('/api/admin/contest-management/credits/grant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        user_id: userId,
        source,
        expires_at: expiresAt,
        metadata
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to grant credit');
    }
    
    return data.data; // The created credit
  } catch (error) {
    console.error('Error granting credit:', error);
    showAdminErrorMessage(error.message);
    return null;
  }
}
```

## Best Practices

1. **Pre-check Availability**: Always check credit availability before showing contest creation UI
2. **Clear Messaging**: Provide clear explanations when credits are required
3. **Show Expiration**: Clearly display when credits will expire
4. **Purchase Options**: Make credit purchase options easy to find
5. **Transaction Records**: Show users a history of their credit usage
6. **Error Handling**: Handle credit-related errors gracefully with user-friendly messages

## Implementation Recommendations

1. Add a dedicated credits section to user profiles
2. Create a credit store for purchasing credits
3. Display credit status in the contest creation flow
4. Add credit-related notifications (e.g., expiring soon)
5. Implement credit purchase confirmation dialogs