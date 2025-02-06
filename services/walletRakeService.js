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

import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import crypto from 'crypto';
import bs58 from 'bs58';

const prisma = new PrismaClient();
const RAKE_INTERVAL = 10 * 60 * 1000; // 10 minutes
const MIN_BALANCE = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL in lamports
const MASTER_WALLET = process.env.DD_MASTER_WALLET;
const WALLET_ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY;

// Create Solana connection
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

// Decrypt wallet private key
function decryptPrivateKey(encryptedData) {
    try {
        const { encrypted, iv, tag, aad } = JSON.parse(encryptedData);
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            Buffer.from(WALLET_ENCRYPTION_KEY, 'hex'),
            Buffer.from(iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        if (aad) decipher.setAAD(Buffer.from(aad));
        
        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
        ]);
        
        logApi.debug('Successfully decrypted private key', {
            hasAad: !!aad,
            keyLength: decrypted.length
        });
        
        return decrypted.toString();
    } catch (error) {
        logApi.error('Failed to decrypt private key:', error);
        throw error;
    }
}

// Transfer SOL from contest wallet to master wallet
async function transferSOL(fromKeypair, amount) {
    try {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: new PublicKey(MASTER_WALLET),
                lamports: amount,
            })
        );

        const signature = await connection.sendTransaction(transaction, [fromKeypair]);
        await connection.confirmTransaction(signature);
        
        return signature;
    } catch (error) {
        logApi.error('Failed to transfer SOL:', error);
        throw error;
    }
}

// Main rake function
async function rakeWallets() {
    logApi.info('Starting wallet rake process');
    
    try {
        // Get all contest wallets
        const contestWallets = await prisma.contest_wallets.findMany({
            include: {
                contests: true
            }
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

                // Transfer SOL
                const signature = await transferSOL(fromKeypair, rakeAmount);

                logApi.info('Successfully raked wallet', {
                    contestId: wallet.contest_id,
                    walletAddress: wallet.wallet_address,
                    rakeAmount: rakeAmount / LAMPORTS_PER_SOL,
                    signature
                });

            } catch (error) {
                logApi.error('Failed to rake wallet:', {
                    contestId: wallet.contest_id,
                    walletAddress: wallet.wallet_address,
                    error: error.message
                });
                continue;
            }
        }
    } catch (error) {
        logApi.error('Wallet rake process failed:', error);
    }
}

// Start the rake service
export function startWalletRakeService() {
    logApi.info('Starting wallet rake service');
    
    // Initial rake
    rakeWallets();
    
    // Set up interval
    setInterval(rakeWallets, RAKE_INTERVAL);
}

export default {
    startWalletRakeService
};

