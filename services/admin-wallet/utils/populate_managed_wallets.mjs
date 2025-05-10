#!/usr/bin/env node
import 'dotenv/config'; // For loading .env file
import crypto from 'node:crypto';
// No longer using @solana/keys for generateKeyPair
// import { generateKeyPair } from '@solana/keys';
import bs58 from 'bs58'; // For encoding public key
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
// For the balance check part
import { executeRpcMethod as executeRpcCompat, getLamportsFromRpcResult as getLamportsCompat, toAddress as toAddressCompat, LAMPORTS_PER_SOL as LAMPORTS_PER_SOL_COMPAT } from '../../../services/admin-wallet/utils/solana-compat.js';
// import { solanaEngine } from '../../../services/solana-engine/index.js'; // Not needed directly for balance checks if using direct rpc config
import { config as globalConfig } from '../../../config/config.js'; // For RPC URL & Solscan base

const BATCH_SIZE_GET_MULTIPLE_ACCOUNTS = 90; // Max items per getMultipleAccounts call

// --- Script Configuration via yargs ---
const argv = yargs(hideBin(process.argv))
  .option('count', {
    alias: 'c',
    type: 'number',
    description: 'Number of wallets to create',
    default: 10,
  })
  .option('owner-id', {
    alias: 'oi',
    type: 'number',
    description: 'User ID of the owner for the new wallets',
  })
  .option('owner-wallet', {
    alias: 'ow',
    type: 'string',
    description: 'Wallet address of the owner for the new wallets',
  })
  .check((argv) => {
    if (argv.count <= 0) {
      throw new Error('Count must be a positive integer.');
    }
    if (!argv.ownerId && !argv.ownerWallet) {
      throw new Error('You must specify an owner using either --owner-id or --owner-wallet.');
    }
    return true;
  })
  .fail((msg, err, yargs) => {
    // Log error with fancy colors, then print help, then exit
    logApi.error(fancyColors.RED + msg + fancyColors.RESET);
    console.error(yargs.help()); // Use console.error for yargs help
    process.exit(1);
  })
  .help()
  .alias('help', 'h')
  .argv;

const totalWalletsToCreate = argv.count;
// These are no longer constants at the top, owner will be determined in populateWallets
// const SUPERADMIN_USER_ID = 6; 

const WALLET_ENCRYPTION_KEY_HEX = process.env.WALLET_ENCRYPTION_KEY;
// --- End Script Configuration ---

const ENCRYPTION_CONFIG = {
    algorithm: 'aes-256-gcm',
    ivLength: 16, // bytes
}; 

function encryptPrivateKeyBytes_local(payloadString, encryptionKeyHex) {
    if (!encryptionKeyHex || encryptionKeyHex.length !== 64) {
        throw new Error('Invalid or missing encryption key hex (must be 64 hex chars).');
    }
    try {
        const encryptionKeyBuffer = Buffer.from(encryptionKeyHex, 'hex');
        const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);
        const cipher = crypto.createCipheriv(
            ENCRYPTION_CONFIG.algorithm,
            encryptionKeyBuffer,
            iv
        );
        const payloadBuffer = Buffer.from(payloadString, 'utf8');
        const encrypted = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    } catch (error) {
        logApi.error(fancyColors.RED + `Encryption failed (local): ${error.message}` + fancyColors.RESET, error);
        throw new Error(`Failed to encrypt (local): ${error.message}`);
    }
}

async function determineOwnerId() {
    if (argv.ownerId) {
        // Validate if user ID exists
        const user = await prisma.users.findUnique({ where: { id: argv.ownerId } });
        if (!user) {
            logApi.error(fancyColors.RED + `Error: User with ID ${argv.ownerId} not found.` + fancyColors.RESET);
            process.exit(1);
        }
        logApi.info(`Wallets will be assigned to owner ID: ${argv.ownerId}`);
        return argv.ownerId;
    }
    if (argv.ownerWallet) {
        const user = await prisma.users.findUnique({ where: { wallet_address: argv.ownerWallet } });
        if (!user) {
            logApi.error(fancyColors.RED + `Error: User with wallet address ${argv.ownerWallet} not found.` + fancyColors.RESET);
            process.exit(1);
        }
        logApi.info(`Wallets will be assigned to owner ID: ${user.id} (found via wallet ${argv.ownerWallet})`);
        return user.id;
    }
    // Should not reach here due to yargs check, but as a safeguard:
    logApi.error(fancyColors.RED + 'Error: Owner could not be determined. This should not happen.' + fancyColors.RESET);
    process.exit(1);
    return null; // Should be unreachable
}

async function populateWallets() {
    if (!WALLET_ENCRYPTION_KEY_HEX) {
        logApi.error(fancyColors.RED + 'Error: WALLET_ENCRYPTION_KEY environment variable is not set.' + fancyColors.RESET);
        process.exit(1);
    }
    if (WALLET_ENCRYPTION_KEY_HEX.length !== 64) {
        logApi.error(fancyColors.RED + 'Error: WALLET_ENCRYPTION_KEY must be 64 hexadecimal characters long.' + fancyColors.RESET);
        process.exit(1);
    }

    const ownerIdToAssign = await determineOwnerId(); // Determine owner at the start

    logApi.info(fancyColors.CYAN + `--- Starting: Generating ${totalWalletsToCreate} Managed Wallets (v2 Seed Encryption) for Owner ID ${ownerIdToAssign} ---` + fancyColors.RESET);
    logApi.progress.start(); // Initialize progress display

    let walletsCreated = 0;
    // let superAdminWallets = 0; // No longer tracking this way, all go to one owner
    // let otherUserWallets = 0; // No longer tracking separately

    try {
        for (let i = 0; i < totalWalletsToCreate; i++) {
            const cryptoKeyPair = await crypto.webcrypto.subtle.generateKey(
                { name: "Ed25519" }, true, ["sign", "verify"]
            );
            const rawPublicKeyArrayBuffer = await crypto.webcrypto.subtle.exportKey('raw', cryptoKeyPair.publicKey);
            const publicKeyBytes = new Uint8Array(rawPublicKeyArrayBuffer);
            const publicKeyString = bs58.encode(publicKeyBytes);

            const pkcs8PrivateKeyArrayBuffer = await crypto.webcrypto.subtle.exportKey('pkcs8', cryptoKeyPair.privateKey);
            const pkcs8Bytes = new Uint8Array(pkcs8PrivateKeyArrayBuffer);
            const privateKeySeedBytes_32 = pkcs8Bytes.slice(-32); // This is our Uint8Array 32-byte seed
            
            if (privateKeySeedBytes_32.length !== 32) {
                 throw new Error(`Extracted private key seed is not 32 bytes: ${privateKeySeedBytes_32.length}`);
            }

            // 2. Prepare 32-byte seed FOR ENCRYPTION (as a base58 string)
            const seedStringForEncryption = bs58.encode(privateKeySeedBytes_32);

            // 3. Encrypt the SEED STRING using the local encrypt function
            const baseEncryptedJsonString = encryptPrivateKeyBytes_local(seedStringForEncryption, WALLET_ENCRYPTION_KEY_HEX);
            
            // 4. Add Version Marker to the encrypted JSON
            const parsedEncrypted = JSON.parse(baseEncryptedJsonString);
            const finalEncryptedJsonToStore = JSON.stringify({
                ...parsedEncrypted,
                version: 'v2_seed_admin', // Our new version marker for seeds
                // aad: crypto.randomBytes(16).toString('hex') // Optional: Add AAD if desired for extra context
            });
            
            const walletData = {
                id: crypto.randomUUID(), 
                public_key: publicKeyString,
                encrypted_private_key: finalEncryptedJsonToStore, // Store the versioned JSON
                label: `Generated Admin Wallet ${i + 1} (Owner: ${ownerIdToAssign}, v2 Seed Encrypted)`,
                status: 'active',
                metadata: { 
                    generated_by_script: true, 
                    script_run_time: new Date().toISOString(), 
                    key_gen_method: 'WebCryptoAPI_pkcs8_v2seed' // Updated method description
                },
                ownerId: ownerIdToAssign,
            };

            await prisma.managed_wallets.create({ data: walletData });
            walletsCreated++;
            logApi.progress.update(walletsCreated, totalWalletsToCreate, [`Creating v2 seed wallet for ${ownerIdToAssign}:`]);
        }

        logApi.progress.finish({
            message: `Successfully created and inserted ${walletsCreated} wallets. All assigned to Owner ID ${ownerIdToAssign}`,
            level: 'info'
        });

        // --- Sanity Balance Check (Batched) ---
        logApi.info(fancyColors.CYAN + '\n--- Performing Batched Sanity Balance Check on ALL Managed Wallets --- shallower --- ' + fancyColors.RESET);
        
        const directRpcConfig = { url: globalConfig.rpc_urls.primary, commitment: 'confirmed' }; 
        const solscanBaseUrl = globalConfig.solana?.explorer_urls?.solscan || 'https://solscan.io/account';

        const allManagedWalletsInDb = await prisma.managed_wallets.findMany({
             orderBy: { created_at: 'asc' } 
        });
        logApi.info(`Found ${allManagedWalletsInDb.length} total managed wallets in DB to check balances for.`);

        if (allManagedWalletsInDb.length === 0) {
            logApi.info('No managed wallets found in DB to check balances.');
            return; // Exit balance check if no wallets
        }

        const balanceData = [];
        let totalSolAcrossWallets = 0;
        let walletsWithBalance = 0;
        let walletsWithZeroBalance = 0;
        let walletsErroredInRpc = 0; // Specifically for RPC errors during batch fetch

        logApi.progress.start(); 
        let walletsProcessedCount = 0;

        for (let i = 0; i < allManagedWalletsInDb.length; i += BATCH_SIZE_GET_MULTIPLE_ACCOUNTS) {
            const batchOfWallets = allManagedWalletsInDb.slice(i, i + BATCH_SIZE_GET_MULTIPLE_ACCOUNTS);
            const batchPublicKeys = batchOfWallets.map(w => w.public_key);
            logApi.debug(`Processing batch of ${batchPublicKeys.length} wallets for balance check (starts with ${batchPublicKeys[0]})`);

            try {
                const accountsInfo = await executeRpcCompat(
                    directRpcConfig, 
                    'getMultipleAccountsInfo',
                    batchPublicKeys,
                    { commitment: 'confirmed' } // Pass commitment as options object
                );

                accountsInfo.forEach((accountInfo, indexInBatch) => {
                    const wallet = batchOfWallets[indexInBatch];
                    let solBalance = 0;
                    let errorMsg = null;

                    if (accountInfo) {
                        solBalance = accountInfo.lamports / LAMPORTS_PER_SOL_COMPAT;
                        if (solBalance > 0) {
                            walletsWithBalance++;
                            totalSolAcrossWallets += solBalance;
                        } else {
                            walletsWithZeroBalance++;
                        }
                    } else {
                        // Account might not exist on-chain yet or error fetching this specific one
                        errorMsg = 'Account info not found or error for this public key in batch.';
                        walletsWithZeroBalance++; // Treat as zero for summary, but flag
                        logApi.warn(`No account info for ${wallet.public_key} in batch response.`);
                    }
                    balanceData.push({
                        id: wallet.id,
                        publicKey: wallet.public_key,
                        label: wallet.label,
                        ownerId: wallet.ownerId,
                        balance: solBalance,
                        error: errorMsg,
                        solscanLink: `${solscanBaseUrl}/${wallet.public_key}`
                    });
                    walletsProcessedCount++;
                    logApi.progress.update(walletsProcessedCount, allManagedWalletsInDb.length, [`Checked ${walletsProcessedCount}/${allManagedWalletsInDb.length}`]);
                });
            } catch (batchError) {
                logApi.error(fancyColors.RED + `Error fetching batch of account infos (starts with ${batchPublicKeys[0]}): ${batchError.message}` + fancyColors.RESET);
                walletsErroredInRpc += batchPublicKeys.length; // Mark all in batch as errored for summary
                // Store error for each wallet in this failed batch
                batchOfWallets.forEach(wallet => {
                    balanceData.push({
                        id: wallet.id,
                        publicKey: wallet.public_key,
                        label: wallet.label,
                        ownerId: wallet.ownerId,
                        balance: 0,
                        error: `Batch RPC Error: ${batchError.message}`,
                        solscanLink: `${solscanBaseUrl}/${wallet.public_key}`
                    });
                    walletsProcessedCount++;
                    logApi.progress.update(walletsProcessedCount, allManagedWalletsInDb.length, [`Checked ${walletsProcessedCount}/${allManagedWalletsInDb.length} (batch error)`]);
                });
            }
            // Optional: Add a small delay between batches if rate limiting is a concern
            // await new Promise(resolve => setTimeout(resolve, 50)); 
        }
        logApi.progress.finish({ message: "All wallet balance checks complete.", level: 'info' });

        // --- Display Summary ---
        logApi.info(fancyColors.CYAN + '\n--- Batched Balance Check Summary (ALL Wallets) ---' + fancyColors.RESET);
        logApi.info(`Total Wallets Checked in DB: ${allManagedWalletsInDb.length}`);
        logApi.info(`${fancyColors.GREEN}Wallets with SOL Balance (>0): ${walletsWithBalance}${fancyColors.RESET}`);
        logApi.info(`Wallets with Zero Balance (or not found in batch): ${walletsWithZeroBalance}`);
        if (walletsErroredInRpc > 0) {
            logApi.error(`${fancyColors.RED}Wallets with RPC/Batch Fetch Errors: ${walletsErroredInRpc}${fancyColors.RESET}`);
        }
        logApi.info(`${fancyColors.GREEN}Total SOL across checked wallets (with balance > 0): ${totalSolAcrossWallets.toFixed(9)} SOL${fancyColors.RESET}`);

        const erroredWalletsForDisplay = balanceData.filter(w => w.error);
        if (erroredWalletsForDisplay.length > 0) {
            logApi.warn(fancyColors.YELLOW + '\nWallets that had issues during Balance Check:' + fancyColors.RESET);
            erroredWalletsForDisplay.slice(0, 10).forEach(w => { // Display up to 10 errors
                logApi.warn(`  Label: ${w.label || 'N/A'}, Pubkey: ${w.publicKey}, OwnerID: ${w.ownerId || 'N/A'}, Error: ${w.error}`);
            });
            if (erroredWalletsForDisplay.length > 10) {
                logApi.warn(`  ... and ${erroredWalletsForDisplay.length - 10} more wallets with errors.`);
            }
        }

        const walletsToDisplay = balanceData.filter(w => w.balance > 0 && !w.error).sort((a, b) => b.balance - a.balance);
        const displayCount = Math.min(walletsToDisplay.length, walletsWithBalance < 10 ? walletsWithBalance : 5);

        if (displayCount > 0) {
            logApi.info(fancyColors.CYAN + `\nTop ${displayCount} Wallets with Balances (Highest First):` + fancyColors.RESET);
            for (let i = 0; i < displayCount; i++) {
                const w = walletsToDisplay[i];
                logApi.info(
                    `  ${fancyColors.BLUE}Label:${fancyColors.RESET} ${w.label || w.publicKey.substring(0,10)+'...'} ` +
                    `${fancyColors.BLUE}Owner ID:${fancyColors.RESET} ${w.ownerId || 'N/A'} ` +
                    `${fancyColors.BLUE}Balance:${fancyColors.RESET} ${w.balance.toFixed(9)} SOL ` +
                    `${fancyColors.BLUE}Link:${fancyColors.RESET} ${w.solscanLink}`
                );
            }
        } else if (walletsWithBalance > 0) {
             logApi.info(fancyColors.CYAN + 'All wallets with balances already listed or none have significant balance.' + fancyColors.RESET);
        }
        
        if (allManagedWalletsInDb.length > 10 && walletsWithBalance > displayCount) {
            logApi.info(fancyColors.CYAN + `... and ${walletsWithBalance - displayCount} more wallets with balances not listed in top summary.` + fancyColors.RESET);
        }
        // --- END Sanity Balance Check ---

    } catch (error) {
        logApi.error(fancyColors.RED + '\n--- An Error Occurred During Population Script ---' + fancyColors.RESET);
        logApi.error(error.message, error.stack ? error.stack.split('\n').slice(0,5).join('\n') : 'No stack');
        // walletsCreated would have been logged by progress.finish if it got that far
    } finally {
        await prisma.$disconnect();
        logApi.info(fancyColors.CYAN + 'Prisma client disconnected.' + fancyColors.RESET);
    }
}

populateWallets().catch(err => {
  // Catch unhandled promise rejections from populateWallets
  logApi.error(fancyColors.RED + 'Unhandled error in populateWallets execution:' + fancyColors.RESET, err);
  prisma.$disconnect(); // Ensure prisma disconnects on fatal error
  process.exit(1);
}); 