# DegenDuel Solana Actions Integration Guide

This guide explains how to integrate our new Solana Actions (Blinks) feature for the "Join Contest with AI Portfolio" functionality.

## Overview

Our implementation now supports one-click contest entry with intelligent portfolio selection:

1. For returning users: **Uses their most recent portfolio** based on past contest entries
2. For new users: **Creates an AI-generated portfolio** using trending tokens

This provides a seamless experience with a single button, preserving the "one-click" nature of Solana Actions.

## Implementation Steps

### 1. Update Share and Join Contest Buttons

Add data attributes to your contest join button to enable Solana Actions:

```jsx
<button
  onClick={handleJoinContest}
  data-solana-action="true"
  data-action-title="Join Contest with AI Portfolio"
  data-action-url={`https://degenduel.me/api/blinks/join-contest?contest_id=${contest.id}`}
  className="w-full relative group overflow-hidden text-sm py-4 shadow-lg shadow-brand-500/20 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-bold"
>
  <span className="font-medium">Join with AI Portfolio</span>
</button>
```

For the share button, use our `ShareBlinkButton` component:

```jsx
<ShareBlinkButton
  blinkUrl={`/api/blinks/join-contest`}
  params={{
    contest_id: contest.id.toString(),
    referrer: walletAddress || ""
  }}
  label="Share Contest"
  className="bg-dark-300/80 hover:bg-dark-300 text-brand-400 hover:text-brand-300"
/>
```

### 2. Handling the Contest Join Flow

Implement the handler function for both standard and Solana Actions flows:

```javascript
async function handleJoinContest(e) {
  // Check if Solana Actions are supported
  const isActionSupported = window.solana && typeof window.solana.action === 'function';
  
  if (isActionSupported) {
    e.preventDefault(); // Prevent default button behavior
    
    try {
      // Get user's connected wallet
      const wallet = getCurrentWalletAddress();
      
      // Create request payload
      const payload = {
        account: wallet,
        contest_id: contestId
      };
      
      // Call the action API directly - either returns transaction or redirect
      const response = await fetch('/api/blinks/join-contest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      if (data.action === "redirect") {
        // If we need to redirect to portfolio selection
        window.location.href = data.redirect_url;
        return;
      }
      
      if (!data.transaction) {
        throw new Error('Invalid transaction received');
      }
      
      // Show portfolio selection info to the user
      if (data.portfolio_summary) {
        showPortfolioPreview(data.portfolio_source, data.portfolio_summary);
      }
      
      // Request wallet to sign the transaction
      const { signature } = await window.solana.signAndSendTransaction(
        data.transaction,
        { message: data.message }
      );
      
      // Show success message with transaction link
      showSuccessMessage(`Contest joined successfully!`, 
        `View transaction: https://solscan.io/tx/${signature}`);
      
      // Refresh contest data after successful join
      refreshContestData();
      
    } catch (error) {
      showErrorMessage(`Failed to join contest: ${error.message}`);
    }
  } else {
    // Fall back to regular join flow if Solana Actions not supported
    regularJoinContestFlow();
  }
}
```

### 3. Portfolio Preview Component

To help users understand their AI-selected portfolio:

```jsx
function PortfolioPreview({ source, summary }) {
  return (
    <div className="p-4 bg-dark-800 rounded-lg mb-4">
      <h3 className="text-lg font-bold mb-2">
        {source === 'ai' ? 'AI-Selected Portfolio' : 'Your Recent Portfolio'}
      </h3>
      <p className="text-sm opacity-80 mb-2">
        {source === 'ai' 
          ? 'Our AI has selected this portfolio based on trending tokens'
          : 'Based on your previous contest entries'}
      </p>
      <div className="flex flex-wrap gap-2">
        {summary.split(', ').map((item, i) => (
          <span key={i} className="px-2 py-1 bg-dark-700 rounded text-xs">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
```

### 4. Deep Linking Support

For mobile/external wallet support, generate deep links:

```javascript
function generateContestDeepLink(contestId) {
  return `https://degenduel.me/contest/${contestId}?action=join`;
}
```

Use this in share buttons and QR codes.

### 5. Testing the Implementation

1. **Basic Flow Testing**:
   - Connect wallet and click Join Contest button
   - Verify the transaction includes proper parameters
   - Confirm the portfolio is created correctly

2. **Edge Cases**:
   - Test with users who have previous portfolios
   - Test with users who have no previous portfolios
   - Test fallback when trending tokens can't be found

3. **Mobile Testing**:
   - Generate and share deep links
   - Open in compatible wallet apps
   - Verify correct behavior

## Important Notes

1. **Portfolio Selection Logic**:
   - For returning users, weights are normalized based on previous selections
   - For new users, the top trending token gets 40% weight, others split remaining 60%

2. **Transaction Verification**:
   - All transactions include a portfolio ID in the memo field
   - The portfolio data is temporarily stored in `pending_contest_entries` table
   - After transaction verification, these entries are used to create the actual portfolio

3. **Messaging**:
   - Always present this as "AI-powered portfolio selection" for marketing value
   - For returning users, emphasize this is based on their own preferences

## Migration Notes

After you run the Prisma migration to add the `pending_contest_entries` table, the system will be ready to handle these requests.

For any questions, contact the blockchain integration team.