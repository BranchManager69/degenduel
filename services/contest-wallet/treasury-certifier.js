// services/contest-wallet/treasury-certifier.js

/**
 * TreasuryCertifier
 * Validates wallet operations and transaction flow integrity
 * 
 * This module provides independent certification that the Treasury functionality
 *   is working properly by transferring funds between wallets and verifying balances.
 * 
 * It serves as a startup proof-of-operation that all critical wallet functions
 *   are operating correctly before the service is considered fully operational.
 * 
 * @module services/contest-wallet/treasury-certifier
 * @author @BranchManager69
 * @version 1.9.0
 * @created 2025-04-21
 * @updated 2025-04-28
 * 
 */

import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import https from 'https';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import crypto from 'crypto';

/**
 * Generate a QR code for display in the console
 * Uses qrcode-terminal for TTY environments and qrcode for non-TTY environments
 * Ensures a real, scannable QR code in all environments
 * 
 * @param {string} text - The text to encode in the QR code
 * @param {number} [amount=null] - Optional amount to add to Solana URL
 * @returns {Promise<string[]>} - Array of strings representing the QR code
 */
async function generateConsoleQR(text, amount = null) {
    try {
        // Create a Solana URL with optional amount
        const solanaUrl = amount 
            ? `solana:${text}?amount=${amount}&label=DegenDuel%20Treasury%20Certification`
            : `solana:${text}?label=DegenDuel%20Treasury%20Certification`;
        
        return new Promise(async (resolve) => {
            let qrLines = [];
            
            // Check if we're in a TTY or non-TTY environment
            if (process.stdin.isTTY) {
                // In TTY environment, use qrcode-terminal for nicer display
                const customLogger = (line) => qrLines.push(line);
                qrcode.generate(solanaUrl, { small: true }, customLogger);
            } else {
                // In non-TTY environment, use the qrcode library which always works
                // Generate a real, scannable ASCII QR code
                try {
                    // Generate QR code with UTF-8 characters that will work in log files
                    const asciiQR = await QRCode.toString(solanaUrl, {
                        type: 'utf8',  // Valid option: utf8, terminal, or svg
                        small: true
                    });
                    
                    // Split into lines
                    qrLines = asciiQR.split('\n');
                    
                    // Add label for clarity in logs
                    qrLines.push("");
                    qrLines.push("REAL SCANNABLE QR CODE - USE YOUR WALLET APP");
                } catch (qrError) {
                    console.error('Error generating QR code with qrcode library:', qrError);
                    
                    // If that fails, fallback to a simple representation
                    qrLines = [
                        "Unable to generate proper QR code.",
                        "Please use the Solana URL below:"
                    ];
                }
            }
            
            // Add header and wallet info
            const result = [
                '╔═════════════════ SOLANA PAYMENT QR CODE ══════════════════╗',
                '║                                                           ║',
            ];
            
            // Safety check for address display - addresses can be long!
            const addressStr = `║  Address: ${text}`;
            const addressPadding = Math.max(0, 59 - addressStr.length); // 59 for the full width
            result.push(`${addressStr}${' '.repeat(addressPadding)}║`);
            
            if (amount) {
                const amountStr = `║  Amount: ${amount} SOL`;
                const amountPadding = Math.max(0, 59 - amountStr.length); // 59 for the full width
                result.push(`${amountStr}${' '.repeat(amountPadding)}║`);
            }
            
            result.push('║                                                           ║');
            
            // Add QR code with proper padding
            qrLines.forEach(line => {
                // Clean up the line to remove any control characters
                // that might mess up terminal rendering
                const cleanedLine = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                
                // Set fixed width for consistency
                if (cleanedLine.length >= 57) {
                    // If line is too long, truncate it to fit
                    result.push(`║ ${cleanedLine.substring(0, 57)} ║`);
                } else {
                    // Center the QR code with proper padding
                    const totalWidth = 57; // Allow for 1 space padding on each side
                    const leftPadding = Math.max(0, Math.floor((totalWidth - cleanedLine.length) / 2));
                    const rightPadding = Math.max(0, totalWidth - cleanedLine.length - leftPadding);
                    result.push(`║ ${' '.repeat(leftPadding)}${cleanedLine}${' '.repeat(rightPadding)} ║`);
                }
            });
            
            result.push('║                                                           ║');
            // Add URL representation (always visible in case QR doesn't display properly)
            result.push('║  URL: ' + solanaUrl.substring(0, 44) + (solanaUrl.length > 44 ? '...' : '') + ' '.repeat(Math.max(0, 49 - Math.min(solanaUrl.length, 47))) + '║');
            result.push('╚═══════════════════════════════════════════════════════════╝');
            
            resolve(result);
        });
    } catch (error) {
        console.error('Failed to generate QR code:', error);
        // Fallback to simple box if QR generation fails
        const lines = [];
        const walletAddress = text;
        
        // Create a border and header
        lines.push('╔═════════════════ SOLANA ADDRESS ═════════════════╗');
        lines.push('║                                                  ║');
        lines.push('║  Send funds to the following Solana address:     ║');
        lines.push('║                                                  ║');
        lines.push(`║  ${walletAddress}  ║`);
        lines.push('║                                                  ║');
        lines.push('║  Scan with any Solana wallet app or copy address ║');
        lines.push('║                                                  ║');
        lines.push('╚══════════════════════════════════════════════════╝');
        
        return lines;
    }
}

/**
 * TreasuryCertifier class for handling wallet certification
 */
class TreasuryCertifier {
    /**
     * Create a new Treasury Certifier
     * 
     * @param {Object} params - Dependencies and configuration
     * @param {Object} params.solanaEngine - The SolanaEngine instance for blockchain interactions
     * @param {Object} params.prisma - The Prisma client for database access
     * @param {Object} params.logApi - The logger API
     * @param {Object} params.formatLog - Formatting utilities for logs
     * @param {Object} params.fancyColors - Terminal color utilities
     * @param {Function} params.decryptPrivateKey - Function to decrypt private keys
     * @param {Object} params.config - Configuration object
     */
    constructor({ solanaEngine, prisma, logApi, formatLog, fancyColors, decryptPrivateKey, config }) {
        this.solanaEngine = solanaEngine;
        this.prisma = prisma;
        this.logApi = logApi;
        this.formatLog = formatLog;
        this.fancyColors = fancyColors;
        this.decryptPrivateKey = decryptPrivateKey;
        this.config = config;
        
        // Default certification test config
        this.certificationConfig = {
            numTestWallets: 3,
            walletPrefix: 'test',
            initialTestAmount: 0.006,
            minPoolBalance: 0.002,
            estimated_tx_fee: 0.000005, // Typical Solana fee
            buffer: 0.0001 // Small safety buffer
        };
        
        // Set up path for storing certification keypairs
        // Get the root project directory path
        const currentFilePath = fileURLToPath(import.meta.url);
        const projectRoot = path.resolve(path.dirname(currentFilePath), '../../');
        this.certKeypairsDir = path.join(projectRoot, 'addresses', 'certification');
        
        // Ensure the certification keypairs directory exists
        try {
            if (!fs.existsSync(this.certKeypairsDir)) {
                fs.mkdirSync(this.certKeypairsDir, { recursive: true });
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Created certification keypairs directory: ${this.certKeypairsDir}`)}`);
            }
        } catch (error) {
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to ensure certification keypairs directory exists: ${error.message}`)}`);
        }
        
        // Track current certification state for cleanup
        this._currentCertification = null;
        
        // Persistent wallet collections
        this.persistentPool = null;
        this.persistentTestWallets = {};
    }
    
    /**
     * Initialize or load the persistent certification pool
     * This sets up a reusable set of wallets for certification testing
     * 
     * @param {Object} [options] - Configuration options
     * @param {number} [options.numTestWallets] - Number of test wallets to use in certifications
     * @param {number} [options.initialFundingRequired] - Minimum SOL needed in the pool
     * @returns {Promise<{pool: Object, testWallets: Array<Object>}>} - The initialized pool and test wallets
     */
    async initPersistentCertificationPool(options = {}) {
        // Apply any custom config options
        if (options.numTestWallets) this.certificationConfig.numTestWallets = options.numTestWallets;
        if (options.initialTestAmount) this.certificationConfig.initialTestAmount = options.initialTestAmount;
        
        const initialFundingRequired = options.initialFundingRequired || this.certificationConfig.minPoolBalance;
        const numTestWallets = this.certificationConfig.numTestWallets;
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('PERSISTENT POOL')} Initializing persistent certification pool`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Using ${numTestWallets} test wallets for certification path`)}`);
        
        // Fixed path for the certification pool keypair
        const poolPath = path.join(this.certKeypairsDir, 'persistent_pool.json');
        let poolKeypair;
        
        // Check if the pool already exists
        if (fs.existsSync(poolPath)) {
            try {
                // Load the existing pool keypair
                const poolData = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
                const secretKey = Uint8Array.from(poolData.secretKey);
                poolKeypair = Keypair.fromSecretKey(secretKey);
                
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Loaded existing certification pool: ${poolKeypair.publicKey}`)}`);
                
                // Store the original funder if available
                const originalFunder = poolData.originalFunder || null;
                
                // Set up our pool object
                this.persistentPool = {
                    keypair: poolKeypair,
                    publicKey: poolKeypair.publicKey.toString(),
                    secretKey: poolKeypair.secretKey,
                    balance: 0, // Will be updated below
                    originalFunder
                };
            } catch (error) {
                this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Failed to load persistent pool: ${error.message}`)}`);
                // Create a new pool keypair
                poolKeypair = Keypair.generate();
                
                // Set up our pool object
                this.persistentPool = {
                    keypair: poolKeypair,
                    publicKey: poolKeypair.publicKey.toString(),
                    secretKey: poolKeypair.secretKey,
                    balance: 0, // Will be updated below
                    originalFunder: null
                };
            }
        } else {
            // Create a new pool keypair
            poolKeypair = Keypair.generate();
            
            // Set up our pool object
            this.persistentPool = {
                keypair: poolKeypair,
                publicKey: poolKeypair.publicKey.toString(),
                secretKey: poolKeypair.secretKey,
                balance: 0, // Will be updated below
                originalFunder: null
            };
        }
        
        // Load or create the test wallets
        this.persistentTestWallets = {};
        
        for (let i = 1; i <= numTestWallets; i++) {
            const label = `test${i}`;
            const walletPath = path.join(this.certKeypairsDir, `persistent_${label}.json`);
            let keypair;
            
            // Check if the wallet already exists
            if (fs.existsSync(walletPath)) {
                try {
                    // Load the existing wallet keypair
                    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
                    const secretKey = Uint8Array.from(walletData.secretKey);
                    keypair = Keypair.fromSecretKey(secretKey);
                    
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Loaded existing ${label} wallet: ${keypair.publicKey.toString().substring(0, 8)}...`)}`);
                } catch (error) {
                    this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Failed to load ${label} wallet: ${error.message}`)}`);
                    // Generate a new one if loading fails
                    keypair = Keypair.generate();
                }
            } else {
                // Generate a new wallet
                keypair = Keypair.generate();
                
                // Save the wallet
                const keypairData = {
                    publicKey: keypair.publicKey.toString(),
                    secretKey: Array.from(keypair.secretKey),
                    base58PrivateKey: bs58.encode(keypair.secretKey),
                    timestamp: new Date().toISOString(),
                    description: `Persistent ${label} certification wallet`,
                    type: "test",
                    label: label
                };
                
                fs.writeFileSync(walletPath, JSON.stringify(keypairData, null, 2));
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Created new ${label} wallet: ${keypair.publicKey.toString().substring(0, 8)}...`)}`);
            }
            
            // Check the wallet's balance
            const balance = await this.solanaEngine.executeConnectionMethod('getBalance', keypair.publicKey);
            
            // Store the wallet
            this.persistentTestWallets[label] = {
                keypair,
                publicKey: keypair.publicKey.toString(),
                secretKey: keypair.secretKey,
                balance: balance / LAMPORTS_PER_SOL
            };
        }
        
        // Save the pool keypair if it's new
        if (!fs.existsSync(poolPath)) {
            const poolData = {
                publicKey: poolKeypair.publicKey.toString(),
                secretKey: Array.from(poolKeypair.secretKey),
                base58PrivateKey: bs58.encode(poolKeypair.secretKey),
                timestamp: new Date().toISOString(),
                description: "Persistent certification pool wallet",
                type: "pool"
            };
            
            fs.writeFileSync(poolPath, JSON.stringify(poolData, null, 2));
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Created new certification pool: ${poolKeypair.publicKey}`)}`);
        }
        
        // Check the pool's balance
        const poolBalance = await this.solanaEngine.executeConnectionMethod('getBalance', poolKeypair.publicKey);
        this.persistentPool.balance = poolBalance / LAMPORTS_PER_SOL;
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Certification pool balance: ${this.formatLog.balance(this.persistentPool.balance)} SOL`)}`);
        
        // Check if the pool needs funding
        const neededFunding = initialFundingRequired - this.persistentPool.balance;
        if (neededFunding > 0) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('FUNDING NEEDED')} Certification pool needs ${this.formatLog.balance(neededFunding)} SOL`);
            
            // Wait for funds to be sent to the pool
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('WAITING FOR FUNDS')} `);
            this.logApi.info(`Please send at least ${neededFunding} SOL to: ${this.persistentPool.publicKey}`);
            this.logApi.info(`Initial balance: ${this.formatLog.balance(this.persistentPool.balance)} SOL`);
            
            // Generate QR code for easy scanning
            const qrLines = await generateConsoleQR(this.persistentPool.publicKey, neededFunding);
            this.logApi.info(`Generated QR code for easy scanning`);
            qrLines.forEach(line => this.logApi.info(line));
            
            // Check for funds arrival
            const checkInterval = 5000; // Check every 5 seconds
            const maxWaitTime = process.stdin.isTTY ? 5 * 60 * 1000 : 2 * 60 * 1000; // Wait up to 5 min (interactive) or 2 min (non-interactive)
            let timeoutDuration = process.stdin.isTTY ? "5 minutes" : "2 minutes";
            const startTime = Date.now();
            let fundingReceived = false;
            
            // Set up readline interface for keypress handling
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            // Set up keypress handler to allow skipping with 's' key
            let skipCertification = false;
            
            const keypressHandler = (key) => {
                if (key.toString().toLowerCase() === 's' || key.toString().toLowerCase() === 's\n') {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.warning('Skipping certification as requested by user')}`);
                    skipCertification = true;
                    
                    // Clean up the event listener
                    process.stdin.removeListener('data', keypressHandler);
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                    }
                    process.stdin.pause();
                }
            };
            
            // Only set up keypress handler in interactive mode
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                process.stdin.on('data', keypressHandler);
                
                this.logApi.info(`\n`);
                this.logApi.info(`  ⚠️  TREASURY CERTIFICATION - WAITING FOR FUNDS - SERVICE STARTUP PAUSED   ⚠️  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Send ${neededFunding} SOL to this address:                                         `);
                this.logApi.info(`  ${this.persistentPool.publicKey}  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Press 's' key to skip certification and continue startup                     `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`\n`);
            } else {
                // In non-interactive mode, provide clear instructions in the logs
                this.logApi.info(`\n`);
                this.logApi.info(`  ⚠️  TREASURY CERTIFICATION - WAITING FOR FUNDS - SERVICE STARTUP PAUSED   ⚠️  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Send ${neededFunding} SOL to this address:                                         `);
                this.logApi.info(`  ${this.persistentPool.publicKey}  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`\n`);
            }
            
            // Set up an interval to remind about the address periodically
            const addressReminderInterval = setInterval(() => {
                this.logApi.info(`\n`);
                this.logApi.info(` REMINDER: Treasury certification waiting for funds `);
                this.logApi.info(` Send ${neededFunding} SOL to: ${this.persistentPool.publicKey} `);
                if (process.stdin.isTTY) {
                    this.logApi.info(` Press 's' key to skip certification and continue `);
                }
                this.logApi.info(`\n`);
                // Display QR code again for convenience
                qrLines.forEach(line => this.logApi.info(line));
            }, 20000); // Remind every 20 seconds
            
            // Wait for funds to arrive or timeout
            while (Date.now() - startTime < maxWaitTime && !fundingReceived && !skipCertification) {
                // Wait for a bit
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
                // Check balance
                const currentBalance = await this.solanaEngine.executeConnectionMethod('getBalance', poolKeypair.publicKey);
                const solBalance = currentBalance / LAMPORTS_PER_SOL;
                
                this.logApi.info(`${this.formatLog.tag()} Still waiting for funds... Current balance: ${this.formatLog.balance(solBalance)} SOL (need ${neededFunding} SOL)`);
                
                // Check if balance increased enough
                if (solBalance >= initialFundingRequired) {
                    fundingReceived = true;
                    this.persistentPool.balance = solBalance;
                    
                    // Try to identify the sender (may not always be possible)
                    let senderAddress = null;
                    try {
                        // Get recent signatures for this address using executeConnectionMethod
                        const signatures = await this.solanaEngine.executeConnectionMethod(
                            'getSignaturesForAddress',
                            poolKeypair.publicKey,
                            { limit: 10 }
                        );
                        
                        if (signatures && signatures.length > 0) {
                            // Get the most recent transaction using executeConnectionMethod
                            const mostRecentTx = await this.solanaEngine.executeConnectionMethod(
                                'getTransaction',
                                signatures[0].signature
                            );
                            
                            if (mostRecentTx && mostRecentTx.transaction.message.accountKeys.length > 0) {
                                // The first account is usually the sender
                                senderAddress = mostRecentTx.transaction.message.accountKeys[0].toString();
                                
                                // Update the pool data with the funder
                                if (senderAddress && senderAddress !== this.persistentPool.publicKey) {
                                    this.persistentPool.originalFunder = senderAddress;
                                    
                                    // Update the saved pool data
                                    try {
                                        const poolData = JSON.parse(fs.readFileSync(poolPath, 'utf8'));
                                        poolData.originalFunder = senderAddress;
                                        fs.writeFileSync(poolPath, JSON.stringify(poolData, null, 2));
                                    } catch (updateError) {
                                        // Not critical, so just log the error
                                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to update pool data with funder: ${updateError.message}`)}`);
                                    }
                                }
                            }
                        }
                    } catch (senderError) {
                        // Not critical, so just log the error
                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to identify sender: ${senderError.message}`)}`);
                    }
                    
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funding received! New balance: ${this.formatLog.balance(solBalance)} SOL`)}`);
                    if (senderAddress && senderAddress !== this.persistentPool.publicKey) {
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funding received from ${senderAddress}`)}`);
                    }
                }
            }
            
            // Clean up the reminder interval
            clearInterval(addressReminderInterval);
            
            // Clean up key press handling
            try {
                process.stdin.removeListener('data', keypressHandler);
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                process.stdin.pause();
                rl.close();
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            // Handle timeout
            if (!fundingReceived && !skipCertification) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Timed out waiting for funds after ${timeoutDuration}.`)}`);
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Proceeding with initialization, but certification will be skipped.`)}`);
            }
        }
        
        // Update pool balances one more time
        for (const label in this.persistentTestWallets) {
            const wallet = this.persistentTestWallets[label];
            const balance = await this.solanaEngine.executeConnectionMethod('getBalance', wallet.keypair.publicKey);
            wallet.balance = balance / LAMPORTS_PER_SOL;
        }
        
        return {
            pool: this.persistentPool,
            testWallets: this.persistentTestWallets
        };
    }
    
    /**
     * Run certification with persistent wallet pool
     * This method uses the same set of wallets for all certification tests
     * 
     * @returns {Promise<Object>} - The certification result
     */
    async runPersistentCertification() {
        try {
            // Make sure we have an initialized pool and test wallets
            if (!this.persistentPool) {
                await this.initPersistentCertificationPool();
            }
            
            // Double check that the persistent pool was initialized successfully
            if (!this.persistentPool || !this.persistentPool.keypair) {
                return {
                    success: false,
                    message: "Failed to initialize persistent pool properly. Pool object is incomplete."
                };
            }
            
            // Use the test amount from config
            const testAmount = this.certificationConfig.initialTestAmount;
            
            // Generate a unique certification run ID
            const certificationId = `PERSIST-${Date.now().toString(36).toUpperCase()}`;
            
            // Start tracking this certification run
            this._currentCertification = {
                id: certificationId,
                inProgress: true,
                startTime: Date.now(),
                testAmount,
                persistentRun: true,
                wallets: {
                    pool: this.persistentPool.publicKey,
                    testWallets: Object.values(this.persistentTestWallets).map(w => w.publicKey)
                }
            };
            
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('PERSISTENT CERTIFICATION')} Starting certification with persistent wallet pool`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Certification ID: ${certificationId}, Test amount: ${testAmount} SOL`)}`);
            
            // Get the ordered wallet sequence for transfers
            const walletSequence = [];
            for (let i = 1; i <= Object.keys(this.persistentTestWallets).length; i++) {
                const wallet = this.persistentTestWallets[`test${i}`];
                if (wallet && wallet.keypair) {
                    walletSequence.push(wallet);
                }
            }
            
            // Make sure we have wallets to work with
            if (walletSequence.length === 0) {
                return {
                    success: false,
                    message: "No valid test wallets available for certification."
                };
            }
            
            // Check if we have enough in the pool
            const poolBalance = await this.solanaEngine.executeConnectionMethod('getBalance', new PublicKey(this.persistentPool.publicKey));
            this.persistentPool.balance = poolBalance / LAMPORTS_PER_SOL;
            
            // Calculate how much SOL we need in total
            const requiredAmount = testAmount * walletSequence.length + (this.certificationConfig.estimated_tx_fee * walletSequence.length * 2) + this.certificationConfig.buffer;
            
            // Check if we need more funding
            if (this.persistentPool.balance < requiredAmount) {
                // Update certification status to failed
                if (this._currentCertification && this._currentCertification.id === certificationId) {
                    this._currentCertification.inProgress = false;
                    this._currentCertification.success = false;
                    this._currentCertification.error = `Insufficient funds in persistent pool. Has ${this.persistentPool.balance} SOL, needs ${requiredAmount} SOL.`;
                    this._currentCertification.endTime = Date.now();
                    this._currentCertification.duration = this._currentCertification.endTime - this._currentCertification.startTime;
                }
                
                // Display prominent message with wallet address to fund
                const neededFunding = requiredAmount - this.persistentPool.balance;
                
                this.logApi.info(`\n`);
                this.logApi.info(`  ⚠️ ⚠️ ⚠️  PERSISTENT POOL NEEDS FUNDING  ⚠️ ⚠️ ⚠️  `);
                this.logApi.info(`  Send ${neededFunding.toFixed(4)} SOL to this address:  `);
                this.logApi.info(`  ${this.persistentPool.publicKey}  `);
                this.logApi.info(`  Current balance: ${this.persistentPool.balance} SOL, Required: ${requiredAmount} SOL  `);
                this.logApi.info(`  Waiting for funds to arrive...  `);
                this.logApi.info(`\n`);
                
                // Wait for funds for up to 2 minutes
                const maxWaitTimeMs = 120000; // 2 minutes
                const startTime = Date.now();
                const checkInterval = 10000; // Check every 10 seconds
                
                while (Date.now() - startTime < maxWaitTimeMs) {
                    // Wait for the check interval
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    
                    // Check current balance
                    try {
                        const currentBalance = await this.solanaEngine.executeConnectionMethod('getBalance', new PublicKey(this.persistentPool.publicKey));
                        const currentBalanceSOL = currentBalance / LAMPORTS_PER_SOL;
                        this.persistentPool.balance = currentBalanceSOL;
                        
                        // Calculate how much more is needed (if any)
                        const stillNeeded = requiredAmount - currentBalanceSOL;
                        
                        // If we have enough funds, don't show "still need 0.0000" message
                        if (stillNeeded <= 0) {
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Wallet ${this.persistentPool.publicKey.substring(0, 8)}... balance: ${currentBalanceSOL} SOL, which is sufficient!`)}`);
                        } else {
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Wallet ${this.persistentPool.publicKey}: balance=${currentBalanceSOL} SOL, need ${stillNeeded.toFixed(4)} SOL more`)}`);
                        }
                        
                        // If we now have enough funds, return success and allow the certification to continue
                        if (stillNeeded <= 0) {
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success('Sufficient funds received! Continuing with certification.')}`);
                            return {
                                success: true,
                                message: 'Funds received, continuing with certification'
                            };
                        }
                    } catch (error) {
                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Error checking balance: ${error.message}`)}`);
                    }
                }
                
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning('Timed out waiting for funds. Continuing with traditional certification.')}`);
                
                return {
                    success: false,
                    message: `Insufficient funds in persistent pool. Has ${this.persistentPool.balance} SOL, needs ${requiredAmount} SOL.`,
                    poolAddress: this.persistentPool.publicKey,
                    currentBalance: this.persistentPool.balance,
                    requiredAmount: requiredAmount,
                    neededFunding: neededFunding
                };
            }
            
            // Fund all test wallets from the pool with the test amount
            for (const [index, testWallet] of walletSequence.entries()) {
                const fundingSuccess = await this.fundWallet(
                    this.persistentPool.keypair,
                    testWallet.keypair.publicKey,
                    testAmount
                );
                
                if (!fundingSuccess) {
                    return {
                        success: false,
                        message: `Failed to fund test wallet ${index + 1} during certification.`
                    };
                }
                
                // Update wallet balance
                const updatedBalance = await this.solanaEngine.executeConnectionMethod('getBalance', testWallet.keypair.publicKey);
                testWallet.balance = updatedBalance / LAMPORTS_PER_SOL;
                
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funded test wallet ${index + 1}: ${testWallet.publicKey.substring(0, 8)}... with ${testAmount} SOL`)}`);
            }
            
            // Perform the certification chain: pass funds through each wallet and back to the pool
            let currentSource = walletSequence[0];
            
            // Go through the chain of wallets
            for (let i = 1; i < walletSequence.length; i++) {
                const destinationWallet = walletSequence[i];
                
                const transferSuccess = await this.fundWallet(
                    currentSource.keypair,
                    destinationWallet.keypair.publicKey,
                    testAmount * 0.9 // Transfer slightly less to account for fees
                );
                
                if (!transferSuccess) {
                    return {
                        success: false,
                        message: `Failed to transfer funds from wallet ${i} to wallet ${i + 1} during certification.`
                    };
                }
                
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transferred ${testAmount * 0.9} SOL from wallet ${i} to wallet ${i + 1}`)}`);
                
                // Update wallet balances
                const sourceBalance = await this.solanaEngine.executeConnectionMethod('getBalance', currentSource.keypair.publicKey);
                currentSource.balance = sourceBalance / LAMPORTS_PER_SOL;
                
                const destBalance = await this.solanaEngine.executeConnectionMethod('getBalance', destinationWallet.keypair.publicKey);
                destinationWallet.balance = destBalance / LAMPORTS_PER_SOL;
                
                // Move to the next wallet
                currentSource = destinationWallet;
            }
            
            // Return funds from the last wallet back to the pool
            const lastWallet = walletSequence[walletSequence.length - 1];
            
            // Get the current balance
            const lastWalletBalance = await this.solanaEngine.executeConnectionMethod('getBalance', lastWallet.keypair.publicKey);
            const returnAmount = (lastWalletBalance / LAMPORTS_PER_SOL) * 0.95; // Return most of the balance, leaving some for fees
            
            const returnSuccess = await this.fundWallet(
                lastWallet.keypair,
                new PublicKey(this.persistentPool.publicKey),
                returnAmount
            );
            
            if (!returnSuccess) {
                return {
                    success: false,
                    message: `Failed to return funds from final wallet to pool during certification.`
                };
            }
            
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Returned ${returnAmount} SOL from final wallet to pool`)}`);
            
            // Update all balances one final time
            const finalPoolBalance = await this.solanaEngine.executeConnectionMethod('getBalance', new PublicKey(this.persistentPool.publicKey));
            this.persistentPool.balance = finalPoolBalance / LAMPORTS_PER_SOL;
            
            for (const label in this.persistentTestWallets) {
                const wallet = this.persistentTestWallets[label];
                const balance = await this.solanaEngine.executeConnectionMethod('getBalance', wallet.keypair.publicKey);
                wallet.balance = balance / LAMPORTS_PER_SOL;
            }
            
            // Certification successful
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION COMPLETE')} All persistent certification tests passed!`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Final pool balance: ${this.persistentPool.balance} SOL`)}`);
            
            // Update certification status
            if (this._currentCertification && this._currentCertification.id === certificationId) {
                this._currentCertification.inProgress = false;
                this._currentCertification.success = true;
                this._currentCertification.endTime = Date.now();
                this._currentCertification.duration = this._currentCertification.endTime - this._currentCertification.startTime;
            }
            
            return {
                success: true,
                message: 'Persistent pool certification completed successfully',
                pool: {
                    address: this.persistentPool.publicKey,
                    balance: this.persistentPool.balance
                },
                testWallets: Object.keys(this.persistentTestWallets).map(label => ({
                    label,
                    address: this.persistentTestWallets[label].publicKey,
                    balance: this.persistentTestWallets[label].balance
                }))
            };
            
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Persistent certification error: ${error.message}`)}`);
            
            // Update certification status
            if (this._currentCertification && this._currentCertification.persistentRun) {
                this._currentCertification.inProgress = false;
                this._currentCertification.success = false;
                this._currentCertification.error = error.message;
                this._currentCertification.endTime = Date.now();
                this._currentCertification.duration = this._currentCertification.endTime - this._currentCertification.startTime;
            }
            
            return {
                success: false,
                message: `Persistent certification failed: ${error.message}`
            };
        }
    }
    
    /**
     * Fund a wallet with a specific amount of SOL
     * 
     * @param {Keypair} sourceKeypair - Source wallet keypair
     * @param {PublicKey|string} destinationPublicKey - Destination wallet public key
     * @param {number} amountSOL - Amount to send in SOL
     * @returns {Promise<boolean>} - True if funding succeeded
     */
    async fundWallet(sourceKeypair, destinationPublicKey, amountSOL) {
        try {
            // Parse destination public key if it's a string
            const destPubkey = typeof destinationPublicKey === 'string' 
                ? new PublicKey(destinationPublicKey)
                : destinationPublicKey;
            
            // Get current source wallet balance first
            const sourceBalance = await this.solanaEngine.executeConnectionMethod('getBalance', sourceKeypair.publicKey);
            const sourceBalanceSOL = sourceBalance / LAMPORTS_PER_SOL;
            
            // Minimum amount needed for rent exemption (approx 0.00089 SOL on Solana)
            const MIN_RENT_EXEMPTION = 0.001; // A bit more than needed to be safe
            
            // Calculate safe transfer amount that won't violate rent exemption
            // This ensures the source wallet retains enough SOL for rent exemption
            const safeAmount = Math.max(0, sourceBalanceSOL - MIN_RENT_EXEMPTION - 0.0001); // Extra buffer for fees
            
            // If requested amount exceeds safe amount, adjust it
            if (amountSOL > safeAmount) {
                // Log warning if we need to adjust the amount
                if (safeAmount <= 0) {
                    this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Cannot transfer funds: Source wallet has only ${sourceBalanceSOL} SOL, which is below or too close to minimum balance requirement`)}`);
                    return false;
                }
                
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Adjusting transfer amount from ${amountSOL} to ${safeAmount} SOL to maintain minimum balance`)}`);
                amountSOL = safeAmount;
            }
            
            // Create a simple transfer transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: sourceKeypair.publicKey,
                    toPubkey: destPubkey,
                    lamports: Math.floor(amountSOL * LAMPORTS_PER_SOL)
                })
            );
            
            // Set recent blockhash using executeConnectionMethod
            const blockhashResponse = await this.solanaEngine.executeConnectionMethod('getLatestBlockhash');
            transaction.recentBlockhash = blockhashResponse.blockhash;
            
            // Sign transaction
            transaction.sign(sourceKeypair);
            
            // Send transaction using executeConnectionMethod
            const signature = await this.solanaEngine.executeConnectionMethod('sendRawTransaction', transaction.serialize());
            
            // Wait for confirmation using executeConnectionMethod
            await this.solanaEngine.executeConnectionMethod('confirmTransaction', signature);
            
            return true;
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Failed to fund wallet: ${error.message}`)}`);
            return false;
        }
    }

    /**
     * Wait for funds to be sent to a specific wallet
     * 
     * @param {string} publicKey - The wallet address to wait for funds
     * @param {number} amount - The amount to wait for in SOL
     * @param {string} [message] - Optional message to display while waiting
     * @returns {Promise<Object>} - Result of the wait, including success flag and amount received
     */
    async waitForFunds(publicKey, amount, message = '') {
        try {
            // Set up a readline interface for key press handling
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            // Get initial balance
            const initialBalance = await this.solanaEngine.executeConnectionMethod('getBalance', new PublicKey(publicKey));
            const initialBalanceSOL = initialBalance / LAMPORTS_PER_SOL;
            
            // Display funding request with QR code
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('WAITING FOR FUNDS')} `);
            this.logApi.info(`Please send at least ${amount} SOL to: ${publicKey}`);
            this.logApi.info(`Initial balance: ${this.formatLog.balance(initialBalanceSOL)} SOL`);
            
            // Generate QR code for easy scanning
            const qrLines = await generateConsoleQR(publicKey, amount);
            this.logApi.info(`Generated QR code for easy scanning`);
            qrLines.forEach(line => this.logApi.info(line));
            
            // Set up keypress handler to allow skipping with 's' key
            let skipCertification = false;
            
            const keypressHandler = (key) => {
                if (key.toString().toLowerCase() === 's' || key.toString().toLowerCase() === 's\n') {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.warning('Skipping certification as requested by user')}`);
                    skipCertification = true;
                    
                    // Clean up the event listener
                    process.stdin.removeListener('data', keypressHandler);
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                    }
                    process.stdin.pause();
                }
            };
            
            // Only set up keypress handler in interactive mode
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
                process.stdin.resume();
                process.stdin.setEncoding('utf8');
                process.stdin.on('data', keypressHandler);
                
                this.logApi.info(`\n`);
                this.logApi.info(`  ⚠️  TREASURY CERTIFICATION - WAITING FOR FUNDS - SERVICE STARTUP PAUSED   ⚠️  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Send ${amount} SOL to this address:                                         `);
                this.logApi.info(`  ${publicKey}  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Press 's' key to skip certification and continue startup                     `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`\n`);
            } else {
                // In non-interactive mode, provide clear instructions in the logs
                this.logApi.info(`\n`);
                this.logApi.info(`  ⚠️  TREASURY CERTIFICATION - WAITING FOR FUNDS - SERVICE STARTUP PAUSED   ⚠️  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`  Send ${amount} SOL to this address:                                         `);
                this.logApi.info(`  ${publicKey}  `);
                this.logApi.info(`                                                                                `);
                this.logApi.info(`\n`);
            }
            
            // Set up reminder interval
            const addressReminderInterval = setInterval(() => {
                this.logApi.info(`\n`);
                this.logApi.info(` REMINDER: Treasury certification waiting for funds `);
                this.logApi.info(` Send ${amount} SOL to: ${publicKey} `);
                if (process.stdin.isTTY) {
                    this.logApi.info(` Press 's' key to skip certification and continue `);
                }
                this.logApi.info(`\n`);
                // Display QR code again for convenience
                qrLines.forEach(line => this.logApi.info(line));
            }, 20000); // Remind every 20 seconds
            
            // Start polling for balance changes
            const checkInterval = 5000; // Check every 5 seconds
            const maxWaitTime = process.stdin.isTTY ? 5 * 60 * 1000 : 2 * 60 * 1000; // Wait up to 5 min (interactive) or 2 min (non-interactive)
            const startTime = Date.now();
            
            let receivedAmount = 0;
            let senderAddress = null;
            
            // Run the check loop
            while (Date.now() - startTime < maxWaitTime && !skipCertification) {
                // Wait for the check interval
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                
                // Check current balance
                const currentBalance = await this.solanaEngine.executeConnectionMethod('getBalance', new PublicKey(publicKey));
                const currentBalanceSOL = currentBalance / LAMPORTS_PER_SOL;
                
                // Check if we received funds
                const balanceIncrease = currentBalanceSOL - initialBalanceSOL;
                
                this.logApi.info(`${this.formatLog.tag()} Still waiting for funds... Current balance: ${this.formatLog.balance(currentBalanceSOL)} SOL (need ${amount} SOL)`);
                
                if (balanceIncrease >= amount) {
                    // We received sufficient funds
                    receivedAmount = balanceIncrease;
                    
                    // Try to identify the sender
                    try {
                        // Use executeConnectionMethod instead of direct connection access
                        // This ensures we're using the proper connection with retries and error handling
                        const signatures = await this.solanaEngine.executeConnectionMethod(
                            'getSignaturesForAddress',
                            new PublicKey(publicKey),
                            { limit: 5 }
                        );
                        
                        if (signatures && signatures.length > 0) {
                            const txInfo = await this.solanaEngine.executeConnectionMethod(
                                'getTransaction',
                                signatures[0].signature
                            );
                            if (txInfo && txInfo.transaction && txInfo.transaction.message.accountKeys.length > 0) {
                                // The first account is usually the sender
                                senderAddress = txInfo.transaction.message.accountKeys[0].toString();
                                
                                if (senderAddress === publicKey) {
                                    // If it's the same address, try the second one
                                    senderAddress = txInfo.transaction.message.accountKeys[1]?.toString() || null;
                                }
                            }
                        }
                    } catch (error) {
                        // Not critical, so just log
                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to identify sender: ${error.message}`)}`);
                    }
                    
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funding received! Detected ${receivedAmount} SOL sent to certification wallet.`)}`);
                    if (senderAddress) {
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funding received from ${senderAddress}`)}`);
                    }
                    
                    // Clean up and exit the loop
                    clearInterval(addressReminderInterval);
                    
                    if (process.stdin.isTTY) {
                        process.stdin.removeListener('data', keypressHandler);
                        process.stdin.setRawMode(false);
                        process.stdin.pause();
                    }
                    
                    rl.close();
                    return { 
                        success: true, 
                        amount: receivedAmount, 
                        sender: senderAddress 
                    };
                }
            }
            
            // If we reach here, we either timed out or the certification was skipped
            clearInterval(addressReminderInterval);
            
            if (skipCertification) {
                return { success: false, skipped: true };
            }
            
            // We timed out
            const timeoutDuration = process.stdin.isTTY ? "5 minutes" : "2 minutes";
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Timed out waiting for funds after ${timeoutDuration}.`)}`);
            return { success: false, timeout: true };
        } catch (error) {
            // Make sure to clear the interval if there's an error
            if (addressReminderInterval) {
                clearInterval(addressReminderInterval);
            }
            
            // Clean up key press handling
            try {
                process.stdin.removeListener('data', keypressHandler);
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }
                process.stdin.pause();
                rl.close();
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Error waiting for funds: ${error.message}`)}`);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Run the complete certification process
     * 
     * @param {number} [delayMs=5000] - Initial delay in milliseconds before certification
     * @returns {Promise<Object>} - Result of the certification process
     */
    async runCertification(delayMs = 5000) {
        // Check if we already have a certification in progress
        if (this._currentCertification) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION IN PROGRESS')} Certification already running with ID: ${this._currentCertification.id}`);
            // Return the current certification status
            return { success: false, inProgress: true, message: "Certification already in progress" };
        }
        
        // First, try to use the persistent pool if available
        if (this.persistentPool) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('PERSISTENT CERTIFICATION')} Using persistent certification pool`);
            
            try {
                // Run certification with persistent wallets
                const result = await this.runPersistentCertification();
                
                if (result.success) {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION COMPLETE')} All operations validated using persistent pool.`);
                } else {
                    this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.header('PERSISTENT CERTIFICATION FAILED')} ${result.message}`);
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info('Falling back to traditional certification...')}`);
                    
                    // Fall back to traditional certification below
                }
                
                // If successful, return the result
                if (result.success) {
                    return result;
                }
                
                // If failed, continue with traditional certification
            } catch (poolError) {
                this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Error using persistent pool: ${poolError.message}`)}`);
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info('Falling back to traditional certification...')}`);
                
                // Fall back to traditional certification below
            }
        }
        
        // Traditional certification flow (if persistent pool isn't available or failed)
        // Get test amount from config
        const testAmount = this.config.service_test?.contest_wallet_test_amount || 0.006;
        
        // If we already have a certification in progress, don't start a new one
        // EXCEPT when we're falling back from a failed persistent certification
        // which we can detect by checking if the current certification has persistentRun=true
        if (this._currentCertification && this._currentCertification.inProgress && 
            !(this._currentCertification.persistentRun && !this._currentCertification.success)) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION IN PROGRESS')} Using existing certification with ID: ${this._currentCertification.id}`);
            return { 
                success: false, 
                inProgress: true,
                message: "Certification already in progress" 
            };
        }
        
        // If we're falling back from a failed persistent run, reset it
        if (this._currentCertification && this._currentCertification.persistentRun && !this._currentCertification.success) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info('Resetting failed persistent certification to try traditional method')}`);
            this._currentCertification = null;
        }
        
        // Generate a unique certification ID
        const certificationId = `CERT-${Date.now().toString(36).toUpperCase()}`;
        
        // Log startup banner
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFIER')} Starting treasury certification process`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Certification ID: ${certificationId}, Initial delay: ${delayMs/1000}s, Test amount: ${testAmount} SOL`)}`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Keypairs will be saved to ${this.certKeypairsDir}`)}`);
        
        // Set current certification tracking
        this._currentCertification = {
            id: certificationId,
            inProgress: true,
            startTime: Date.now(),
            testAmount,
            wallets: {}
        };
        
        // Wait for initial delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        // Generate source wallet for test
        const sourceKeypair = Keypair.generate();
        const sourcePublicKey = sourceKeypair.publicKey.toString();
        
        // Store keypair in certification state for recovery
        if (this._currentCertification) {
            this._currentCertification.wallets.source = sourcePublicKey;
            
            // Save the source wallet keypair to file
            const sourceKeypairData = {
                publicKey: sourcePublicKey,
                secretKey: Array.from(sourceKeypair.secretKey),
                base58PrivateKey: bs58.encode(sourceKeypair.secretKey),
                timestamp: new Date().toISOString(),
                certificationId,
                description: "Certification source wallet",
                type: "source"
            };
            
            const sourceKeypairPath = path.join(this.certKeypairsDir, `certification_source_${certificationId}.json`);
            fs.writeFileSync(sourceKeypairPath, JSON.stringify(sourceKeypairData, null, 2));
        }
        
        // Check for available contest wallet
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFIER')} Checking for available contest wallet...`);
        
        // Request funds to the source wallet
        const fundingResult = await this.waitForFunds(sourcePublicKey, testAmount);
        
        if (!fundingResult.success) {
            if (fundingResult.skipped) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning('Certification skipped by user')}`);
                
                // Update certification status
                if (this._currentCertification && this._currentCertification.id === certificationId) {
                    this._currentCertification.inProgress = false;
                    this._currentCertification.skipped = true;
                    this._currentCertification.endTime = Date.now();
                }
                
                return { success: false, skipped: true };
            } else if (fundingResult.timeout) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning('Certification timed out waiting for funds')}`);
                
                // Update certification status
                if (this._currentCertification && this._currentCertification.id === certificationId) {
                    this._currentCertification.inProgress = false;
                    this._currentCertification.timeout = true;
                    this._currentCertification.endTime = Date.now();
                }
                
                return { success: false, timeout: true };
            } else {
                this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Error during funding: ${fundingResult.error || 'Unknown error'}`)}`);
                
                // Update certification status
                if (this._currentCertification && this._currentCertification.id === certificationId) {
                    this._currentCertification.inProgress = false;
                    this._currentCertification.error = fundingResult.error || 'Unknown error during funding';
                    this._currentCertification.endTime = Date.now();
                }
                
                return { success: false, error: fundingResult.error || 'Unknown error' };
            }
        }
        
        // If we reach here, we received funding and can continue with certification
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION')} Funding received, continuing certification...`);
        
        // Generate intermediate wallets for testing
        const intermediateKeypair = Keypair.generate();
        const intermediatePublicKey = intermediateKeypair.publicKey.toString();
        
        // Store keypair in certification state
        if (this._currentCertification) {
            this._currentCertification.wallets.intermediate = intermediatePublicKey;
            
            // Save the intermediate wallet keypair to file
            const intermediateKeypairData = {
                publicKey: intermediatePublicKey,
                secretKey: Array.from(intermediateKeypair.secretKey),
                base58PrivateKey: bs58.encode(intermediateKeypair.secretKey),
                timestamp: new Date().toISOString(),
                certificationId,
                description: "Certification intermediate wallet",
                type: "intermediate"
            };
            
            const intermediateKeypairPath = path.join(this.certKeypairsDir, `certification_intermediate_${certificationId}.json`);
            fs.writeFileSync(intermediateKeypairPath, JSON.stringify(intermediateKeypairData, null, 2));
        }
        
        // Generate target wallet for testing
        const targetKeypair = Keypair.generate();
        const targetPublicKey = targetKeypair.publicKey.toString();
        
        // Store keypair in certification state
        if (this._currentCertification) {
            this._currentCertification.wallets.target = targetPublicKey;
            
            // Save the target wallet keypair to file
            const targetKeypairData = {
                publicKey: targetPublicKey,
                secretKey: Array.from(targetKeypair.secretKey),
                base58PrivateKey: bs58.encode(targetKeypair.secretKey),
                timestamp: new Date().toISOString(),
                certificationId,
                description: "Certification target wallet",
                type: "target"
            };
            
            const targetKeypairPath = path.join(this.certKeypairsDir, `certification_target_${certificationId}.json`);
            fs.writeFileSync(targetKeypairPath, JSON.stringify(targetKeypairData, null, 2));
        }
        
        try {
            // Step 1: Transfer from source to intermediate wallet
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION')} Step 1: Transfer from source to intermediate wallet...`);
            
            const transferAmount1 = testAmount * 0.9; // Transfer 90% to account for fees
            const transfer1Success = await this.fundWallet(sourceKeypair, intermediatePublicKey, transferAmount1);
            
            if (!transfer1Success) {
                throw new Error('Failed to transfer funds from source to intermediate wallet');
            }
            
            // Get intermediate wallet balance to verify
            const intermediateBalance = await this.solanaEngine.executeConnectionMethod('getBalance', intermediateKeypair.publicKey);
            const intermediateBalanceSOL = intermediateBalance / LAMPORTS_PER_SOL;
            
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transferred ${transferAmount1} SOL to intermediate wallet. Balance: ${intermediateBalanceSOL} SOL`)}`);
            
            // Step 2: Transfer from intermediate to target wallet
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION')} Step 2: Transfer from intermediate to target wallet...`);
            
            const transferAmount2 = transferAmount1 * 0.9; // Transfer 90% to account for fees
            const transfer2Success = await this.fundWallet(intermediateKeypair, targetPublicKey, transferAmount2);
            
            if (!transfer2Success) {
                throw new Error('Failed to transfer funds from intermediate to target wallet');
            }
            
            // Get target wallet balance to verify
            const targetBalance = await this.solanaEngine.executeConnectionMethod('getBalance', targetKeypair.publicKey);
            const targetBalanceSOL = targetBalance / LAMPORTS_PER_SOL;
            
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transferred ${transferAmount2} SOL to target wallet. Balance: ${targetBalanceSOL} SOL`)}`);
            
            // Step 3: If a recovery address is specified, return funds there
            if (fundingResult.sender && fundingResult.sender !== sourcePublicKey) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION')} Step 3: Returning funds to original sender...`);
                
                const returnAmount = targetBalanceSOL * 0.9; // Return 90% to account for fees
                const returnSuccess = await this.fundWallet(targetKeypair, fundingResult.sender, returnAmount);
                
                if (returnSuccess) {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Returned ${returnAmount} SOL to original sender: ${fundingResult.sender}`)}`);
                } else {
                    this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to return funds to original sender. The sender can recover ${targetBalanceSOL} SOL from: ${targetPublicKey}`)}`);
                }
            } else {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION')} No identifiable sender, skipping return step.`);
            }
            
            // Certification completed successfully
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('CERTIFICATION COMPLETE')} All tests passed!`);
            
            // Update certification status
            if (this._currentCertification && this._currentCertification.id === certificationId) {
                this._currentCertification.inProgress = false;
                this._currentCertification.success = true;
                this._currentCertification.endTime = Date.now();
                this._currentCertification.duration = this._currentCertification.endTime - this._currentCertification.startTime;
            }
            
            // Return successful result
            return {
                success: true,
                message: 'Certification completed successfully',
                wallets: {
                    source: sourcePublicKey,
                    intermediate: intermediatePublicKey,
                    target: targetPublicKey
                },
                certificationId
            };
            
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Certification error: ${error.message}`)}`);
            
            // Update certification status
            if (this._currentCertification && this._currentCertification.id === certificationId) {
                this._currentCertification.inProgress = false;
                this._currentCertification.success = false;
                this._currentCertification.error = error.message;
                this._currentCertification.endTime = Date.now();
                this._currentCertification.duration = this._currentCertification.endTime - this._currentCertification.startTime;
            }
            
            // Return error result
            return {
                success: false,
                error: error.message,
                wallets: {
                    source: sourcePublicKey,
                    intermediate: intermediatePublicKey,
                    target: targetPublicKey
                },
                certificationId
            };
        }
    }
    
    /**
     * Scan for stranded funds from previous certification runs
     * Attempts to identify and recover funds from wallets created in previous runs
     * 
     * @param {string} recoveryAddress - The address to send recovered funds to (usually the treasury wallet)
     * @returns {Promise<Object>} - Result of the recovery operation, including total amount recovered
     */
    async scanForStrandedFunds(recoveryAddress) {
        // Make sure the directory exists
        if (!fs.existsSync(this.certKeypairsDir)) {
            try {
                fs.mkdirSync(this.certKeypairsDir, { recursive: true });
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Created certification keypairs directory: ${this.certKeypairsDir}`)}`);
            } catch (error) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to ensure certification keypairs directory exists: ${error.message}`)}`);
                return {
                    recoveredFunds: false,
                    totalRecovered: 0,
                    error: `Failed to access certification directory: ${error.message}`
                };
            }
        }
        
        // Initialize persistent pool if we don't have it yet
        if (!this.persistentPool) {
            await this.initPersistentCertificationPool();
        }
        
        // If no recovery address is provided, try to use the original funder
        if (!recoveryAddress && this.persistentPool.originalFunder) {
            recoveryAddress = this.persistentPool.originalFunder;
        }
        
        // Find wallet keypair files
        const files = fs.readdirSync(this.certKeypairsDir);
        const keypairFiles = files.filter(file => file.includes('certification_') && file.endsWith('.json'));
        
        if (keypairFiles.length === 0) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info('No certification keypair files found.')}`);
            return {
                recoveredFunds: false,
                totalRecovered: 0
            };
        }
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Found ${keypairFiles.length} potential certification keypair files.`)}`);
        
        // Process each wallet to check for funds
        let totalRecovered = 0;
        const recoveryDetails = [];
        
        for (const file of keypairFiles) {
            try {
                // Load the keypair data
                const keypairData = JSON.parse(fs.readFileSync(path.join(this.certKeypairsDir, file), 'utf8'));
                const secretKey = Uint8Array.from(keypairData.secretKey);
                const keypair = Keypair.fromSecretKey(secretKey);
                const walletAddress = keypair.publicKey.toString();
                
                // Check for balance
                const balance = await this.solanaEngine.executeConnectionMethod('getBalance', keypair.publicKey);
                const balanceSOL = balance / LAMPORTS_PER_SOL;
                
                // If the wallet has a balance, try to recover the funds
                if (balanceSOL > 0.001) { // Recover if more than 0.001 SOL (to account for transaction fees)
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Found ${balanceSOL} SOL in wallet: ${walletAddress} (${file})`)}`);
                    
                    // Calculate amount to recover (90% of balance to account for fees)
                    const recoverAmount = balanceSOL * 0.9;
                    
                    // Transfer the funds to the recovery address
                    const transferSuccess = await this.fundWallet(keypair, recoveryAddress, recoverAmount);
                    
                    if (transferSuccess) {
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Recovered ${recoverAmount} SOL from wallet: ${walletAddress} to ${recoveryAddress}`)}`);
                        
                        totalRecovered += recoverAmount;
                        recoveryDetails.push({
                            walletAddress,
                            file,
                            recovered: recoverAmount,
                            originalBalance: balanceSOL
                        });
                    } else {
                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Failed to recover ${recoverAmount} SOL from wallet: ${walletAddress}`)}`);
                    }
                }
            } catch (error) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Error processing keypair file ${file}: ${error.message}`)}`);
            }
        }
        
        // Return the recovery results
        return {
            recoveredFunds: totalRecovered > 0,
            totalRecovered,
            details: recoveryDetails
        };
    }
}

export default TreasuryCertifier;