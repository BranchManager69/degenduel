# DegenDuel Treasury Management Integration Guide

This document explains how to integrate the treasury management tools with the DegenDuel admin panel.

## Available Tools

1. **Wallet Balance Audit**
   - Shows balances of all DegenDuel-managed wallets
   - Safe to run at any time (read-only)
   - No confirmation required

2. **Treasury Fund Consolidation**
   - Transfers funds from eligible wallets to treasury
   - Requires explicit confirmation
   - Supports custom destination wallet
   - Option to include/exclude active and pending contest wallets

## Integration with Admin Panel

### Using the Existing Script Execution Framework

The treasury management tools are designed to work with the existing script execution framework in the admin panel. The admin API route `/admin/scripts/:scriptName` can execute these scripts with parameters.

Example AJAX request:

```javascript
// For audit (no parameters)
fetch('/api/admin/scripts/wallet-audit.js', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    category: 'shortcuts'
  })
})
.then(response => response.json())
.then(data => console.log(data));

// For consolidation (with parameters)
fetch('/api/admin/scripts/wallet-consolidate.js', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    category: 'shortcuts',
    params: {
      destination: 'optional-wallet-address', // optional
      'include-active-pending': 'true' // or 'false'
    }
  })
})
.then(response => response.json())
.then(data => {
  // data contains configuration for confirmation
  // After user confirms, execute with:
  executeConsolidation(data.params);
});

// Execute consolidation after confirmation
function executeConsolidation(params) {
  fetch('/api/admin/scripts/wallet-consolidate-execute.js', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      category: 'shortcuts',
      params: {
        ...params,
        confirmed: 'true'
      }
    })
  })
  .then(response => response.json())
  .then(data => console.log(data));
}
```

### UI Integration Recommendations

1. Add a "Treasury Management" section to the admin panel
2. Include buttons for "Audit Wallet Balances" and "Consolidate Funds"
3. For consolidation:
   - First show a configuration form with destination wallet and include/exclude options
   - Then display a preview of affected wallets (from wallet-consolidate.js output)
   - Require explicit confirmation checkbox
   - Finally execute with wallet-consolidate-execute.js passing all parameters

### Configuration File

The included `wallet-management-integration.json` file provides metadata for automatic UI integration:

```json
{
  "version": "1.0.0",
  "category": "Treasury Management",
  "tools": [...]
}
```

## Security Considerations

- The consolidation scripts already require admin authentication via your existing middleware
- Both scripts have multiple confirmation steps to prevent accidental execution
- All actions are logged with the admin's identity
- The scripts validate parameters to prevent injection attacks