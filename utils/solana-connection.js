import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logApi } from './logger-suite/logger.js';
import { colors } from './colors.js';

// Get RPC URL from environment
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Create connection
const connection = new Connection(RPC_URL, 'confirmed');

// Verify a Solana transaction
export const verifyTransaction = async (signature, { 
  expectedAmount, 
  expectedSender, 
  expectedReceiver 
}) => {
  logApi.info(`🔍 ${colors.cyan}Starting transaction verification${colors.reset}`, {
    signature,
    expectedAmount,
    expectedSender,
    expectedReceiver
  });

  try {
    // Get transaction details
    logApi.debug(`📡 ${colors.yellow}Fetching transaction${colors.reset}`, { signature });
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      logApi.warn(`❌ ${colors.red}Transaction not found${colors.reset}`, { signature });
      throw new Error('Transaction not found');
    }

    logApi.debug(`📝 ${colors.cyan}Transaction found${colors.reset}`, {
      slot: tx.slot,
      blockTime: tx.blockTime,
      status: tx.meta?.err ? 'failed' : 'success'
    });

    // Verify transaction success
    if (!tx.meta?.err) {
      // Get pre and post balances
      const preBalances = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;

      // Find sender and receiver indexes
      const accountKeys = tx.transaction.message.accountKeys;
      const senderIndex = accountKeys.findIndex(key => 
        key.toBase58() === expectedSender
      );
      const receiverIndex = accountKeys.findIndex(key => 
        key.toBase58() === expectedReceiver
      );

      if (senderIndex === -1 || receiverIndex === -1) {
        logApi.warn(`⚠️ ${colors.red}Invalid sender or receiver${colors.reset}`, {
          foundSender: senderIndex !== -1,
          foundReceiver: receiverIndex !== -1,
          accounts: accountKeys.map(key => key.toBase58())
        });
        throw new Error('Invalid sender or receiver');
      }

      logApi.debug(`👥 ${colors.green}Found sender and receiver${colors.reset}`, {
        senderIndex,
        receiverIndex,
        senderAddress: accountKeys[senderIndex].toBase58(),
        receiverAddress: accountKeys[receiverIndex].toBase58()
      });

      // Calculate amount transferred
      const senderChange = preBalances[senderIndex] - postBalances[senderIndex];
      const receiverChange = postBalances[receiverIndex] - preBalances[receiverIndex];
      const receiverBalanceBefore = preBalances[receiverIndex] / LAMPORTS_PER_SOL;
      const receiverBalanceAfter = postBalances[receiverIndex] / LAMPORTS_PER_SOL;

      // Convert expected amount to lamports
      const expectedLamports = Math.round(expectedAmount * LAMPORTS_PER_SOL);

      // Check if this is the first transaction (wallet initialization)
      const isFirstTransaction = preBalances[receiverIndex] === 0;
      
      // Get minimum rent exemption if this is the first transaction
      let rentExemption = 0;
      if (isFirstTransaction) {
        try {
          rentExemption = await connection.getMinimumBalanceForRentExemption(0);
          logApi.debug(`📊 ${colors.cyan}First transaction - rent exemption required${colors.reset}`, {
            rentExemption,
            expectedTotal: expectedLamports + rentExemption
          });
        } catch (error) {
          logApi.warn(`⚠️ ${colors.yellow}Failed to get rent exemption amount${colors.reset}`, {
            error: error.message
          });
          // Default to known common value if we can't get it dynamically
          rentExemption = 890880;
        }
      }

      // For first transactions, we expect the amount plus rent exemption
      const expectedTotal = expectedLamports + rentExemption;
      
      // Verify amount with appropriate tolerance
      // Use a smaller tolerance (5000 lamports) for regular transactions
      // Use a larger tolerance (50000 lamports) for first transactions with rent exemption
      const tolerance = isFirstTransaction ? 50000 : 5000;
      const isAmountCorrect = Math.abs(receiverChange - expectedTotal) < tolerance;

      if (!isAmountCorrect) {
        logApi.warn(`❌ ${colors.red}Invalid transfer amount${colors.reset}`, {
          expected: expectedTotal,
          received: receiverChange,
          difference: Math.abs(receiverChange - expectedTotal),
          isFirstTransaction,
          rentExemption
        });
        throw new Error('Invalid transfer amount');
      }

      logApi.info(`✅ ${colors.green}Transaction verified successfully${colors.reset}`, {
        signature,
        slot: tx.slot,
        amount: expectedAmount,
        fee: senderChange - receiverChange,
        receiverBalanceBefore: receiverBalanceBefore.toString(),
        receiverBalanceAfter: receiverBalanceAfter.toString(),
        isFirstTransaction,
        rentExemption: isFirstTransaction ? rentExemption : 0
      });

      // Return success with slot number and balance info
      return {
        verified: true,
        slot: tx.slot,
        amount: expectedAmount,
        receiverBalanceBefore: receiverBalanceBefore.toString(),
        receiverBalanceAfter: receiverBalanceAfter.toString(),
        isFirstTransaction,
        rentExemption: isFirstTransaction ? rentExemption : 0
      };
    }

    logApi.warn(`❌ ${colors.red}Transaction failed${colors.reset}`, {
      signature,
      error: tx.meta?.err
    });
    throw new Error('Transaction failed');
  } catch (error) {
    logApi.error(`💥 ${colors.red}Transaction verification failed${colors.reset}`, {
      error: error.message,
      signature,
      expectedAmount,
      expectedSender,
      expectedReceiver
    });
    return {
      verified: false,
      error: error.message
    };
  }
};

export default {
  connection,
  verifyTransaction
};