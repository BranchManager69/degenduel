import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { EventEmitter } from 'events';
import SolanaServiceManager from '../../../utils/solana-suite/solana-service-manager.js';
import WalletWebSocketServer from '../websocket/index.js';
import prisma from '../../../config/prisma.js';
import { encryptPrivateKey, decryptPrivateKey } from '../../../utils/solana-suite/solana-wallet.js';

class WalletManager extends EventEmitter {
    static instance = null;
    #walletCache = new Map();
    #wsServer = null;
    
    constructor() {
        super();
        if (WalletManager.instance) {
            return WalletManager.instance;
        }
        WalletManager.instance = this;
        this.#setupEventHandlers();
    }

    static getInstance() {
        if (!WalletManager.instance) {
            WalletManager.instance = new WalletManager();
        }
        return WalletManager.instance;
    }

    #setupEventHandlers() {
        // Forward events to WebSocket if available
        this.on('walletCreated', (publicKey) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'created',
                publicKey
            });
        });

        this.on('walletStatusChanged', (data) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'statusChanged',
                ...data
            });
        });

        this.on('balanceUpdated', (data) => {
            this.#wsServer?.broadcastWalletUpdate({
                type: 'balanceChanged',
                ...data
            });
        });
    }

    setWebSocketServer(wsServer) {
        this.#wsServer = wsServer;
    }

    async generateWallet(label = '') {
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toString();
        const privateKey = Buffer.from(keypair.secretKey).toString('base64');
        
        // Use the better encryption with AAD
        const encryptedData = encryptPrivateKey(privateKey, publicKey);

        const wallet = await prisma.managed_wallets.create({
            data: {
                public_key: publicKey,
                encrypted_private_key: JSON.stringify(encryptedData),
                label,
                status: 'active',
                metadata: {
                    created_at: new Date(),
                    last_used: new Date(),
                    transaction_count: 0
                }
            }
        });

        this.#walletCache.set(publicKey, {
            ...wallet,
            balances: {
                sol: 0,
                tokens: []
            }
        });

        this.emit('walletCreated', publicKey);
        return wallet;
    }

    async generateBatchWallets(count, labelPrefix = '') {
        const wallets = [];
        for (let i = 0; i < count; i++) {
            const label = labelPrefix ? `${labelPrefix}-${i + 1}` : '';
            const wallet = await this.generateWallet(label);
            wallets.push(wallet);
        }
        return wallets;
    }

    async getWallet(publicKey) {
        if (this.#walletCache.has(publicKey)) {
            return this.#walletCache.get(publicKey);
        }

        const wallet = await prisma.managed_wallets.findUnique({
            where: { public_key: publicKey }
        });

        if (!wallet) {
            throw new Error(`Wallet not found: ${publicKey}`);
        }

        const connection = SolanaServiceManager.getConnection();
        const balance = await connection.getBalance(new PublicKey(publicKey));
        
        const walletWithBalance = {
            ...wallet,
            balances: {
                sol: balance / LAMPORTS_PER_SOL,
                tokens: [] // Will be populated by TokenManager
            }
        };

        this.#walletCache.set(publicKey, walletWithBalance);
        return walletWithBalance;
    }

    async getAllWallets() {
        const wallets = await prisma.managed_wallets.findMany({
            where: { status: 'active' }
        });

        const connection = SolanaServiceManager.getConnection();
        
        const walletsWithBalances = await Promise.all(wallets.map(async (wallet) => {
            const balance = await connection.getBalance(new PublicKey(wallet.public_key));
            const walletWithBalance = {
                ...wallet,
                balances: {
                    sol: balance / LAMPORTS_PER_SOL,
                    tokens: []
                }
            };
            this.#walletCache.set(wallet.public_key, walletWithBalance);
            return walletWithBalance;
        }));

        return walletsWithBalances;
    }

    async updateWalletStatus(publicKey, status) {
        const wallet = await prisma.managed_wallets.update({
            where: { public_key: publicKey },
            data: { 
                status,
                metadata: {
                    last_updated: new Date()
                }
            }
        });

        if (this.#walletCache.has(publicKey)) {
            const cachedWallet = this.#walletCache.get(publicKey);
            this.#walletCache.set(publicKey, { ...cachedWallet, status });
        }

        this.emit('walletStatusChanged', { publicKey, status });
        return wallet;
    }

    async updateWalletLabel(publicKey, label) {
        const wallet = await prisma.managed_wallets.update({
            where: { public_key: publicKey },
            data: { label }
        });

        if (this.#walletCache.has(publicKey)) {
            const cachedWallet = this.#walletCache.get(publicKey);
            this.#walletCache.set(publicKey, { ...cachedWallet, label });
        }

        return wallet;
    }

    async getWalletKeypair(publicKey) {
        const wallet = await this.getWallet(publicKey);
        const privateKey = decryptPrivateKey(wallet.encrypted_private_key);
        const secretKey = Buffer.from(privateKey, 'base64');
        return Keypair.fromSecretKey(secretKey);
    }

    async exportWallet(publicKey, includePrivateKey = false) {
        const wallet = await this.getWallet(publicKey);
        const exportData = {
            publicKey: wallet.public_key,
            label: wallet.label,
            balances: wallet.balances,
            metadata: wallet.metadata
        };

        if (includePrivateKey) {
            const privateKey = decryptPrivateKey(wallet.encrypted_private_key);
            exportData.privateKey = privateKey;
        }

        return exportData;
    }

    async exportAllWallets(includePrivateKeys = false) {
        const wallets = await this.getAllWallets();
        return Promise.all(wallets.map(wallet => 
            this.exportWallet(wallet.public_key, includePrivateKeys)
        ));
    }

    async checkBalance(publicKey) {
        const connection = SolanaServiceManager.getConnection();
        const balance = await connection.getBalance(new PublicKey(publicKey));
        const balanceSOL = balance / LAMPORTS_PER_SOL;

        if (this.#walletCache.has(publicKey)) {
            const cachedWallet = this.#walletCache.get(publicKey);
            const oldBalance = cachedWallet.balances.sol;
            
            if (oldBalance !== balanceSOL) {
                cachedWallet.balances.sol = balanceSOL;
                this.#walletCache.set(publicKey, cachedWallet);
                
                this.emit('balanceUpdated', {
                    publicKey,
                    oldBalance,
                    newBalance: balanceSOL
                });
            }
        }

        return balanceSOL;
    }

    // Start balance monitoring for a wallet
    async startBalanceMonitoring(publicKey, interval = 10000) {
        const monitoringInterval = setInterval(async () => {
            try {
                await this.checkBalance(publicKey);
            } catch (error) {
                this.emit('error', {
                    type: 'balanceMonitoring',
                    publicKey,
                    error: error.message
                });
            }
        }, interval);

        return monitoringInterval;
    }
}

export default WalletManager; 