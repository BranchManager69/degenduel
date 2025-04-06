/**
 * Pump.fun client for interacting with the bonding curve
 */

import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import { PUMP_FUN_PROGRAM, PUMP_FUN_ACCOUNT, GLOBAL, TX_MODE, RPC_ENDPOINTS, DEFAULT_OPTIONS } from './constants.js';

class PumpFunClient {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Force use of the PUMP_BUNDLER_RPC_URL if available
    let rpcEndpoint = process.env.PUMP_BUNDLER_RPC_URL || RPC_ENDPOINTS.DEFAULT;
    
    console.log(`Using Solana RPC endpoint: ${rpcEndpoint}`);
    this.connection = new Connection(
      rpcEndpoint,
      { commitment: 'confirmed' }
    );
    this.programId = new PublicKey(PUMP_FUN_PROGRAM);
    this.pumpfunAccount = new PublicKey(PUMP_FUN_ACCOUNT);
    this.globalAccount = new PublicKey(GLOBAL);
  }

  /**
   * Buy tokens from the Pump.fun bonding curve
   * 
   * @param {object} params - Buy parameters
   * @param {string} params.mode - Transaction mode (simulate, execute, bundle)
   * @param {Keypair} params.wallet - Buyer's wallet keypair
   * @param {PublicKey|string} params.tokenMint - Token mint address
   * @param {number} params.solAmount - SOL amount to spend (in SOL)
   * @param {number} params.slippageBps - Slippage in basis points (default: 100 = 1%)
   * @returns {Object} Transaction result
   */
  async buyToken(params) {
    const { mode, wallet, tokenMint, solAmount, slippageBps = 100 } = params;
    
    // Validate parameters
    if (!wallet || !tokenMint || !solAmount) {
      throw new Error('Missing required parameters: wallet, tokenMint, solAmount');
    }

    // Convert SOL to lamports
    const lamports = solAmount * 10**9;
    
    // Create token mint public key
    const mintPubkey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    // Get associated token account
    const associatedTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      wallet.publicKey
    );
    
    // Build transaction
    const transaction = new Transaction();

    // Add compute budget instruction for priority fee
    if (this.options.priorityFee > 0) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.options.priorityFee
        })
      );
    }

    // Check if token account exists, create if needed
    try {
      const tokenAccountInfo = await this.connection.getAccountInfo(associatedTokenAccount);
      if (!tokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            associatedTokenAccount,
            wallet.publicKey,
            mintPubkey
          )
        );
      }
    } catch (error) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          associatedTokenAccount,
          wallet.publicKey,
          mintPubkey
        )
      );
    }

    // Add buy instruction
    const dataLayout = Buffer.alloc(9);
    dataLayout.writeUInt8(0, 0); // Buy instruction discriminator
    dataLayout.writeBigUInt64LE(BigInt(lamports), 1);

    transaction.add({
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.pumpfunAccount, isSigner: false, isWritable: true },
        { pubkey: this.globalAccount, isSigner: false, isWritable: true },
        { pubkey: mintPubkey, isSigner: false, isWritable: true },
        { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: dataLayout
    });

    // Set recent blockhash and fee payer
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Handle transaction based on mode
    if (mode === TX_MODE.SIMULATE || this.options.simulate) {
      // Simulate transaction
      const simulation = await this.connection.simulateTransaction(transaction);
      return {
        success: simulation.value.err === null,
        result: simulation.value,
        transaction: transaction
      };
    } else if (mode === TX_MODE.BUNDLE) {
      // Return unsigned transaction for bundling
      return {
        success: true,
        transaction: transaction
      };
    } else {
      // Sign and send transaction
      transaction.sign(wallet);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      if (this.options.confirmationTarget) {
        // Wait for confirmation
        const confirmation = await this.connection.confirmTransaction({
          signature,
          blockhash: transaction.recentBlockhash,
          lastValidBlockHeight: (await this.connection.getLatestBlockhash()).lastValidBlockHeight
        }, this.options.confirmationTarget);
        
        return {
          success: confirmation.value.err === null,
          signature,
          confirmationStatus: confirmation
        };
      }
      
      return {
        success: true,
        signature
      };
    }
  }

  /**
   * Sell tokens to the Pump.fun bonding curve
   * 
   * @param {object} params - Sell parameters
   * @param {string} params.mode - Transaction mode (simulate, execute, bundle)
   * @param {Keypair} params.wallet - Seller's wallet keypair
   * @param {PublicKey|string} params.tokenMint - Token mint address
   * @param {number} params.tokenAmount - Amount of tokens to sell
   * @param {number} params.slippageBps - Slippage in basis points (default: 100 = 1%)
   * @returns {Object} Transaction result
   */
  async sellToken(params) {
    const { mode, wallet, tokenMint, tokenAmount, slippageBps = 100 } = params;
    
    // Validate parameters
    if (!wallet || !tokenMint || !tokenAmount) {
      throw new Error('Missing required parameters: wallet, tokenMint, tokenAmount');
    }
    
    // Create token mint public key
    const mintPubkey = typeof tokenMint === 'string' ? new PublicKey(tokenMint) : tokenMint;
    
    // Get associated token account
    const associatedTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      wallet.publicKey
    );
    
    // Build transaction
    const transaction = new Transaction();

    // Add compute budget instruction for priority fee
    if (this.options.priorityFee > 0) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.options.priorityFee
        })
      );
    }

    // Add sell instruction
    const dataLayout = Buffer.alloc(9);
    dataLayout.writeUInt8(1, 0); // Sell instruction discriminator
    dataLayout.writeBigUInt64LE(BigInt(tokenAmount), 1);

    transaction.add({
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.pumpfunAccount, isSigner: false, isWritable: true },
        { pubkey: this.globalAccount, isSigner: false, isWritable: true },
        { pubkey: mintPubkey, isSigner: false, isWritable: true },
        { pubkey: associatedTokenAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data: dataLayout
    });

    // Set recent blockhash and fee payer
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash('finalized')).blockhash;
    transaction.feePayer = wallet.publicKey;
    
    // Handle transaction based on mode
    if (mode === TX_MODE.SIMULATE || this.options.simulate) {
      // Simulate transaction
      const simulation = await this.connection.simulateTransaction(transaction);
      return {
        success: simulation.value.err === null,
        result: simulation.value,
        transaction: transaction
      };
    } else if (mode === TX_MODE.BUNDLE) {
      // Return unsigned transaction for bundling
      return {
        success: true,
        transaction: transaction
      };
    } else {
      // Sign and send transaction
      transaction.sign(wallet);
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      if (this.options.confirmationTarget) {
        // Wait for confirmation
        const confirmation = await this.connection.confirmTransaction({
          signature,
          blockhash: transaction.recentBlockhash,
          lastValidBlockHeight: (await this.connection.getLatestBlockhash()).lastValidBlockHeight
        }, this.options.confirmationTarget);
        
        return {
          success: confirmation.value.err === null,
          signature,
          confirmationStatus: confirmation
        };
      }
      
      return {
        success: true,
        signature
      };
    }
  }

  /**
   * Get token price information from the bonding curve
   * 
   * @param {string|PublicKey} tokenMint - Token mint address
   * @returns {Object} Price information
   */
  async getTokenPrice(tokenMint) {
    // Implementation will need on-chain data analysis
    // This is a placeholder for future implementation
    return { notImplemented: true };
  }
}

export default PumpFunClient;
