// /utils/solana-suite/faucet-manager.ts

import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletGenerator } from './wallet-generator.js';
import bs58 from 'bs58';
import { fileURLToPath } from 'url';
import { Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const connection = new Connection(process.env.QUICKNODE_MAINNET_HTTP || 'https://api.mainnet-beta.solana.com', 'confirmed');

interface FaucetConfig {
  defaultAmount: number;  // Amount of SOL to distribute to each test user
  minFaucetBalance: number;  // Minimum SOL to keep in faucet
  maxTestUsers: number;  // Maximum number of test users to fund at once
}

// Default configuration
const DEFAULT_CONFIG: FaucetConfig = {
  defaultAmount: 0.025,
  minFaucetBalance: 0.05,
  maxTestUsers: 10
};

export class FaucetManager {
  private static config: FaucetConfig = DEFAULT_CONFIG;

  static setConfig(newConfig: Partial<FaucetConfig>) {
    FaucetManager.config = { ...DEFAULT_CONFIG, ...newConfig };
  }

  static async getFaucetWallet() {
    const existingFaucet = await prisma.seed_wallets.findFirst({
      where: { identifier: 'test-faucet' }
    });

    if (existingFaucet) {
      return WalletGenerator.getWallet('test-faucet');
    }

    console.log('\n=== IMPORTANT: Test Faucet Setup Required ===');
    console.log('Generating new test faucet wallet...');
    const faucetWallet = await WalletGenerator.generateWallet('test-faucet');
    console.log(`\nTest Faucet Address: ${faucetWallet.publicKey}`);
    console.log(`Please send at least ${this.config.defaultAmount * this.config.maxTestUsers} SOL to this address for test user funding.`);
    console.log('===============================================\n');

    return faucetWallet;
  }

  static async checkBalance() {
    const faucetWallet = await this.getFaucetWallet();
    if (!faucetWallet) {
      throw new Error('Failed to get test faucet wallet');
    }

    const balance = await connection.getBalance(new PublicKey(faucetWallet.publicKey));
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    console.log('\n=== Test Faucet Balance ===');
    console.log(`Address: ${faucetWallet.publicKey}`);
    console.log(`Balance: ${balanceSOL} SOL`);
    console.log(`Available for distribution: ${Math.max(0, balanceSOL - this.config.minFaucetBalance)} SOL`);
    console.log(`Can fund approximately ${Math.floor((balanceSOL - this.config.minFaucetBalance) / this.config.defaultAmount)} new test users`);
    console.log('==========================\n');

    return balanceSOL;
  }

  static async recoverFromTestWallets() {
    console.log('Recovering SOL from test wallets...');

    // Get all test users (created in the last 24 hours)
    const testUsers = await prisma.users.findMany({
      where: {
        created_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        },
        nickname: {
          startsWith: 'Test User'
        }
      },
      select: {
        id: true,
        wallet_address: true
      }
    });

    const faucetWallet = await this.getFaucetWallet();
    if (!faucetWallet) {
      throw new Error('Failed to get test faucet wallet');
    }

    let totalRecovered = 0;

    for (const user of testUsers) {
      try {
        const balance = await connection.getBalance(new PublicKey(user.wallet_address));
        if (balance <= 0) continue;

        const balanceSOL = balance / LAMPORTS_PER_SOL;

        const walletInfo = await WalletGenerator.getWallet(`test-user-${user.id}`);
        if (!walletInfo) {
          console.log(`No private key found for ${user.wallet_address}, skipping...`);
          continue;
        }

        const userKeypair = Keypair.fromSecretKey(bs58.decode(walletInfo.secretKey));
        
        // Leave enough for rent exemption
        const recoveryAmount = balance - (0.001 * LAMPORTS_PER_SOL);
        if (recoveryAmount <= 0) continue;

        const recoveryAmountSOL = recoveryAmount / LAMPORTS_PER_SOL;

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: userKeypair.publicKey,
            toPubkey: new PublicKey(faucetWallet.publicKey),
            lamports: recoveryAmount
          })
        );

        const signature = await connection.sendTransaction(transaction, [userKeypair]);
        await connection.confirmTransaction(signature);

        totalRecovered += recoveryAmountSOL;
        console.log(`Recovered ${recoveryAmountSOL} SOL from ${user.wallet_address}`);

        // Log the recovery transaction
        await prisma.transactions.create({
          data: {
            wallet_address: user.wallet_address,
            type: 'WITHDRAWAL',
            amount: recoveryAmountSOL,
            balance_before: balanceSOL,
            balance_after: balanceSOL - recoveryAmountSOL,
            status: 'completed',
            metadata: {
              blockchain_signature: signature
            } as Prisma.JsonObject,
            description: 'Test wallet SOL recovery',
            processed_at: new Date(),
            user_id: user.id
          }
        });

      } catch (error) {
        console.error(`Failed to recover SOL from ${user.wallet_address}:`, error);
      }
    }

    console.log(`\nTotal SOL recovered: ${totalRecovered} SOL`);
    await this.checkBalance();
  }

  static async sendSOL(toAddress: string, amount: number) {
    const faucetWallet = await this.getFaucetWallet();
    if (!faucetWallet) {
      throw new Error('Failed to get test faucet wallet');
    }

    try {
      // Get current balance
      const currentBalance = await connection.getBalance(new PublicKey(toAddress));
      const currentBalanceSOL = currentBalance / LAMPORTS_PER_SOL;

      const faucetKeypair = Keypair.fromSecretKey(
        bs58.decode(faucetWallet.secretKey)
      );

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: faucetKeypair.publicKey,
          toPubkey: new PublicKey(toAddress),
          lamports: amount * LAMPORTS_PER_SOL
        })
      );

      const signature = await connection.sendTransaction(transaction, [faucetKeypair]);
      await connection.confirmTransaction(signature);

      // Log the transaction
      await prisma.transactions.create({
        data: {
          wallet_address: toAddress,
          type: 'DEPOSIT',
          amount: amount,
          balance_before: currentBalanceSOL,
          balance_after: currentBalanceSOL + amount,
          status: 'completed',
          metadata: {
            blockchain_signature: signature
          } as Prisma.JsonObject,
          description: 'Test user SOL funding',
          processed_at: new Date()
        }
      });

      return true;
    } catch (error) {
      console.error(`Failed to send ${amount} SOL to ${toAddress}:`, error);
      return false;
    }
  }
}

// Command line interface
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  
  switch (command) {
    case 'balance':
      FaucetManager.checkBalance()
        .then(() => process.exit(0))
        .catch(console.error);
      break;
    
    case 'recover':
      FaucetManager.recoverFromTestWallets()
        .then(() => process.exit(0))
        .catch(console.error);
      break;
    
    case 'config':
      const newConfig = {
        defaultAmount: parseFloat(process.argv[3]) || DEFAULT_CONFIG.defaultAmount,
        minFaucetBalance: parseFloat(process.argv[4]) || DEFAULT_CONFIG.minFaucetBalance,
        maxTestUsers: parseInt(process.argv[5]) || DEFAULT_CONFIG.maxTestUsers
      };
      FaucetManager.setConfig(newConfig);
      console.log('Faucet configuration updated:', newConfig);
      break;
    
    default:
      console.log(`
Usage:
  npx ts-node faucet-manager.ts balance              - Check faucet balance
  npx ts-node faucet-manager.ts recover              - Recover SOL from test wallets
  npx ts-node faucet-manager.ts config <amount> <min> <max>  - Update faucet configuration
      `);
  }
} 