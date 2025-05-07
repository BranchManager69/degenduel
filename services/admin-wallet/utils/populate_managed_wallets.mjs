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

function encryptPrivateKeyBytes(privateKeyBuffer, encryptionKeyHex) {
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
        const encrypted = Buffer.concat([cipher.update(privateKeyBuffer), cipher.final()]);
        const tag = cipher.getAuthTag();
        return JSON.stringify({
            encrypted: encrypted.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        });
    } catch (error) {
        // Use logApi for consistency, but this is a critical script error path
        logApi.error(fancyColors.RED + `Encryption failed: ${error.message}` + fancyColors.RESET, error);
        throw new Error(`Failed to encrypt private key: ${error.message}`);
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

    logApi.info(fancyColors.CYAN + `--- Starting: Generating and Inserting ${totalWalletsToCreate} Managed Wallets for Owner ID ${ownerIdToAssign} (WebCryptoAPI/pkcs8) ---` + fancyColors.RESET);
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
            const publicKey = bs58.encode(publicKeyBytes);

            if (!cryptoKeyPair.privateKey.extractable) {
                throw new Error("PANIC: Generated private key is somehow not extractable despite setting flag.");
            }
            const pkcs8PrivateKeyArrayBuffer = await crypto.webcrypto.subtle.exportKey('pkcs8', cryptoKeyPair.privateKey);
            const pkcs8Bytes = new Uint8Array(pkcs8PrivateKeyArrayBuffer);
            const privateKeySeedBytes = pkcs8Bytes.slice(-32);
            
            if (privateKeySeedBytes.length !== 32) {
                 throw new Error(`Extracted private key seed is not 32 bytes long: ${privateKeySeedBytes.length}`);
            }
            
            const solanaSecretKey64Bytes = new Uint8Array(64);
            solanaSecretKey64Bytes.set(privateKeySeedBytes);      
            solanaSecretKey64Bytes.set(publicKeyBytes, 32);    

            const privateKeyBufferForEncryption = Buffer.from(solanaSecretKey64Bytes);

            if (privateKeyBufferForEncryption.length !== 64) {
                throw new Error(`Constructed 64-byte secret key has unexpected length: ${privateKeyBufferForEncryption.length}`);
            }
            if (publicKeyBytes.length !== 32) { 
                throw new Error(`Raw public key has unexpected length: ${publicKeyBytes.length}`);
            }

            const encryptedPrivateKeyJson = encryptPrivateKeyBytes(privateKeyBufferForEncryption, WALLET_ENCRYPTION_KEY_HEX);
            
            const assignedToUserType = `Owner ID ${ownerIdToAssign}`; // Simplified
            
            const walletData = {
                id: crypto.randomUUID(), 
                public_key: publicKey,
                encrypted_private_key: encryptedPrivateKeyJson,
                label: `Generated Admin Wallet ${i + 1} (Owner: ${assignedToUserType}, WebCrypto/pkcs8)`,
                status: 'active',
                metadata: { generated_by_script: true, script_run_time: new Date().toISOString(), key_gen_method: 'WebCryptoAPI_pkcs8' },
                ownerId: ownerIdToAssign,
            };

            await prisma.managed_wallets.create({ data: walletData });
            walletsCreated++;
            logApi.progress.update(walletsCreated, totalWalletsToCreate, [`Creating wallet for ${assignedToUserType}:`]);
        }

        logApi.progress.finish({
            message: `Successfully created and inserted ${walletsCreated} wallets. All assigned to Owner ID ${ownerIdToAssign}`,
            level: 'info'
        });

        // --- Sanity Balance Check with Enhanced Summary ---
        logApi.info(fancyColors.CYAN + '\n--- Performing Sanity Balance Check on All Managed Wallets (using direct v2 via compat layer) ---' + fancyColors.RESET);
        
        const directRpcConfig = { url: globalConfig.rpc_urls.primary, commitment: 'confirmed' }; 
        const solscanBaseUrl = globalConfig.solana?.explorer_urls?.solscan || 'https://solscan.io/account';

        // Fetch only wallets relevant to this run or all if desired (for now, all)
        const allManagedWallets = await prisma.managed_wallets.findMany({
             where: { ownerId: ownerIdToAssign }, // Check only wallets created for this owner OR all?
             orderBy: { created_at: 'asc' } 
        });
        logApi.info(`Found ${allManagedWallets.length} managed wallets for Owner ID ${ownerIdToAssign} to check balances for.`);
        if (allManagedWallets.length === 0 && totalWalletsToCreate > 0) {
             logApi.warn(fancyColors.YELLOW + `Warning: No wallets found for owner ID ${ownerIdToAssign} after creation. Check DB.` + fancyColors.RESET);
        }


        const balanceData = [];
        let totalSolAcrossWallets = 0;
        let walletsWithBalance = 0;
        let walletsWithZeroBalance = 0;
        let walletsErrored = 0;

        logApi.progress.start(); // Start progress for balance check
        let walletsChecked = 0;

        for (const mw of allManagedWallets) {
            let solBalance = 0;
            let errorMsg = null;
            try {
                const balanceResult = await executeRpcCompat(
                    directRpcConfig, 
                    'getBalance',
                    toAddressCompat(mw.public_key)
                );
                const lamports = getLamportsCompat(balanceResult, 'getBalance', mw.public_key);
                solBalance = lamports / LAMPORTS_PER_SOL_COMPAT;
                
                if (solBalance > 0) {
                    walletsWithBalance++;
                    totalSolAcrossWallets += solBalance;
                } else {
                    walletsWithZeroBalance++;
                }
            } catch (balanceError) {
                errorMsg = balanceError.message;
                walletsErrored++;
                // Don't log here, will be summarized
            }
            balanceData.push({
                id: mw.id,
                publicKey: mw.public_key,
                label: mw.label,
                ownerId: mw.ownerId,
                balance: solBalance,
                error: errorMsg,
                solscanLink: `${solscanBaseUrl}/${mw.public_key}`
            });
            walletsChecked++;
            logApi.progress.update(walletsChecked, allManagedWallets.length, [`Checking balance for ${mw.public_key.substring(0,8)}...`]);
            await new Promise(resolve => setTimeout(resolve, 100)); // Reduced delay
        }
        logApi.progress.finish({ message: "Balance check scan complete.", level: 'info' });


        // --- Display Summary ---
        logApi.info(fancyColors.CYAN + '\n--- Balance Check Summary ---' + fancyColors.RESET);
        logApi.info(`Total Wallets Checked for Owner ID ${ownerIdToAssign}: ${allManagedWallets.length}`);
        logApi.info(`${fancyColors.GREEN}Wallets with SOL Balance (>0): ${walletsWithBalance}${fancyColors.RESET}`);
        logApi.info(`Wallets with Zero Balance: ${walletsWithZeroBalance}`);
        if (walletsErrored > 0) {
            logApi.error(`${fancyColors.RED}Wallets with Balance Check Errors: ${walletsErrored}${fancyColors.RESET}`);
        }
        logApi.info(`${fancyColors.GREEN}Total SOL across checked wallets (with balance > 0): ${totalSolAcrossWallets.toFixed(9)} SOL${fancyColors.RESET}`);

        const erroredWallets = balanceData.filter(w => w.error);
        if (erroredWallets.length > 0) {
            logApi.warn(fancyColors.YELLOW + '\nWallets that Errored During Balance Check:' + fancyColors.RESET);
            erroredWallets.forEach(w => {
                logApi.warn(`  Label: ${w.label || 'N/A'}, Pubkey: ${w.publicKey}, OwnerID: ${w.ownerId || 'N/A'}, Error: ${w.error}`);
            });
        }

        const walletsToDisplay = balanceData.filter(w => w.balance > 0).sort((a, b) => b.balance - a.balance);
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
        
        if (allManagedWallets.length > 10 && walletsWithBalance > displayCount) {
            logApi.info(fancyColors.CYAN + `... and ${walletsWithBalance - displayCount} more wallets with balances not listed in top summary.` + fancyColors.RESET);
        }
        if (allManagedWallets.length > 10 && walletsWithZeroBalance > 0 && walletsWithBalance === 0 && walletsErrored === 0) {
             logApi.info(fancyColors.CYAN + `All ${walletsWithZeroBalance} checked wallets have 0.00 SOL.` + fancyColors.RESET);
        }
        // --- END Sanity Balance Check ---

    } catch (error) {
        logApi.error(fancyColors.RED + '\n--- An Error Occurred During Population ---' + fancyColors.RESET);
        logApi.error(error.message, error.stack ? error.stack.split('\n').slice(0,5).join('\n') : 'No stack'); // Log only first few lines of stack
        logApi.info(fancyColors.YELLOW + `Created ${walletsCreated} wallets before error.` + fancyColors.RESET);
    } finally {
        await prisma.$disconnect();
        logApi.info(fancyColors.CYAN + 'Prisma client disconnected.' + fancyColors.RESET);
    }
}

populateWallets().catch(err => {
  // Catch unhandled promise rejections from populateWallets
  logApi.error(fancyColors.RED + 'Unhandled error in populateWallets:' + fancyColors.RESET, err);
  prisma.$disconnect(); // Ensure prisma disconnects on fatal error
  process.exit(1);
}); 