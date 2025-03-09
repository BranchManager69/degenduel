# DegenDuel Treasury Fund Management

This documentation covers the fund management tools created for DegenDuel's treasury operations.

## Overview

The fund management system provides tools to:

1. Audit wallet balances across all platform-managed wallets
2. Identify funds eligible for consolidation
3. Transfer eligible funds to the treasury wallet securely
4. Maintain detailed logs of all operations

## Available Tools

### 1. Wallet Audit Tool

The wallet audit tool scans all managed wallets and provides a detailed report on their balances.

```bash
npm run mm:audit
```

**Features:**
- Refreshes balance data for all wallets
- Shows detailed information about wallet balances
- Identifies which wallets have transferable funds
- Verifies balance data is recent (within last 5 minutes)
- Color-coded output for easy reading

### 2. Fund Consolidation Tool

This tool transfers funds from eligible wallets to the treasury wallet.

```bash
npm run mm:consolidate
```

**Features:**
- Transfers funds from eligible wallets to treasury
- Verifies balance data is recent before proceeding
- Requires double confirmation before execution
- Leaves small amounts in wallets for fees
- Provides detailed logs of all operations

### 3. Combined Run Script

A wrapper script that runs audit first, then consolidation if confirmed.

```bash
npm run mm
```

**Features:**
- Runs audit to show available funds
- Adds an extra confirmation step
- Makes the process more user-friendly

## Security Considerations

The fund management tools include several security features:

1. **Balance Freshness Check**: Wallets must have balance data updated within the last 5 minutes to be eligible for transfer.
2. **Multi-Level Confirmation**: Multiple explicit confirmations are required before any funds are moved.
3. **Minimum Balance Protection**: A small amount is left in each wallet to cover future transaction fees.
4. **Detailed Logging**: All operations are logged in detail, with transaction signatures.
5. **IP Restriction**: The auth system has been improved to restrict critical operations by IP address.

## Usage Guidelines

### When to Use Fund Consolidation

1. **Platform Maintenance**: Before scheduled maintenance to secure funds
2. **Contest Cleanup**: After contest periods end to reclaim unused funds
3. **Security Measures**: In emergency situations to rapidly secure funds
4. **Treasury Management**: As part of regular treasury operations

### Best Practices

1. Always run `mm:audit` first to understand what will be transferred
2. Only proceed with consolidation when you have time to monitor the process
3. Verify treasury wallet address before proceeding
4. Keep logs of all fund movements for accounting purposes

## Future Improvements

Planned enhancements to the fund management system:

1. **UI Integration**: Admin dashboard integration with real-time transfer status
2. **Scheduled Audits**: Automated balance checks with reporting
3. **Smart Consolidation**: Threshold-based auto-consolidation with admin approval
4. **Multi-Signature Support**: Requiring multiple admin approvals for large transfers
5. **Enhanced Reporting**: Detailed financial reports for accounting

## Troubleshooting

### Common Issues

1. **Failed Transfers**: Usually due to network congestion or RPC issues. Check logs and retry.
2. **Missing Wallets**: Ensure wallets are properly registered in the database.
3. **Stale Balance Data**: If many wallets show stale data, check RPC connectivity.

### Support

For issues with the fund management tools, contact:
- Branch Manager (branchmanager@degenduel.me)