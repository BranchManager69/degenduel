// services/faucetService.js (will rename to liquidityService.js)

import { BaseService } from '../utils/service-suite/base-service.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { logApi } from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';

const LIQUIDITY_CONFIG = {
    name: 'liquidity_service',
    description: 'Manages SOL distribution across wallets',
    checkIntervalMs: 60 * 1000,  // Check every minute
    // Minimal config to start
    wallet: {
        minBalance: 0.05,
        masterWallet: "BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp"
    }
};

class LiquidityService extends BaseService {
    constructor() {
        super(LIQUIDITY_CONFIG);
        // Just connect to mainnet
        this.connection = new Connection(process.env.SOLANA_RPC_ENDPOINT);
        
        // Simple stats
        this.stats = {
            balance: 0,
            lastCheck: null,
            operations: {
                total: 0,
                successful: 0,
                failed: 0
            }
        };
    }

    async initialize() {
        try {
            // Just check if we can connect
            await this.connection.getRecentBlockhash();
            
            // Find our wallet
            const wallet = await prisma.seed_wallets.findFirst({
                where: {
                    purpose: 'liquidity',
                    is_active: true
                }
            });

            if (wallet) {
                this.wallet = wallet;
                // Get initial balance
                const balance = await this.connection.getBalance(
                    new PublicKey(wallet.wallet_address)
                );
                this.stats.balance = balance / 1000000000; // Convert lamports to SOL
                this.stats.lastCheck = new Date().toISOString();
                
                logApi.info('Liquidity Service initialized', {
                    wallet: wallet.wallet_address,
                    balance: this.stats.balance
                });
                return true;
            }

            logApi.info('No liquidity wallet found - service will wait');
            return true;
        } catch (error) {
            logApi.error('Liquidity Service initialization error:', error);
            return false;
        }
    }

    async performOperation() {
        // Just check balance for now
        if (!this.wallet) return;
        
        try {
            const balance = await this.connection.getBalance(
                new PublicKey(this.wallet.wallet_address)
            );
            this.stats.balance = balance / 1000000000;
            this.stats.lastCheck = new Date().toISOString();
            this.stats.operations.total++;
            this.stats.operations.successful++;
        } catch (error) {
            this.stats.operations.failed++;
            logApi.error('Balance check failed:', error);
        }
    }
}

const liquidityService = new LiquidityService();
export default liquidityService;
