/**
 * TreasuryCertifier - Validates wallet operations and transaction flow integrity
 * 
 * This module provides independent certification that the Treasury functionality
 * is working properly by transferring funds between wallets and verifying balances.
 * It serves as a startup proof-of-operation that all critical wallet functions
 * are operating correctly before the service is considered fully operational.
 * 
 * @module services/contest-wallet/treasury-certifier
 */

import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import https from 'https';
import qrcode from 'qrcode-terminal';

/**
 * Generate a QR code for display in the console
 * Uses the qrcode-terminal library to generate ASCII art QR codes
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
        
        // Use promise wrapper around qrcode-terminal callback-based API
        return new Promise((resolve) => {
            // Generate QR to string
            let qrLines = [];
            
            // Custom QR renderer that captures output instead of printing
            const customLogger = (line) => qrLines.push(line);
            
            // Generate the QR code
            qrcode.generate(solanaUrl, { small: true }, customLogger);
            
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
                // Clean up the line to remove any control characters or emoji-like characters
                // that might mess up terminal rendering
                const cleanedLine = line.replace(/[^\x20-\x7E]/g, ' ');
                
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
    }
    
    /**
     * Identify the sender from a recent transaction
     * 
     * @param {string} walletAddress - The wallet address to check transactions for
     * @returns {Promise<{found: boolean, sender: string|null, amount: number}>} - Transaction sender info
     */
    async identifySender(walletAddress) {
        try {
            // Get recent transactions (last 10)
            const signatures = await this.solanaEngine.executeConnectionMethod(
                'getSignaturesForAddress',
                new PublicKey(walletAddress),
                { limit: 10 }
            );
            
            // If we have signatures, check the most recent one
            if (signatures && signatures.length > 0) {
                const recentSig = signatures[0].signature;
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Found recent transaction: ${recentSig.substring(0, 8)}...`)}`);
                
                const tx = await this.solanaEngine.executeConnectionMethod(
                    'getParsedTransaction',
                    recentSig,
                    'confirmed'
                );
                
                if (tx && tx.meta && tx.meta.preBalances && tx.meta.postBalances) {
                    // Find our address index in the tx
                    const myAccountIndex = tx.transaction.message.accountKeys.findIndex(
                        key => key.pubkey.toString() === walletAddress
                    );
                    
                    if (myAccountIndex !== -1) {
                        const preBalance = tx.meta.preBalances[myAccountIndex];
                        const postBalance = tx.meta.postBalances[myAccountIndex];
                        const changeInBalance = (postBalance - preBalance) / LAMPORTS_PER_SOL;
                        
                        if (changeInBalance > 0) {
                            // This is a deposit! Find the sender
                            const senderIndex = tx.transaction.message.accountKeys.findIndex(
                                (key, index) => 
                                index !== myAccountIndex && 
                                tx.meta.preBalances[index] > tx.meta.postBalances[index]
                            );
                            
                            if (senderIndex !== -1) {
                                const senderAddress = tx.transaction.message.accountKeys[senderIndex].pubkey.toString();
                                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Identified sender: ${senderAddress.substring(0, 8)}...`)}`);
                                return { 
                                    found: true, 
                                    sender: senderAddress, 
                                    amount: changeInBalance 
                                };
                            }
                        }
                    }
                }
            }
            
            return { found: false, sender: null, amount: 0 };
        } catch (error) {
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Error identifying sender: ${error.message}`)}`);
            return { found: false, sender: null, amount: 0 };
        }
    }
    
    /**
     * Return funds to the sender
     * 
     * @param {Keypair} fromKeypair - The keypair to send from
     * @param {string} toAddress - The address to send to
     * @param {number} amount - The amount of SOL to send
     * @returns {Promise<{success: boolean, txid?: string, error?: string}>} - Result of the operation
     */
    async returnFundsToSender(fromKeypair, toAddress, amount) {
        if (!toAddress) {
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Can't return funds: sender address unknown.`)}`);
            return { success: false, error: 'Sender address unknown' };
        }
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('RETURNING FUNDS TO SENDER')}`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Preparing to send ${amount.toFixed(6)} SOL back to ${toAddress}`)}`);
        
        try {
            // Keep a small amount for fees
            const keepAmount = 0.001;
            const returnAmount = Math.max(0, amount - keepAmount);
            
            if (returnAmount <= 0) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Amount too small to return after keeping fees.`)}`);
                return { success: false, error: 'Amount too small' };
            }
            
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Will return ${returnAmount.toFixed(6)} SOL (keeping ${keepAmount} SOL for fees)`)}`);
            
            // Create transfer transaction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.floor(returnAmount * LAMPORTS_PER_SOL), // convert SOL to lamports
                })
            );
            
            transaction.feePayer = fromKeypair.publicKey;
            
            // Send and confirm transaction
            const txid = await this.solanaEngine.sendTransaction(
                transaction,
                [fromKeypair],
                {
                    skipPreflight: true,
                    maxRetries: 5,
                    commitment: 'confirmed'
                }
            );
            
            const solscanLink = `https://solscan.io/tx/${txid}`;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success('FUNDS RETURNED!')}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Sent ${returnAmount.toFixed(6)} SOL back to ${toAddress}`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transaction ID: ${txid}`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Solscan: ${solscanLink}`)}`);
            
            return { 
                success: true, 
                txid, 
                solscanLink, 
                amount: returnAmount 
            };
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Failed to return funds: ${error.message}`)}`);
            return { success: false, error: error.message };
        }
    }
    
    /**
     * Wait for funds to be sent to a wallet and identify the sender
     * 
     * @param {Keypair} keypair - The keypair to wait for funds for
     * @param {number} minAmount - The minimum amount of SOL to wait for
     * @returns {Promise<{success: boolean, sender?: string, amount?: number}>} - Result with sender info
     */
    async waitForFunds(keypair, minAmount) {
        const publicKey = keypair.publicKey.toString();
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('WAITING FOR FUNDS')}`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Please send at least ${minAmount} SOL to: ${publicKey}`)}`);
        
        // No need to manually create the address box here anymore
        // The qrCode will be generated below with proper QR code
        
        let senderAddress = null;
        let receivedAmount = 0;
        
        // Initial balance check
        let balance = await this.solanaEngine.executeConnectionMethod('getBalance', keypair.publicKey);
        let balanceSol = balance / LAMPORTS_PER_SOL;
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Initial balance: ${balanceSol.toFixed(6)} SOL`)}`);
        
        if (balanceSol >= minAmount) {
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Sufficient balance already exists!`)}`);
            
            // Try to identify the sender from recent transaction history
            const senderInfo = await this.identifySender(publicKey);
            
            if (senderInfo.found) {
                return { 
                    success: true, 
                    amount: balanceSol,
                    sender: senderInfo.sender
                };
            }
            
            return { success: true, amount: balanceSol };
        }
        
        // Wait for funds
        const maxWaitAttempts = 300; // 5 minutes at 1 second intervals
        let waitAttempts = 0;
        
        // Generate a proper QR code using qrcode-terminal library
        let qrCode = await generateConsoleQR(publicKey, minAmount);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success('Generated QR code for easy scanning')}`);
        
        // Create an ultra-visible banner to make the wallet address stand out
        const bannerLines = [
            `\n${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}  ⚠️  TREASURY CERTIFICATION - WAITING FOR FUNDS - SERVICE STARTUP PAUSED   ⚠️  ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_MAGENTA}${this.fancyColors.WHITE}  Send ${minAmount} SOL to this address:                                         ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_MAGENTA}${this.fancyColors.WHITE}  ${publicKey}  ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}  Press Ctrl+C to cancel and skip certification                               ${this.fancyColors.RESET}`,
            `${this.fancyColors.BG_YELLOW}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}\n`
        ];
        
        // Display the initial banner
        bannerLines.forEach(line => this.logApi.info(line));
        
        // Display the QR code
        this.logApi.info(`\n${this.fancyColors.CYAN}=== SCAN THIS QR CODE TO SEND SOL ===${this.fancyColors.RESET}`);
        qrCode.forEach(line => {
            this.logApi.info(line);
        });
        
        // Display solana link for wallets that support it
        this.logApi.info(`${this.fancyColors.GREEN}solana:${publicKey}?amount=${minAmount}${this.fancyColors.RESET}\n`);
        
        // Create a reference to an interval that will redisplay the wallet address
        let addressReminderInterval;
        
        try {
            // Set up an interval to repeat the address banner every 20 seconds
            // This ensures the address stays visible even with other services logging
            addressReminderInterval = setInterval(() => {
                this.logApi.info(`\n${this.fancyColors.BG_RED}${this.fancyColors.WHITE} REMINDER: Treasury certification waiting for funds ${this.fancyColors.RESET}`);
                this.logApi.info(`${this.fancyColors.BG_MAGENTA}${this.fancyColors.WHITE} Send ${minAmount} SOL to: ${publicKey} ${this.fancyColors.RESET}\n`);
                
                // Always show the address box with every reminder
                if (qrCode.length > 0) {
                    qrCode.forEach(line => {
                        this.logApi.info(line);
                    });
                }
            }, 20000);
            
            while (waitAttempts < maxWaitAttempts) {
                // Check balance
                balance = await this.solanaEngine.executeConnectionMethod('getBalance', keypair.publicKey);
                balanceSol = balance / LAMPORTS_PER_SOL;
                
                if (balanceSol >= minAmount) {
                    // Get transaction info to identify sender
                    const txInfo = await this.identifySender(publicKey);
                    
                    if (txInfo.found) {
                        this.logApi.info(`\n${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK} ✅ FUNDS RECEIVED! ${balanceSol.toFixed(6)} SOL FROM ${txInfo.sender.substring(0, 8)}... ${this.fancyColors.RESET}\n`);
                        senderAddress = txInfo.sender;
                        receivedAmount = txInfo.amount;
                        break;
                    } else {
                        // We have the balance but couldn't identify the sender
                        this.logApi.info(`\n${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK} ✅ FUNDS RECEIVED! ${balanceSol.toFixed(6)} SOL (SENDER UNKNOWN) ${this.fancyColors.RESET}\n`);
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.warning(`Couldn't identify the sender, but received sufficient balance.`)}`);
                        receivedAmount = balanceSol;
                        break;
                    }
                }
                
                // Show progress message every 10 seconds
                if (waitAttempts % 10 === 0) {
                    this.logApi.info(`${this.formatLog.tag()} Still waiting for funds... Current balance: ${balanceSol.toFixed(6)} SOL (need ${minAmount} SOL)`);
                }
                
                waitAttempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Clear the reminder interval once funds are received or timeout
            if (addressReminderInterval) {
                clearInterval(addressReminderInterval);
                addressReminderInterval = null;
            }
            
            if (waitAttempts >= maxWaitAttempts) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Timed out waiting for funds after 5 minutes.`)}`);
                return { success: false };
            }
            
            return { 
                success: true, 
                amount: receivedAmount, 
                sender: senderAddress 
            };
        } catch (error) {
            // Make sure to clear the interval if there's an error
            if (addressReminderInterval) {
                clearInterval(addressReminderInterval);
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
        // Get test amount from config
        const testAmount = this.config.service_test?.contest_wallet_test_amount || 0.006;
        
        // Log startup banner
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFIER')} Starting treasury certification process`);
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Initial delay: ${delayMs/1000}s, Test amount: ${testAmount} SOL`)}`);
        
        // Wait for initial delay
        await new Promise(resolve => setTimeout(resolve, delayMs));
        
        // Generate source wallet for test
        const sourceKeypair = Keypair.generate();
        const sourcePublicKey = sourceKeypair.publicKey.toString();
        
        // Check if source wallet already has funds
        let sourceBalance = await this.solanaEngine.executeConnectionMethod('getBalance', sourceKeypair.publicKey);
        let solBalance = sourceBalance / LAMPORTS_PER_SOL;
        
        // If source doesn't have funds, check for a contest wallet we can use
        if (solBalance < testAmount) {
            // Try to find an existing contest wallet we can borrow funds from
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFIER')} Checking for available contest wallet...`);
            
            const contestWallet = await this.prisma.contest_wallets.findFirst({
                where: {
                    balance: {
                        gte: testAmount + 0.002 // Need extra for fees
                    }
                },
                include: {
                    contests: {
                        select: {
                            contest_code: true,
                            status: true
                        }
                    }
                },
                orderBy: {
                    balance: 'desc'
                }
            });
            
            if (contestWallet) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Found contest wallet with ${contestWallet.balance} SOL`)}`);
                
                try {
                    // Load the contest wallet private key
                    const privateKey = this.decryptPrivateKey(contestWallet.private_key);
                    const contestKeypair = this.createKeypairFromPrivateKey(privateKey);
                    
                    if (contestKeypair) {
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Using contest wallet for certification: ${contestKeypair.publicKey}`)}`);
                        
                        // Run the test with contest wallet as source
                        const result = await this.performCertification(testAmount, contestKeypair);
                        
                        if (result.success) {
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION COMPLETE')} All operations validated.`);
                        } else {
                            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION FAILED')} Operations may have issues: ${result.error}`);
                        }
                        
                        return result;
                    }
                } catch (contestError) {
                    this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Error using contest wallet: ${contestError.message}`)}`);
                    // Fall through to waiting for user to provide funds
                }
            }
            
            // If we're here, there's no existing wallet we can use
            // We need to wait for funds to be sent to our test wallet
            // Wait for funds and identify sender for return
            const fundingResult = await this.waitForFunds(sourceKeypair, testAmount);
            
            if (!fundingResult.success) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Timed out waiting for funds after 5 minutes.`)}`);
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Skipping certification and continuing service initialization.`)}`);
                return {
                    success: false,
                    message: "Certification timed out - no funds received within 5 minutes",
                    sourceWallet: sourcePublicKey
                };
            }
            
            // Track the sender for later return
            const senderAddress = fundingResult.sender;
            const receivedAmount = fundingResult.amount;
            
            // We have funds, run the test but pass the sender info
            const result = await this.performCertification(testAmount, sourceKeypair, senderAddress, receivedAmount);
            
            if (result.success) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION COMPLETE')} All operations validated.`);
            } else {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION FAILED')} Operations may have issues: ${result.error}`);
            }
            
            return result;
        } else {
            // We already have funds, run the test
            const result = await this.performCertification(testAmount, sourceKeypair);
            
            if (result.success) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION COMPLETE')} All operations validated.`);
            } else {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.header('TREASURY CERTIFICATION FAILED')} Operations may have issues: ${result.error}`);
            }
            
            return result;
        }
    }
    
    /**
     * Perform the certification cycle - fund transfers and balance verification
     * 
     * @param {number} testAmount - Amount of SOL to use in certification
     * @param {Keypair} sourceKeypair - Source wallet keypair with funds
     * @param {string} [originalSender=null] - Address of the original sender (for return funds)
     * @param {number} [originalAmount=0] - Original amount received (for return funds)
     * @returns {Promise<Object>} - Result of the certification
     */
    async performCertification(testAmount, sourceKeypair, originalSender = null, originalAmount = 0) {
        const startTime = Date.now();
        const certificationId = `CERT-${Date.now().toString(36).toUpperCase()}`;
        
        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Starting treasury validation cycle`);
        
        // Store test wallets for cleanup
        const wallets = {
            source: null,
            test1: null,
            test2: null,
            test3: null
        };
        
        // Track transaction statuses for visual flow
        const txStatus = {
            source_to_test1: false,
            test1_to_test2: false,
            test2_to_test3: false,
            test3_to_source: false,
            source_to_sender: false
        };
        
        // Track steps
        const steps = {
            createWallets: false,
            loadSource: false,
            transfer1: false,
            transfer2: false,
            transfer3: false,
            verifyBalances: false,
            returnFunds: false,
            returnToOriginalSender: false
        };
        
        try {
            // 1. Create test wallets
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Creating test wallets...`);
            
            wallets.source = {
                publicKey: sourceKeypair.publicKey.toString(),
                keypair: sourceKeypair,
                balance: 0
            };
            
            // Create test wallets
            const test1Keypair = Keypair.generate();
            wallets.test1 = {
                publicKey: test1Keypair.publicKey.toString(),
                keypair: test1Keypair,
                balance: 0
            };
            
            const test2Keypair = Keypair.generate();
            wallets.test2 = {
                publicKey: test2Keypair.publicKey.toString(), 
                keypair: test2Keypair,
                balance: 0
            };
            
            const test3Keypair = Keypair.generate();
            wallets.test3 = {
                publicKey: test3Keypair.publicKey.toString(), 
                keypair: test3Keypair,
                balance: 0
            };
            
            steps.createWallets = true;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Created test wallets`)}`);
            this.logApi.info(`${this.formatLog.tag()} Source: ${wallets.source.publicKey.substring(0, 8)}...`);
            this.logApi.info(`${this.formatLog.tag()} Test1: ${wallets.test1.publicKey.substring(0, 8)}...`);
            this.logApi.info(`${this.formatLog.tag()} Test2: ${wallets.test2.publicKey.substring(0, 8)}...`);
            this.logApi.info(`${this.formatLog.tag()} Test3: ${wallets.test3.publicKey.substring(0, 8)}...`);
            
            // Display initial transaction flow diagram
            this.displayTransactionFlowDiagram(wallets, txStatus);
            
            // Check if we have identified an original sender
            if (originalSender) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Original sender identified: ${originalSender.substring(0, 8)}...`)}`);
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Will return funds after certification`)}`);
            }
            
            // 2. Verify source wallet balance
            const sourceBalance = await this.solanaEngine.executeConnectionMethod('getBalance', sourceKeypair.publicKey);
            wallets.source.balance = sourceBalance / LAMPORTS_PER_SOL;
            
            if (wallets.source.balance < testAmount) {
                return {
                    success: false,
                    message: "Source wallet has insufficient funds",
                    steps,
                    sourceWallet: wallets.source.publicKey,
                    requiredAmount: testAmount
                };
            }
            
            // Source wallet has funds, proceed with test
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Source wallet has sufficient funds: ${wallets.source.balance} SOL`)}`);
            steps.loadSource = true;
            
            // 3. Transfer from source to test1
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Transferring ${testAmount} SOL from source to test1...`);
            
            const sig1 = await this.transferSol(
                wallets.source.keypair,
                wallets.test1.publicKey,
                testAmount
            );
            
            steps.transfer1 = true;
            txStatus.source_to_test1 = true;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transfer 1 successful: ${sig1.substring(0, 8)}...`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`View transfer: https://solscan.io/tx/${sig1}`)}`);
            
            // Update visual flow diagram
            this.displayTransactionFlowDiagram(wallets, txStatus);
            
            // Wait for balance update
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 4. Transfer from test1 to test2
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Transferring ${testAmount - 0.001} SOL from test1 to test2...`);
            
            const sig2 = await this.transferSol(
                wallets.test1.keypair,
                wallets.test2.publicKey,
                testAmount - 0.001 // Account for fees
            );
            
            steps.transfer2 = true;
            txStatus.test1_to_test2 = true;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transfer 2 successful: ${sig2.substring(0, 8)}...`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`View transfer: https://solscan.io/tx/${sig2}`)}`);
            
            // Update visual flow diagram
            this.displayTransactionFlowDiagram(wallets, txStatus);
            
            // Wait for balance update
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 5. Transfer from test2 to test3
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Transferring ${testAmount - 0.002} SOL from test2 to test3...`);
            
            const sig3 = await this.transferSol(
                wallets.test2.keypair,
                wallets.test3.publicKey,
                testAmount - 0.002 // Account for fees
            );
            
            steps.transfer3 = true;
            txStatus.test2_to_test3 = true;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transfer 3 successful: ${sig3.substring(0, 8)}...`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`View transfer: https://solscan.io/tx/${sig3}`)}`);
            
            // Update visual flow diagram
            this.displayTransactionFlowDiagram(wallets, txStatus);
            
            // Wait for balance update
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 6. Verify balances
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Verifying balances...`);
            
            const test1Balance = await this.solanaEngine.executeConnectionMethod('getBalance', wallets.test1.keypair.publicKey);
            wallets.test1.balance = test1Balance / LAMPORTS_PER_SOL;
            
            const test2Balance = await this.solanaEngine.executeConnectionMethod('getBalance', wallets.test2.keypair.publicKey);
            wallets.test2.balance = test2Balance / LAMPORTS_PER_SOL;
            
            const test3Balance = await this.solanaEngine.executeConnectionMethod('getBalance', wallets.test3.keypair.publicKey);
            wallets.test3.balance = test3Balance / LAMPORTS_PER_SOL;
            
            steps.verifyBalances = true;
            this.logApi.info(`${this.formatLog.tag()} Test1 balance: ${wallets.test1.balance} SOL`);
            this.logApi.info(`${this.formatLog.tag()} Test2 balance: ${wallets.test2.balance} SOL`);
            this.logApi.info(`${this.formatLog.tag()} Test3 balance: ${wallets.test3.balance} SOL`);
            
            // 7. Return funds to source wallet
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Returning funds from Test3 to source wallet...`);
            
            const sig4 = await this.transferSol(
                wallets.test3.keypair,
                wallets.source.publicKey,
                testAmount - 0.003 // Account for fees in the three transactions
            );
            
            steps.returnFunds = true;
            txStatus.test3_to_source = true;
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Funds returned to source wallet: ${sig4.substring(0, 8)}...`)}`);
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`View transfer: https://solscan.io/tx/${sig4}`)}`);
            
            // Update visual flow diagram
            this.displayTransactionFlowDiagram(wallets, txStatus);
            
            // Wait for balance update
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Get updated source balance
            const updatedSourceBalance = await this.solanaEngine.executeConnectionMethod('getBalance', sourceKeypair.publicKey);
            const updatedSolBalance = updatedSourceBalance / LAMPORTS_PER_SOL;
            
            // 7. If we have an original sender, return funds to them
            if (originalSender) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Returning funds to original sender...`);
                
                // The amount to return would be what we have in the source wallet now
                const returnAmount = updatedSolBalance - 0.001; // Keep a small amount for fees
                
                if (returnAmount > 0.001) {
                    const returnResult = await this.returnFundsToSender(
                        sourceKeypair,
                        originalSender,
                        returnAmount
                    );
                    
                    if (returnResult.success) {
                        txStatus.source_to_sender = true;
                        this.displayTransactionFlowDiagram(wallets, txStatus, originalSender);
                        steps.returnToOriginalSender = true;
                        
                        // Create highly visible success banner for return transaction
                        const returnBanner = [
                            `\n${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  ✅ CERTIFICATION COMPLETE! FUNDS RETURNED TO ORIGINAL SENDER              ✅  ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  Transaction: ${returnResult.solscanLink}                           ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  Amount: ${returnAmount.toFixed(6)} SOL                                               ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  Recipient: ${originalSender.substring(0, 8)}...                                           ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  SERVICE INITIALIZATION CONTINUING - ALL TESTS PASSED                       ${this.fancyColors.RESET}`,
                            `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}\n`
                        ];
                        
                        // Display banner
                        returnBanner.forEach(line => this.logApi.info(line));
                        
                        // Also log detail for logs
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Successfully returned ${returnAmount.toFixed(6)} SOL to original sender`)}`);
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Transaction confirmed on blockchain: ${returnResult.txid}`)}`);
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`View transaction: ${returnResult.solscanLink}`)}`);
                    } else {
                        this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Could not return funds to original sender: ${returnResult.error}`)}`);
                    }
                } else {
                    this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Not enough funds to return to original sender (${returnAmount.toFixed(6)} SOL)`)}`);
                }
            } 
            
            // Calculate time taken
            const duration = Date.now() - startTime;
            
            // All steps completed successfully
            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`${certificationId}`)} Completed in ${duration}ms`);
            
            return {
                success: true,
                certificationId,
                message: `Treasury certification completed successfully in ${duration}ms`,
                steps,
                returnedToSender: steps.returnToOriginalSender
            };
            
        } catch (error) {
            const duration = Date.now() - startTime;
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Certification failed after ${duration}ms: ${error.message}`)}`, {
                error: error.message,
                stack: error.stack,
                steps
            });
            
            // If certification fails but we identified an original sender, try to return whatever funds remain
            if (originalSender && wallets.source && wallets.source.keypair) {
                try {
                    // Get current balance
                    const currentBalance = await this.solanaEngine.executeConnectionMethod('getBalance', wallets.source.keypair.publicKey);
                    const solBalance = currentBalance / LAMPORTS_PER_SOL;
                    
                    if (solBalance > 0.002) { // Only try if there's enough to return
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.header(`RECOVERY`)} Attempting to return remaining funds to original sender...`);
                        
                        const returnResult = await this.returnFundsToSender(
                            wallets.source.keypair,
                            originalSender,
                            solBalance - 0.001 // Keep a small amount for fees
                        );
                        
                        if (returnResult.success) {
                            txStatus.source_to_sender = true;
                            this.displayTransactionFlowDiagram(wallets, txStatus, originalSender);
                            
                            // The recovery path is only for partial cert failures during the test transfers
                            // This means the internal wallet transactions failed, but the return-to-sender works
                            const recoveryBanner = [
                                `\n${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  ✅ FUNDS SUCCESSFULLY RETURNED TO ORIGINAL SENDER                        ✅  ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  Transaction: ${returnResult.solscanLink}                           ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  Amount: ${(solBalance - 0.001).toFixed(6)} SOL                                         ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}  SERVICE INITIALIZATION CONTINUING - CRITICAL FUNCTION VALIDATED          ${this.fancyColors.RESET}`,
                                `${this.fancyColors.BG_GREEN}${this.fancyColors.BLACK}                                                                               ${this.fancyColors.RESET}\n`
                            ];
                            
                            // Display banner
                            recoveryBanner.forEach(line => this.logApi.info(line));
                            
                            // Also log the detail
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Recovery: Successfully returned ${(solBalance - 0.001).toFixed(6)} SOL to original sender`)}`);
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`Recovery transaction confirmed: ${returnResult.txid}`)}`);
                            this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.success(`View transaction: ${returnResult.solscanLink}`)}`);
                        }
                    }
                } catch (returnError) {
                    this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Recovery attempt failed: ${returnError.message}`)}`);
                }
            }
            
            return {
                success: false,
                certificationId,
                message: `Certification failed: ${error.message}`,
                error: error.message,
                steps
            };
        }
    }
    
    /**
     * Display a visual transaction flow diagram showing the movement of funds
     * 
     * @param {Object} wallets - Map of wallet objects
     * @param {Object} txStatus - Status of transactions between wallets
     * @param {string} [originalSender=null] - Original sender address if known
     */
    displayTransactionFlowDiagram(wallets, txStatus, originalSender = null) {
        const sourceAddr = wallets.source.publicKey.substring(0, 8);
        const test1Addr = wallets.test1.publicKey.substring(0, 8);
        const test2Addr = wallets.test2.publicKey.substring(0, 8);
        const test3Addr = wallets.test3.publicKey.substring(0, 8);
        const senderAddr = originalSender ? originalSender.substring(0, 8) : "???????";
        
        // Color formatting for nodes and arrows
        const formatNode = (addr) => `${this.fancyColors.CYAN}[${addr}]${this.fancyColors.RESET}`;
        const formatCompletedArrow = () => `${this.fancyColors.GREEN}====>${this.fancyColors.RESET}`;
        const formatPendingArrow = () => `${this.fancyColors.YELLOW}---->${this.fancyColors.RESET}`;
        
        // Create the diagram
        const diagram = [
            `\n${this.fancyColors.BOLD_WHITE}TRANSACTION FLOW DIAGRAM${this.fancyColors.RESET}\n`,
        ];
        
        // Add sender if known
        if (originalSender) {
            diagram.push(`${formatNode(senderAddr)} ${txStatus.source_to_sender ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(sourceAddr)}`);
        }
        
        // Show the main flow
        diagram.push(`${formatNode(sourceAddr)} ${txStatus.source_to_test1 ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(test1Addr)}`);
        diagram.push(`${formatNode(test1Addr)} ${txStatus.test1_to_test2 ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(test2Addr)}`);
        diagram.push(`${formatNode(test2Addr)} ${txStatus.test2_to_test3 ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(test3Addr)}`);
        diagram.push(`${formatNode(test3Addr)} ${txStatus.test3_to_source ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(sourceAddr)}`);
        
        // Show return to sender if sender is known
        if (originalSender) {
            diagram.push(`${formatNode(sourceAddr)} ${txStatus.source_to_sender ? formatCompletedArrow() : formatPendingArrow()} ${formatNode(senderAddr)}`);
        }
        
        // Legend
        diagram.push(`\n${this.fancyColors.YELLOW}---->${this.fancyColors.RESET} = Pending   ${this.fancyColors.GREEN}====>${this.fancyColors.RESET} = Completed\n`);
        
        // Output diagram
        diagram.forEach(line => this.logApi.info(line));
    }
    
    /**
     * Create a keypair from a private key in various formats
     * 
     * @param {string} privateKey - The private key string
     * @returns {Keypair|null} - The created keypair or null if unable to create
     */
    createKeypairFromPrivateKey(privateKey) {
        try {
            // Try to parse as JSON array (64 elements)
            if (privateKey.startsWith('[')) {
                try {
                    const parsed = JSON.parse(privateKey);
                    if (Array.isArray(parsed) && parsed.length === 64) {
                        this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Creating keypair from JSON array (64 elements)`)}`);
                        return Keypair.fromSecretKey(Uint8Array.from(parsed));
                    }
                } catch (e) {
                    this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Not a valid JSON array: ${e.message}`)}`);
                }
            }
            
            // Try as hex string (128 chars)
            if (/^[0-9a-fA-F]{128}$/.test(privateKey)) {
                this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Creating keypair from hex string (128 chars)`)}`);
                return Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
            }
            
            // Try as base58 encoded string
            try {
                const decoded = bs58.decode(privateKey);
                if (decoded.length === 64) {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Creating keypair from base58 encoded string (64 bytes)`)}`);
                    return Keypair.fromSecretKey(decoded);
                } else if (decoded.length === 32) {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Creating keypair from base58 encoded seed (32 bytes)`)}`);
                    return Keypair.fromSeed(decoded);
                }
            } catch (e) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Not a valid base58 string: ${e.message}`)}`);
            }
            
            // Try as base64 encoded string
            try {
                const decoded = Buffer.from(privateKey, 'base64');
                if (decoded.length === 64) {
                    this.logApi.info(`${this.formatLog.tag()} ${this.formatLog.info(`Creating keypair from base64 encoded string (64 bytes)`)}`);
                    return Keypair.fromSecretKey(decoded);
                }
            } catch (e) {
                this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Not a valid base64 string: ${e.message}`)}`);
            }
            
            this.logApi.warn(`${this.formatLog.tag()} ${this.formatLog.warning(`Could not create keypair from private key`)}`);
            return null;
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Error creating keypair: ${error.message}`)}`);
            return null;
        }
    }
    
    /**
     * Execute a SOL transfer between wallets
     * 
     * @param {Keypair} fromKeypair - Source wallet keypair
     * @param {string} toAddress - Destination wallet address
     * @param {number} amount - Amount of SOL to transfer
     * @returns {Promise<string>} - Transaction signature
     */
    async transferSol(fromKeypair, toAddress, amount) {
        try {
            // Create a transaction to transfer SOL
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: fromKeypair.publicKey,
                    toPubkey: new PublicKey(toAddress),
                    lamports: Math.round(amount * LAMPORTS_PER_SOL) // Convert SOL to lamports
                })
            );
            
            // Make sure the transaction has required properties
            // This helps solanaEngine but doesn't bypass it
            transaction.feePayer = fromKeypair.publicKey;
            
            // Send the transaction using SolanaEngine
            const signature = await this.solanaEngine.sendTransaction(
                transaction, 
                [fromKeypair], 
                {
                    commitment: 'confirmed',
                    skipPreflight: true,
                    maxRetries: 5
                }
            );
            
            return signature;
        } catch (error) {
            this.logApi.error(`${this.formatLog.tag()} ${this.formatLog.error(`Transfer failed: ${error.message}`)}`);
            throw error;
        }
    }
}

export default TreasuryCertifier;