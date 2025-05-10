// services/contest-wallet/treasury-certifier.js

/**
 * TreasuryCertifier (Simplified v2)
 * Validates wallet operations and transaction flow integrity using a minimalist health check.
 * 
 * @module services/contest-wallet/treasury-certifier
 * @author BranchManager69
 * @version 2.0.0 // Updated version for v2 refactor
 * @updated $(date +%Y-%m-%d) // Updated date
 */

// V2 Solana SDK Imports
import { getAddressFromPublicKey, isAddress, address as v2Address } from '@solana/addresses';
import { generateKeyPair } from '@solana/keys'; 
import { createKeyPairSignerFromBytes } from '@solana/signers';
import { createSystemTransferInstruction } from '@solana/pay';
import { solanaEngine } from '../../services/solana-engine/index.js'; // Ensure path is correct
import { Buffer } from 'node:buffer';
import BN from 'bn.js'; 
import bs58 from 'bs58';

// Local/shared utilities
import { logApi as logger } from '../../utils/logger-suite/logger.js';
import { fancyColors as color } from '../../utils/colors.js';

export const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

/**
 * TreasuryCertifier class for handling wallet certification (Simplified v2)
 */
class TreasuryCertifier {
    /**
     * Create a new Treasury Certifier
     * 
     * @param {Object} params - Dependencies and configuration
     * @param {Object} params.solanaEngine - The SolanaEngine instance for blockchain interactions
     * @param {Object} params.prisma - The Prisma client for database access
     * @param {Object} params.logApi - The logger API (logger imported as logger)
     * @param {Object} params.formatLog - Formatting utilities for logs (passed from ContestWalletService)
     * @param {Object} params.fancyColors - Terminal color utilities (imported as color)
     * @param {Function} params.decryptPrivateKey - (Likely no longer needed for this simplified version)
     * @param {Object} params.config - Application configuration object (passed as appConfig)
     */
    constructor({ solanaEngine: se, prisma, logApi: la, formatLog: fl, fancyColors: fc, decryptPrivateKey, config: appConfig }) {
        this.solanaEngine = se;
        this.prisma = prisma; 
        this.logApi = la || logger; 
        this.formatLog = fl || { tag: () => '[TreasuryCertifier]', header: (t)=>t, success:(t)=>t, error:(t)=>t, info:(t)=>t, warning:(t)=>t };
        this.fancyColors = fc || color;
        this.appConfig = appConfig;

        // Configuration for the minimalist certification process
        this.masterFunderSeedB58 = process.env.MASTER_FUNDER_WALLET_SEED_B58 || this.appConfig?.treasury_certifier?.master_funder_seed_b58;
        this.certificationTestAmountSol = this.appConfig?.treasury_certifier?.test_amount_sol || 0.0005;
        this.certificationFundingAmountSol = this.appConfig?.treasury_certifier?.funding_amount_sol || 0.001;
        
        this.masterFunderSigner = null; // To be initialized in runCertification

        // Basic fallback for formatLog if not provided by ContestWalletService
        if (!this.formatLog) {
            this.formatLog = {
                tag: () => `${this.fancyColors.BG_MAGENTA}${this.fancyColors.BLACK} [TreasuryCertifier] ${this.fancyColors.RESET}`,
                header: (text) => `${this.fancyColors.MAGENTA_BRIGHT} --- ${text} --- ${this.fancyColors.RESET}`,
                success: (text) => `${this.fancyColors.GREEN_BRIGHT}${text}${this.fancyColors.RESET}`,
                warning: (text) => `${this.fancyColors.YELLOW_BRIGHT}${text}${this.fancyColors.RESET}`,
                error: (text) => `${this.fancyColors.RED_BRIGHT}${text}${this.fancyColors.RESET}`,
                info: (text) => `${this.fancyColors.CYAN_BRIGHT}${text}${this.fancyColors.RESET}`
            };
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning('formatLog not injected, using basic fallback.')}`);
        }
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TreasuryCertifier (v2 Minimalist) Initialized')}`);
        if (!this.masterFunderSeedB58) {
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning('MASTER_FUNDER_WALLET_SEED_B58 not configured for TreasuryCertifier.')}`);
        }
    }

    // Placeholder for the new runCertification and helper methods
    // Old methods related to file-based keypairs, QR codes, persistent pools, etc., will be removed.

    // Example of a method that will be added later:
    // async runCertification() { /* ... */ }
    // async _transferSol(sourceSigner, destinationAddressString, amountSol, operationLabel) { /* ... */ }
    // async _getSolBalance(addressString) { /* ... */ }

    /**
     * Gets SOL balance for a given address string.
     * @param {string} addressString - The base58 encoded public key.
     * @returns {Promise<bigint>} Lamports as BigInt.
     */
    async _getSolBalance(addressString) {
        if (!isAddress(addressString)) {
            this.logApi.error(`${this.formatLog.tag()} Invalid address for _getSolBalance: ${addressString}`);
            throw new Error('Invalid address provided to _getSolBalance.');
        }
        try {
            const balanceResult = await this.solanaEngine.executeConnectionMethod('getBalance', addressString);
            // connectionManager's getBalance returns { value: lamports_bigint }
            return BigInt(balanceResult.value || 0);
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} Error in _getSolBalance for ${addressString}:`, error);
            throw error; // Re-throw to be handled by runCertification
        }
    }

    /**
     * Transfers SOL from source signer to destination address.
     * @param {import('@solana/keys').KeyPairSigner} sourceSigner_v2 - The v2 signer for the source wallet.
     * @param {string} destinationAddressString - The base58 encoded public key of the destination.
     * @param {number} amountSOL - Amount of SOL to transfer.
     * @param {string} operationLabel - A label for logging this transfer operation.
     * @returns {Promise<string>} Transaction signature.
     */
    async _transferSol(sourceSigner_v2, destinationAddressString, amountSOL, operationLabel) {
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Initiating transfer (${operationLabel}): ${amountSOL} SOL from ${sourceSigner_v2.address} to ${destinationAddressString}`)}`);
        if (amountSOL <= 0) {
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Skipping zero or negative SOL transfer (${operationLabel}): ${amountSOL}`)}`);
            return null; // Or throw error, depending on desired strictness
        }
        try {
            const lamportsToTransfer = BigInt(Math.round(amountSOL * LAMPORTS_PER_SOL_V2));
            if (lamportsToTransfer <= 0) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Calculated zero or negative lamports, skipping transfer (${operationLabel}): ${lamportsToTransfer}`)}`);
                return null;
            }

            const transferInstruction_v2 = createSystemTransferInstruction({
                fromAddress: sourceSigner_v2.address,
                toAddress: v2Address(destinationAddressString),
                lamports: lamportsToTransfer
            });
            
            const result = await this.solanaEngine.sendTransaction(
                [transferInstruction_v2],
                sourceSigner_v2.address, // Fee payer is the source
                [sourceSigner_v2],       // Signer
                { commitment: 'confirmed' } // Default options, can be expanded
            );

            if (!result || !result.signature) {
                throw new Error(`solanaEngine.sendTransaction did not return a signature for ${operationLabel}.`);
            }
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transfer (${operationLabel}) successful. Sig: ${result.signature}`)}`);
            return result.signature;
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Transfer (${operationLabel}) FAILED:`)} ${error.message}`, { 
                error, source: sourceSigner_v2.address, dest: destinationAddressString, amount: amountSOL 
            });
            throw error; // Re-throw to be handled by runCertification
        }
    }

    /**
     * Runs the minimalist health check certification cycle.
     * @returns {Promise<Object>} - { success: boolean, message: string, details?: any[] }
     */
    async runCertification() {
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFIER (v2 Minimalist)')} Starting certification cycle...`);
        const results = [];
        let masterFunderSigner_v2;
        let ephemeralSourceSigner_v2;
        let ephemeralDestSigner_v2;

        try {
            // Step 1: Load Master Funder Wallet
            if (!this.appConfig.masterFunderSeedB58) {
                throw new Error('MASTER_FUNDER_WALLET_SEED_B58 not configured.');
            }
            const masterSeedBytes = bs58.decode(this.appConfig.masterFunderSeedB58);
            if (masterSeedBytes.length !== 32 && masterSeedBytes.length !== 64) { // Allow 64 if it's full keypair, take first 32
                throw new Error('Master funder seed (after bs58 decode) is not 32 or 64 bytes.');
            }
            masterFunderSigner_v2 = await createKeyPairSignerFromBytes(masterSeedBytes.slice(0, 32));
            results.push({ step: 'Load Master Funder', address: masterFunderSigner_v2.address, status: 'Success' });

            // Step 2: Check Master Funder Balance
            const masterBalanceLamports = await this._getSolBalance(masterFunderSigner_v2.address);
            const minMasterBalanceLamports = BigInt(Math.round(this.appConfig.minMasterFunderBalanceSol * LAMPORTS_PER_SOL_V2));
            if (masterBalanceLamports < minMasterBalanceLamports) {
                throw new Error(`Master funder balance (${Number(masterBalanceLamports)/LAMPORTS_PER_SOL_V2} SOL) is below minimum required (${this.appConfig.minMasterFunderBalanceSol} SOL).`);
            }
            results.push({ step: 'Check Master Balance', balanceSOL: Number(masterBalanceLamports)/LAMPORTS_PER_SOL_V2, status: 'Success' });

            // Step 3: Generate Ephemeral Wallets
            const ephSourceKP = await generateKeyPair(); // from @solana/keys
            ephemeralSourceSigner_v2 = await createKeyPairSignerFromBytes(ephSourceKP.secretKey);
            const ephDestKP = await generateKeyPair();
            ephemeralDestSigner_v2 = await createKeyPairSignerFromBytes(ephDestKP.secretKey);
            results.push({ step: 'Generate Ephemeral Wallets', source: ephemeralSourceSigner_v2.address, dest: ephemeralDestSigner_v2.address, status: 'Success' });

            // Step 4: Fund Ephemeral Source from Master
            const fundAmountSol = this.appConfig.testTransferAmountSol;
            let sig = await this._transferSol(masterFunderSigner_v2, ephemeralSourceSigner_v2.address, fundAmountSol, 'Fund Ephemeral Source');
            results.push({ step: 'Fund Ephemeral Source', amountSOL: fundAmountSol, sig, status: sig ? 'Success' : 'Failed' });
            if (!sig) throw new Error('Funding ephemeral source wallet failed.');
            await new Promise(resolve => setTimeout(resolve, 8000)); // Wait for balance update

            // Step 5: Transfer from Ephemeral Source to Ephemeral Dest
            const internalTransferAmountSol = this.appConfig.testInternalTransferAmountSol;
            sig = await this._transferSol(ephemeralSourceSigner_v2, ephemeralDestSigner_v2.address, internalTransferAmountSol, 'Internal Ephemeral Transfer');
            results.push({ step: 'Internal Ephemeral Transfer', amountSOL: internalTransferAmountSol, sig, status: sig ? 'Success' : 'Failed' });
            if (!sig) throw new Error('Internal ephemeral transfer failed.');
            await new Promise(resolve => setTimeout(resolve, 8000));

            // Step 6: Sweep remaining from Ephemeral Source back to Master
            let sourceBalanceLamports = await this._getSolBalance(ephemeralSourceSigner_v2.address);
            let sweepAmountSourceSol = (Number(sourceBalanceLamports) / LAMPORTS_PER_SOL_V2) - 0.00001; // Leave small dust for tx fee
            if (sweepAmountSourceSol > this.appConfig.sweepMinThresholdSol) {
                sig = await this._transferSol(ephemeralSourceSigner_v2, masterFunderSigner_v2.address, sweepAmountSourceSol, 'Sweep Ephemeral Source');
                results.push({ step: 'Sweep Ephemeral Source', amountSOL: sweepAmountSourceSol, sig, status: sig ? 'Success' : 'Failed' });
            } else {
                results.push({ step: 'Sweep Ephemeral Source', amountSOL: sweepAmountSourceSol, status: 'Skipped (too low)' });
            }

            // Step 7: Sweep from Ephemeral Dest back to Master
            let destBalanceLamports = await this._getSolBalance(ephemeralDestSigner_v2.address);
            let sweepAmountDestSol = (Number(destBalanceLamports) / LAMPORTS_PER_SOL_V2) - 0.00001;
            if (sweepAmountDestSol > this.appConfig.sweepMinThresholdSol) {
                sig = await this._transferSol(ephemeralDestSigner_v2, masterFunderSigner_v2.address, sweepAmountDestSol, 'Sweep Ephemeral Dest');
                results.push({ step: 'Sweep Ephemeral Dest', amountSOL: sweepAmountDestSol, sig, status: sig ? 'Success' : 'Failed' });
            } else {
                results.push({ step: 'Sweep Ephemeral Dest', amountSOL: sweepAmountDestSol, status: 'Skipped (too low)' });
            }

            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success('Treasury Certification Cycle COMPLETED SUCCESSFULLY.')}`, { details: results });
            return { success: true, message: 'Certification cycle completed successfully.', details: results };

        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error('Treasury Certification Cycle FAILED:')} ${error.message}`, { error, stack: error.stack, progress: results });
            return { success: false, message: `Certification failed: ${error.message}`, details: results };
        }
    }
}

export default TreasuryCertifier;