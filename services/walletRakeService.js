// services/walletRakeService.js

/*
 * This service is responsible for collecting leftover Solana from contest wallets.
 * It should check all already-evaluated contests every 10 minutes for leftover SOL/tokens.
 *   Remember, the contestEvaluateService should have already transferred all prizes to the contest winners.
 *   Therefore, if anything is left over, it belongs to us and should be transferred to the 'main' DegenDuel wallet.
 * For buffer purposes, I will always want to keep 0.01 SOL in contest wallets; account for this while raking.
 *
 * DegenDuel's 'main' wallet address to rake contest wallet funds to: BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp (my main personal wallet!)
 *
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import { config } from '../config/config.js';
import prisma from '../config/prisma.js';
import { logApi } from '../utils/logger-suite/logger.js';
import ServiceManager, { SERVICE_NAMES } from '../utils/service-manager.js';

const RAKE_INTERVAL = 10 * 60 * 1000; // every 10 minutes
const MIN_BALANCE =
  config.master_wallet.min_contest_wallet_balance * LAMPORTS_PER_SOL;
const MASTER_WALLET = config.master_wallet.address;
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

// Create Solana connection
const connection = new Connection(config.rpc_urls.primary, "confirmed");

// Configuration
const RAKE_CONFIG = {
  check_interval_ms: 1 * 60 * 60 * 1000, // Check every hour
  min_rake_amount: 0.001, // Minimum SOL to rake
  max_retries: 3,
  retry_delay_ms: 5 * 60 * 1000, // 5 minutes
};

// Statistics tracking
let rakeStats = {
  total_raked: 0,
  successful_rakes: 0,
  failed_rakes: 0,
  total_amount_raked: 0,
  last_successful_rake: null,
  last_failed_rake: null,
  performance: {
    average_rake_time_ms: 0,
    total_rake_operations: 0,
  },
};

let rakeInterval;

// Decrypt wallet private key
function decryptPrivateKey(encryptedData) {
  try {
    const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      Buffer.from(WALLET_ENCRYPTION_KEY, "hex"),
      Buffer.from(iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(tag, "hex"));
    if (aad) decipher.setAAD(Buffer.from(aad));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "hex")),
      decipher.final(),
    ]);

    logApi.debug("Successfully decrypted private key", {
      hasAad: !!aad,
      keyLength: decrypted.length,
    });

    return decrypted.toString();
  } catch (error) {
    logApi.error("Failed to decrypt private key:", error);
    throw error;
  }
}

// Transfer SOL from contest wallet to master wallet
async function transferSOL(fromKeypair, amount, contestId) {
  try {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: new PublicKey(MASTER_WALLET),
        lamports: amount,
      })
    );

    const signature = await connection.sendTransaction(transaction, [
      fromKeypair,
    ]);
    await connection.confirmTransaction(signature);

    // Get contest details for user relation
    const contest = await prisma.contests.findUnique({
      where: { id: contestId },
      select: { created_by_user_id: true },
    });

    // Log the rake transaction
    await prisma.transactions.create({
      data: {
        wallet_address: fromKeypair.publicKey.toString(),
        type: config.transaction_types.CONTEST_WALLET_RAKE,
        amount: amount / LAMPORTS_PER_SOL,
        balance_before:
          (await connection.getBalance(fromKeypair.publicKey)) /
            LAMPORTS_PER_SOL +
          amount / LAMPORTS_PER_SOL,
        balance_after:
          (await connection.getBalance(fromKeypair.publicKey)) /
          LAMPORTS_PER_SOL,
        description: `Rake operation from contest wallet to master wallet`,
        status: config.transaction_statuses.COMPLETED,
        blockchain_signature: signature,
        completed_at: new Date(),
        created_at: new Date(),
        user_id: contest?.created_by_user_id, // Link to contest creator if available
        contest_id: contestId,
      },
    });

    return signature;
  } catch (error) {
    logApi.error("Failed to transfer SOL:", error);

    // Log failed rake attempt
    await prisma.transactions.create({
      data: {
        wallet_address: fromKeypair.publicKey.toString(),
        type: config.transaction_types.CONTEST_WALLET_RAKE,
        amount: amount / LAMPORTS_PER_SOL,
        balance_before:
          (await connection.getBalance(fromKeypair.publicKey)) /
          LAMPORTS_PER_SOL,
        balance_after:
          (await connection.getBalance(fromKeypair.publicKey)) /
          LAMPORTS_PER_SOL,
        description: `Failed rake operation: ${error.message}`,
        status: config.transaction_statuses.FAILED,
        error_details: JSON.stringify(error),
        completed_at: new Date(),
        created_at: new Date(),
        contest_id: contestId,
      },
    });

    throw error;
  }
}

// Main rake function
async function rakeWallets() {
  logApi.info("Starting wallet rake process");

  try {
    // Get all contest wallets with their contests
    const contestWallets = await prisma.contest_wallets.findMany({
      where: {
        contests: {
          status: {
            in: ["completed", "cancelled"],
          },
        },
      },
      include: {
        contests: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    for (const wallet of contestWallets) {
      try {
        // Get wallet balance
        const pubkey = new PublicKey(wallet.wallet_address);
        const balance = await connection.getBalance(pubkey);

        // Skip if balance is too low
        if (balance <= MIN_BALANCE) {
          continue;
        }

        // Calculate amount to rake (leave MIN_BALANCE in wallet)
        const rakeAmount = balance - MIN_BALANCE;

        // Decrypt private key and create keypair
        const decryptedPrivateKey = decryptPrivateKey(wallet.private_key);
        const privateKeyBytes = bs58.decode(decryptedPrivateKey);
        const fromKeypair = Keypair.fromSecretKey(privateKeyBytes);

        // Transfer SOL with contest ID
        const signature = await transferSOL(
          fromKeypair,
          rakeAmount,
          wallet.contest_id
        );

        logApi.info("Successfully raked wallet", {
          contestId: wallet.contest_id,
          walletAddress: wallet.wallet_address,
          rakeAmount: rakeAmount / LAMPORTS_PER_SOL,
          signature,
        });
      } catch (error) {
        logApi.error("Failed to rake wallet:", {
          contestId: wallet.contest_id,
          walletAddress: wallet.wallet_address,
          error: error.message,
        });
        continue;
      }
    }
  } catch (error) {
    logApi.error("Wallet rake process failed:", error);
  }
}

export async function startWalletRakeService() {
  try {
    // Check if service should be enabled
    const setting = await prisma.system_settings.findUnique({
      where: { key: "wallet_rake_service" },
    });

    const enabled = setting?.value?.enabled ?? true; // Default to true for this critical service

    // Mark service as started
    await ServiceManager.markServiceStarted(
      SERVICE_NAMES.WALLET_RAKE,
      {
        ...RAKE_CONFIG,
        enabled,
      },
      rakeStats
    );

    if (!enabled) {
      logApi.info("Wallet Rake Service is disabled");
      return;
    }

    // Start periodic rake checks
    rakeInterval = setInterval(async () => {
      try {
        // Check if service is still enabled
        const currentSetting = await prisma.system_settings.findUnique({
          where: { key: "wallet_rake_service" },
        });

        if (!currentSetting?.value?.enabled) {
          return;
        }

        await performRake();
        // Update heartbeat after successful rake
        await ServiceManager.updateServiceHeartbeat(
          SERVICE_NAMES.WALLET_RAKE,
          RAKE_CONFIG,
          rakeStats
        );
      } catch (error) {
        // Mark error state
        await ServiceManager.markServiceError(
          SERVICE_NAMES.WALLET_RAKE,
          error,
          RAKE_CONFIG,
          rakeStats
        );
      }
    }, RAKE_CONFIG.check_interval_ms);

    if (enabled) {
      logApi.info("Wallet Rake Service started successfully");
    }
  } catch (error) {
    logApi.error("Failed to start Wallet Rake Service:", error);
    throw error;
  }
}

export function stopWalletRakeService() {
  try {
    if (rakeInterval) {
      clearInterval(rakeInterval);
      rakeInterval = null;
    }

    // Mark service as stopped
    ServiceManager.markServiceStopped(
      SERVICE_NAMES.WALLET_RAKE,
      RAKE_CONFIG,
      rakeStats
    );

    logApi.info("Wallet Rake Service stopped");
  } catch (error) {
    logApi.error("Failed to stop Wallet Rake Service:", error);
    throw error;
  }
}

async function performRake() {
  const startTime = Date.now();
  try {
    await rakeWallets();

    // Update stats
    rakeStats.performance.total_rake_operations++;
    rakeStats.performance.average_rake_time_ms =
      (rakeStats.performance.average_rake_time_ms *
        (rakeStats.performance.total_rake_operations - 1) +
        (Date.now() - startTime)) /
      rakeStats.performance.total_rake_operations;
  } catch (error) {
    rakeStats.failed_rakes++;
    rakeStats.last_failed_rake = new Date().toISOString();
    throw error;
  }
}

export default {
  startWalletRakeService,
  stopWalletRakeService,
};
