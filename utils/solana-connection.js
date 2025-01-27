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

      // Convert expected amount to lamports
      const expectedLamports = Math.round(expectedAmount * LAMPORTS_PER_SOL);

      logApi.debug(`💰 ${colors.cyan}Checking transfer amount${colors.reset}`, {
        expectedLamports,
        senderChange,
        receiverChange,
        difference: Math.abs(receiverChange - expectedLamports)
      });

      // Verify amount (allowing for fees)
      const isAmountCorrect = Math.abs(receiverChange - expectedLamports) < 5000; // Allow 0.000005 SOL difference for fees

      if (!isAmountCorrect) {
        logApi.warn(`❌ ${colors.red}Invalid transfer amount${colors.reset}`, {
          expected: expectedLamports,
          received: receiverChange,
          difference: Math.abs(receiverChange - expectedLamports)
        });
        throw new Error('Invalid transfer amount');
      }

      logApi.info(`✅ ${colors.green}Transaction verified successfully${colors.reset}`, {
        signature,
        slot: tx.slot,
        amount: expectedAmount,
        fee: senderChange - receiverChange
      });

      // Return success with slot number
      return {
        verified: true,
        slot: tx.slot
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

