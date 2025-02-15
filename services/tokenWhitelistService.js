import { BaseService } from '../utils/service-suite/base-service.js';
import { ServiceError } from '../utils/service-suite/service-error.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { fetchDigitalAsset, mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey } from "@metaplex-foundation/umi";
import prisma from '../config/prisma.js';
import { Decimal } from 'decimal.js';

const WHITELIST_SERVICE_CONFIG = {
    name: 'token_whitelist_service',
    checkIntervalMs: 1 * 30 * 1000,  // Check every 30 seconds
    maxRetries: 3,
    retryDelayMs: 30000,
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        minHealthyPeriodMs: 120000
    }
};

class TokenWhitelistService extends BaseService {
    constructor() {
        super(WHITELIST_SERVICE_CONFIG.name, WHITELIST_SERVICE_CONFIG);
        this.connection = new Connection(process.env.SOLANA_RPC_ENDPOINT);
        this.treasuryWallet = new PublicKey(process.env.TREASURY_WALLET_ADDRESS);
        this.submissionCost = parseFloat(process.env.TOKEN_SUBMISSION_COST || "0.01") * LAMPORTS_PER_SOL;
        this.umi = createUmi(process.env.SOLANA_RPC_ENDPOINT).use(mplTokenMetadata());
    }

    async verifyToken(contractAddress) {
        try {
            // Validate address format
            const pubkey = new PublicKey(contractAddress);
            
            // Check if token already exists
            const existingToken = await prisma.tokens.findUnique({
                where: { address: contractAddress }
            });

            if (existingToken) {
                throw new ServiceError('Token already whitelisted');
            }

            // Fetch and validate token metadata
            const asset = await fetchDigitalAsset(this.umi, publicKey(contractAddress));
            
            if (!asset) {
                throw new ServiceError('Token metadata not found');
            }

            // Basic validation of metadata
            if (!asset.metadata.name || !asset.metadata.symbol) {
                throw new ServiceError('Invalid token metadata');
            }

            return {
                name: asset.metadata.name,
                symbol: asset.metadata.symbol,
                // You can add more metadata fields as needed
                uri: asset.metadata.uri || null
            };
        } catch (error) {
            logApi.error('Token verification failed:', {
                contractAddress,
                error: error.message
            });
            
            if (error instanceof ServiceError) {
                throw error;
            }
            
            throw new ServiceError('Invalid token address');
        }
    }

    async verifyPayment(signature, walletAddress) {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed'
            });

            if (!tx) {
                throw new ServiceError('Transaction not found');
            }

            // Verify payment amount and recipient
            const transfer = tx.transaction.message.instructions.find(ix => 
                ix.program === 'system' && 
                ix.parsed.type === 'transfer'
            );

            if (!transfer) {
                throw new ServiceError('No transfer instruction found');
            }

            if (transfer.parsed.info.destination !== this.treasuryWallet.toString()) {
                throw new ServiceError('Invalid payment recipient');
            }

            if (transfer.parsed.info.lamports < this.submissionCost) {
                throw new ServiceError('Insufficient payment amount');
            }

            // Log the transaction
            await prisma.transactions.create({
                data: {
                    wallet_address: walletAddress,
                    type: 'DEPOSIT',
                    amount: new Decimal(transfer.parsed.info.lamports.toString()),
                    balance_before: new Decimal(0), // We don't track SOL balance
                    balance_after: new Decimal(0),  // We don't track SOL balance
                    description: 'Token whitelist submission fee',
                    status: 'completed',
                    metadata: {
                        signature,
                        token_submission: true,
                        lamports: transfer.parsed.info.lamports,
                        treasury_wallet: this.treasuryWallet.toString()
                    },
                    processed_at: new Date()
                }
            });

            return true;
        } catch (error) {
            logApi.error('Payment verification failed:', {
                signature,
                error: error.message
            });
            throw error;
        }
    }

    async addToWhitelist(contractAddress, metadata) {
        try {
            const token = await prisma.tokens.create({
                data: {
                    address: contractAddress,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    is_active: true,
                    created_at: new Date()
                }
            });

            logApi.info('Token added to whitelist:', {
                contractAddress,
                tokenId: token.id
            });

            return token;
        } catch (error) {
            logApi.error('Failed to add token to whitelist:', {
                contractAddress,
                error: error.message
            });
            throw new ServiceError('Failed to add token to whitelist');
        }
    }
}

export const tokenWhitelistService = new TokenWhitelistService(); 