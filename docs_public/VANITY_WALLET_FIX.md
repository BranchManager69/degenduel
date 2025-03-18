# Vanity Wallet Implementation Fix

## Issue Identified

The contest scheduler service was not properly using vanity wallets for contest creation due to a
direct usage of the `createContestWallet()` utility function instead of the more comprehensive
`contestWalletService.createContestWallet()` method.

### Problem Details

1. The contest scheduler service was directly calling:
   ```javascript
   const { publicKey, encryptedPrivateKey } = await createContestWallet();
   
   // Creating wallet record without setting vanity flags
   const contestWallet = await prisma.contest_wallets.create({
       data: {
           contest_id: contest.id,
           wallet_address: publicKey,
           private_key: encryptedPrivateKey,
           balance: '0'
           // Missing is_vanity and vanity_type fields
       }
   });
   ```

2. This approach bypassed the proper vanity wallet lookup and assignment process that's implemented in the
   `contestWalletService.js` file, which has the logic to:
   - Check for available vanity wallets in the `_DUEL` and `_DEGEN` folders
   - Set the correct `is_vanity: true` and `vanity_type: 'DUEL'` flags in the database
   - Fall back to random addresses only when no vanity addresses are available

3. As a result, contests were being created with random wallet addresses instead of the vanity addresses,
   even though vanity wallet files were available in the `/addresses/keypairs/public/_DUEL/` directory.

## Fix Implemented

The fix modifies the contest scheduler service to properly use the contest wallet service:

```javascript
// Use contest wallet service to create wallet (this properly handles vanity wallets)
let contestWallet;
try {
    // Use the contest wallet service which properly sets is_vanity and vanity_type
    const contestWalletService = (await import('../services/contestWalletService.js')).default;
    contestWallet = await contestWalletService.createContestWallet(contest.id);
    
    logApi.info(`Created wallet for contest: ${contestWallet.wallet_address}`);
    if (contestWallet.is_vanity) {
        logApi.info(`Using ${contestWallet.vanity_type} vanity wallet!`);
    }
} catch (walletError) {
    // Fall back to direct wallet creation if service fails
    logApi.warn(`Wallet service failed, falling back to direct wallet creation`, walletError);
    
    // Direct wallet creation as a fallback
    const { publicKey, encryptedPrivateKey } = await createContestWallet();
    
    contestWallet = await prisma.contest_wallets.create({
        data: {
            contest_id: contest.id,
            wallet_address: publicKey,
            private_key: encryptedPrivateKey,
            balance: '0'
        }
    });
}
```

## Verification

The fix was verified using a test script (`scripts/test-vanity-wallet.js`) which confirmed that:

1. Vanity wallets are properly detected in the directory structure
2. The `contestWalletService.getUnassociatedVanityWallet()` method correctly finds available vanity wallets
3. The `contestWalletService.createContestWallet()` method properly sets `is_vanity: true` and the correct vanity type
4. The database records show the vanity wallet is being properly used

## Available Vanity Wallets

Currently there are 16 DUEL vanity wallets available in `/addresses/keypairs/public/_DUEL/` that can be used for
contests. The wallet files are named after their public key (e.g., `DUEL3B4r1zTXULxnvi29BqVVCmgNJ33PAoWp377oCbnQ.json`),
and the corresponding private keys are stored in `/addresses/pkeys/public/_DUEL/`.

The `_DEGEN` directories exist but currently don't contain any files.