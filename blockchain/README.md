# Blockchain Integration Files

This directory contains files related to direct blockchain integrations for DegenDuel.

## Pump.swap AMM Integration

### Overview

Pump.swap is the AMM (Automated Market Maker) used by Pump.fun for token launches and trading. DegenDuel integrates with this protocol to provide token trading functionality.

### Files

- `pumpswap_idl.json` - Interface Description Language (IDL) for the Pump.swap program

### Program Addresses

- **Mainnet**: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- **Devnet**: `8vaA111XsMgk3snAmLuyhyNYSPXCXCu6fHuMcNhoEN4B`

### Updating the IDL

The IDL can be updated using the provided utility script:

```bash
npm run pump:fetch-idl
```

This will fetch the latest IDL directly from the Solana blockchain.

## Usage Notes

When working with these blockchain contracts, keep in mind:

1. Different networks (mainnet, devnet) have different program addresses
2. Always test transactions on devnet before mainnet
3. The IDL should be kept up to date if the contract is upgraded