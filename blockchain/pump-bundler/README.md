# Pump.fun Bundler & Analytics Suite

A comprehensive toolkit for interacting with Pump.fun bonding curves and Pump.swap AMM, optimized for high-performance trading, analysis, and visualization.

## Features

### Core Trading Features
- Direct interaction with Pump.fun bonding curve
- Transaction bundling for multiple operations
- Built-in simulation before execution
- Priority fee support for faster inclusion
- Support for Jito MEV bundles
- Optimized for block-zero sniping

### Analytics & Visualization
- Bonding curve analysis and visualization
- Price impact calculation
- Automated selling schedule generation
- Token migration tracking
- Arbitrage opportunity detection
- Platform comparison (bonding curve vs AMM)

## Installation

No additional installation required - the bundler uses dependencies already included in the DegenDuel project.

## Command-Line Tools

### Transaction Bundler CLI
```bash
# Buy tokens on Pump.fun
npm run pump:bundler -- buy --mint TOKEN_MINT --amount 0.1 [--simulate]

# Sell tokens on Pump.fun
npm run pump:bundler -- sell --mint TOKEN_MINT --amount 1000 [--simulate]

# Help and commands
npm run pump:bundler -- --help
```

### Token Analytics CLI
```bash
# Visualize bonding curves
npm run pump:visualize -- TOKEN_MINT_1 TOKEN_MINT_2 [--compare]

# Analyze token status and pricing
npm run pump:analyze -- TOKEN_MINT [--liquidity] [--migration] [--all]

# Run bundler test
npm run pump:bundler:test
```

## SDK Usage

### Transaction Bundling

```javascript
// Import the bundler
import { PumpFunClient, PumpBundler, TX_MODE } from './blockchain/pump-bundler/src/index.js';
import { Keypair } from '@solana/web3.js';

// Create a client instance for direct transactions
const client = new PumpFunClient({
  priorityFee: 1000000, // 0.001 SOL in lamports
  useJito: false // Set to true to use Jito RPC if available
});

// Example: Buy tokens directly
async function buyTokens() {
  const wallet = Keypair.generate(); // Replace with your wallet
  const tokenMint = 'TOKEN_MINT_ADDRESS';
  const solAmount = 0.1; // SOL amount to spend
  
  const result = await client.buyToken({
    mode: TX_MODE.EXECUTE, // Options: SIMULATE, EXECUTE, BUNDLE
    wallet,
    tokenMint,
    solAmount
  });
  
  console.log('Buy result:', result);
}

// Example: Create a bundle of transactions
async function createBundle() {
  const bundler = new PumpBundler({
    priorityFee: 1000000,
    confirmationTarget: 'confirmed'
  });
  
  const wallet = Keypair.generate(); // Replace with your wallet
  
  // Add transactions to the bundle
  await bundler.addBuyTransaction({
    wallet,
    tokenMint: 'TOKEN_MINT_1',
    solAmount: 0.05
  });
  
  await bundler.addBuyTransaction({
    wallet,
    tokenMint: 'TOKEN_MINT_2',
    solAmount: 0.05
  });
  
  // Simulate the bundle first
  const simResults = await bundler.simulateBundle();
  console.log('Simulation results:', simResults);
  
  // Execute if all simulations are successful
  const allSuccessful = simResults.every(result => result.success);
  
  if (allSuccessful) {
    const execResults = await bundler.executeBundle();
    console.log('Execution results:', execResults);
  }
}
```

### DegenDuel Integration

```javascript
import DegenDuelPumpIntegration from './blockchain/pump-bundler/src/integration.js';

const pumpIntegration = new DegenDuelPumpIntegration({
  priorityFee: 1000000,
  useJito: false
});

// Buy a token
const buyResult = await pumpIntegration.buy({
  wallet: yourWallet,
  tokenMint: 'TOKEN_MINT_ADDRESS',
  solAmount: 0.1,
  simulate: false // set to true to simulate first
});

// Create a bundle
const bundleResult = await pumpIntegration.createBundle({
  operations: [
    { type: 'buy', tokenMint: 'TOKEN_1', solAmount: 0.05 },
    { type: 'buy', tokenMint: 'TOKEN_2', solAmount: 0.05 }
  ],
  wallet: yourWallet,
  simulate: true
});
```

### Token Analysis

```javascript
import CurveAnalyzer from './blockchain/pump-bundler/src/curve-analyzer.js';
import PumpSwapAnalyzer from './blockchain/pump-bundler/src/pump-swap-analyzer.js';

// Analyze bonding curve
const curveAnalyzer = new CurveAnalyzer();
const curveData = await curveAnalyzer.analyzeTokenCurve('TOKEN_MINT_ADDRESS');

// Check price impacts
const impactData = await curveAnalyzer.calculatePriceImpacts('TOKEN_MINT_ADDRESS', [0.1, 0.5, 1, 5]);

// Create a selling schedule
const schedule = await curveAnalyzer.createSellingSchedule('TOKEN_MINT_ADDRESS', 1000000, 7, 50);

// Analyze platform status
const pumpAnalyzer = new PumpSwapAnalyzer();
const tokenStatus = await pumpAnalyzer.analyzeToken('TOKEN_MINT_ADDRESS');

// Check for arbitrage
const liquidityAnalysis = await pumpAnalyzer.analyzeTokenLiquidity('TOKEN_MINT_ADDRESS');

// Monitor migration status
const migrationStatus = await pumpAnalyzer.checkMigrationStatus('TOKEN_MINT_ADDRESS');
```

## Configuration Options

```javascript
const options = {
  priorityFee: 1000000, // Priority fee in microlamports (0.001 SOL)
  maxRetries: 3, // Maximum number of retries
  confirmationTarget: "processed", // Confirmation level: processed, confirmed, finalized
  useJito: false, // Use Jito RPC endpoint
  simulate: true, // Always simulate before executing
  stopOnError: true // Stop executing bundle on first error
};
```

## Transaction Modes

- `TX_MODE.SIMULATE` - Simulate transaction without sending
- `TX_MODE.EXECUTE` - Execute transaction immediately
- `TX_MODE.BUNDLE` - Prepare transaction for bundling

## Notes on Block-Zero Sniping

For optimal performance when sniping new token launches:

1. Use a high priority fee to increase chances of inclusion
2. Consider using Jito MEV bundles for guaranteed block inclusion
3. Pre-create all required token accounts ahead of time
4. Use the simulation feature to validate transactions before sending

## Future Development

This toolkit is under active development. Future enhancements:

- WebSocket monitoring of token launches
- Automated trading strategies
- Multi-wallet parallel execution
- Integration with additional Solana AMMs
- Machine learning for price prediction