#!/usr/bin/env node
import 'dotenv/config';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Buffer } from 'node:buffer'; // Ensure Buffer is available

import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';

// Functions from wallet-crypto.js - ensure paths are correct
// We need to import them carefully if they are not exported as a default object
// Assuming they are named exports from the module
import {
    decryptWallet,
    encryptV2SeedBuffer // Use the new function for encrypting raw seeds
} from '../modules/wallet-crypto.js';

import { createKeyPairSignerFromBytes } from '@solana/signers';

const WALLET_ENCRYPTION_KEY_HEX = process.env.WALLET_ENCRYPTION_KEY;

// Minimal config for wallet-crypto.js functions that take a config object
const LOCAL_ENCRYPTION_SERVICE_CONFIG = {
    wallet: {
        encryption: {
            ivLength: 16, // Or fetch from a shared config if available elsewhere
            algorithm: 'aes-256-gcm' // Or fetch from a shared config
        }
    }
};

const argv = yargs(hideBin(process.argv))
  .option('dry-run', {
    type: 'boolean',
    description: 'Run the script without making database changes',
    default: false,
  })
  .help()
  .alias('help', 'h')
  .argv;

async function migrateAdminKeys() {
    if (!WALLET_ENCRYPTION_KEY_HEX) {
        logApi.error(fancyColors.RED + 'Error: WALLET_ENCRYPTION_KEY environment variable is not set.' + fancyColors.RESET);
        process.exit(1);
    }
    if (WALLET_ENCRYPTION_KEY_HEX.length !== 64) {
        logApi.error(fancyColors.RED + 'Error: WALLET_ENCRYPTION_KEY must be 64 hexadecimal characters long.' + fancyColors.RESET);
        process.exit(1);
    }

    logApi.info(fancyColors.CYAN + `--- Starting Admin Wallet Key Migration to v2 Seed Format (${argv.dryRun ? 'DRY RUN' : 'LIVE RUN'}) ---` + fancyColors.RESET);
    
    const walletsToMigrate = await prisma.managed_wallets.findMany();
    logApi.info(`Found ${walletsToMigrate.length} managed wallets to process.`);

    let migratedCount = 0;
    let skippedAlreadyMigrated = 0;
    let verificationFailureCount = 0;
    let errorCount = 0;

    for (const wallet of walletsToMigrate) {
        logApi.info(`Processing wallet ID: ${wallet.id}, Public Key: ${wallet.public_key}`);
        try {
            const currentEncryptedKeyJson = wallet.encrypted_private_key;
            let currentKeyVersion = null;
            let parsedCurrentKey;
            try {
                parsedCurrentKey = JSON.parse(currentEncryptedKeyJson);
                currentKeyVersion = parsedCurrentKey.version;
            } catch (e) { /* ignore parsing error for legacy unversioned keys */ }

            if (currentKeyVersion === 'v2_seed_admin_raw') { // Check for the new raw seed version
                logApi.info(`  ${fancyColors.GREEN}Skipped:${fancyColors.RESET} Wallet already in 'v2_seed_admin_raw' format.`);
                skippedAlreadyMigrated++;
                continue;
            }
            // Optionally, also skip 'v2_seed_admin' (old string-seed version) if we consider it sufficiently migrated for now,
            // or allow it to be re-processed into 'v2_seed_admin_raw'. For this pass, let's re-process it.
            // if (currentKeyVersion === 'v2_seed_admin') {
            //     logApi.info(`  Wallet is in 'v2_seed_admin' (string seed) format. Will re-encrypt to raw seed format.`);
            // }

            // 1. Decrypt Existing Key (decryptWallet handles different versions)
            const decryptedOutput = decryptWallet(currentEncryptedKeyJson, WALLET_ENCRYPTION_KEY_HEX);

            // 2. Extract 32-Byte Seed from decryptedOutput
            let seed_32_bytes_buffer;
            if (decryptedOutput instanceof Buffer) {
                if (decryptedOutput.length === 32) { // Directly a 32b seed (e.g. from v2_seed_admin or v2_seed_admin_raw internal paths)
                    seed_32_bytes_buffer = decryptedOutput;
                } else if (decryptedOutput.length === 64) { // Legacy 64b key buffer
                    seed_32_bytes_buffer = decryptedOutput.slice(0, 32);
                } else {
                    throw new Error(`Decrypted key Buffer has unexpected length: ${decryptedOutput.length}.`);
                }
            } else if (typeof decryptedOutput === 'string') {
                logApi.warn(`  ${fancyColors.YELLOW}Skipped:${fancyColors.RESET} Wallet ID ${wallet.id} has plaintext key. Not migrating.`);
                errorCount++; continue;
            } else {
                throw new Error('Unexpected output from decryptWallet.');
            }
            if (!(seed_32_bytes_buffer instanceof Buffer && seed_32_bytes_buffer.length === 32)) {
                throw new Error(`Failed to obtain a valid 32-byte seed Buffer.`);
            }
            logApi.debug(`  Successfully obtained 32-byte seed.`);

            // 3. REMOVED: Prepare Seed String for Re-encryption. We now encrypt the buffer directly.
            // const seed_base58_string_for_encryption = bs58.encode(seed_32_bytes_buffer);

            // 4. Re-encrypt RAW SEED BUFFER with new version marker
            const newEncryptedKeyJson = encryptV2SeedBuffer(
                seed_32_bytes_buffer, 
                LOCAL_ENCRYPTION_SERVICE_CONFIG, 
                WALLET_ENCRYPTION_KEY_HEX
            );
            // newEncryptedKeyJson will now be like: {"version":"v2_seed_admin_raw", "encrypted_payload":"...", ...}
            logApi.debug(`  Re-encrypted raw seed with 'v2_seed_admin_raw' version marker.`);

            // 5. Verification Step
            const verification_decryptedSeedBuffer = decryptWallet(newEncryptedKeyJson, WALLET_ENCRYPTION_KEY_HEX);
            
            // ---- START DEBUG LOG FOR VERIFICATION INPUT ----
            if (verification_decryptedSeedBuffer instanceof Buffer) {
                logApi.warn(`  DEBUG VERIFY: verification_decryptedSeedBuffer is Buffer. Length: ${verification_decryptedSeedBuffer.length}`);
            } else {
                logApi.error(`  DEBUG VERIFY ERROR: verification_decryptedSeedBuffer is NOT a Buffer! Type: ${Object.prototype.toString.call(verification_decryptedSeedBuffer)}`, { value: verification_decryptedSeedBuffer });
            }
            // ---- END DEBUG LOG ----

            if (!(verification_decryptedSeedBuffer instanceof Buffer && verification_decryptedSeedBuffer.length === 32)) {
                logApi.error(`  ${fancyColors.RED}VERIFICATION PRE-CHECK FAILED:${fancyColors.RESET} Re-decrypted key for verification is not a 32-byte seed buffer.`, { walletId: wallet.id, type: Object.prototype.toString.call(verification_decryptedSeedBuffer), length: verification_decryptedSeedBuffer?.length });
                verificationFailureCount++; 
                continue;
            }

            const verification_signer = await createKeyPairSignerFromBytes(verification_decryptedSeedBuffer);
            
            if (verification_signer.address !== wallet.public_key) {
                logApi.error(`  ${fancyColors.RED}VERIFICATION FAILED:${fancyColors.RESET} Address mismatch! Original: ${wallet.public_key}, New: ${verification_signer.address}`, { walletId: wallet.id });
                verificationFailureCount++; 
                continue;
            }
            logApi.info(`  ${fancyColors.GREEN}Verification PASSED.${fancyColors.RESET}`);
            
            // 6. Update Database (If NOT dry run)
            if (!argv.dryRun) {
                const previousVersionDetails = parsedCurrentKey?.version || 'legacy_unversioned';
                await prisma.managed_wallets.update({
                    where: { id: wallet.id },
                    data: {
                        encrypted_private_key: newEncryptedKeyJson,
                        metadata: {
                            ...(wallet.metadata || {}),
                            key_migrated_to_v2_seed_at: new Date().toISOString(),
                            previous_key_format_details: { 
                                original_version: previousVersionDetails,
                                migration_script_version: '2.3.0' // Updated script version for raw seed migration
                            }
                        }
                    }
                });
                logApi.info(`  ${fancyColors.GREEN}SUCCESS:${fancyColors.RESET} Wallet ID ${wallet.id} migrated to v2_seed_admin_raw format.`);
            } else {
                logApi.info(`  ${fancyColors.YELLOW}DRY RUN:${fancyColors.RESET} Wallet ID ${wallet.id} would be migrated to v2_seed_admin_raw.`);
            }
            migratedCount++;

        } catch (error) {
            logApi.error(`  ${fancyColors.RED}ERROR processing wallet ID ${wallet.id}:${fancyColors.RESET} ${error.message}`);
            console.error("------- Full Error Object for Wallet ID:", wallet.id, "-------");
            console.error(error);
            console.error("-----------------------------------------------------");
            errorCount++;
        }
    }

    logApi.info(`${fancyColors.CYAN}\n--- Migration Summary (${argv.dryRun ? 'DRY RUN' : 'LIVE RUN'}) ---${fancyColors.RESET}`);
    logApi.info(`Total wallets processed: ${walletsToMigrate.length}`);
    logApi.info(`Successfully migrated (or would migrate): ${migratedCount}`);
    logApi.info(`Skipped (already v2_seed_admin_raw): ${skippedAlreadyMigrated}`);
    logApi.info(`Verification failures (skipped update): ${verificationFailureCount}`);
    logApi.info(`Other errors during processing: ${errorCount}`);

    if (!argv.dryRun && (verificationFailureCount > 0 || errorCount > 0)) {
        logApi.warn(fancyColors.YELLOW + 'Some wallets were not migrated due to verification failures or errors. Please review logs.' + fancyColors.RESET);
    } else if (argv.dryRun && (migratedCount < walletsToMigrate.length - skippedAlreadyMigrated)) {
        logApi.warn(fancyColors.YELLOW + 'Dry run indicated some wallets would not be migrated due to potential verification failures or errors. Review logs before live run.' + fancyColors.RESET);
    }

    logApi.info(`${fancyColors.CYAN}--- Migration Script Finished ---${fancyColors.RESET}`);
}

migrateAdminKeys();
