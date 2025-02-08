import { Transaction, SystemProgram, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import WalletManager from './WalletManager.js';
import SolanaServiceManager from '../../../utils/solana-suite/solana-service-manager.js';
import { EventEmitter } from 'events';

class Transfer extends EventEmitter {
    static instance = null;
    #walletManager;
    
    constructor() {
        super();
        if (Transfer.instance) {
            return Transfer.instance;
        }
        this.#walletManager = WalletManager.getInstance();
        Transfer.instance = this;
    }

    static getInstance() {
        if (!Transfer.instance) {
            Transfer.instance = new Transfer();
        }
        return Transfer.instance;
    }

    async calculateOptimalTransfers(sourceWallets, targetWallets, amounts) {
        const connection = SolanaServiceManager.getConnection();
        
        // Get current balances
        const sourceBalances = await Promise.all(sourceWallets.map(async (wallet) => {
            const balance = await connection.getBalance(new PublicKey(wallet));
            return { wallet, balance: balance / LAMPORTS_PER_SOL };
        }));

        // Sort by balance descending
        sourceBalances.sort((a, b) => b.balance - a.balance);

        // Calculate total needed
        const totalNeeded = amounts.reduce((sum, amount) => sum + amount, 0);

        // Verify we have enough total balance
        const totalAvailable = sourceBalances.reduce((sum, { balance }) => sum + balance, 0);
        if (totalAvailable < totalNeeded) {
            throw new Error(`Insufficient total balance. Need ${totalNeeded} SOL, have ${totalAvailable} SOL`);
        }

        // Calculate transfers
        const transfers = [];
        let remainingAmounts = [...amounts];
        let currentSourceIndex = 0;

        for (let targetIndex = 0; targetIndex < targetWallets.length; targetIndex++) {
            const neededAmount = remainingAmounts[targetIndex];
            if (!neededAmount) continue;

            while (neededAmount > 0 && currentSourceIndex < sourceBalances.length) {
                const source = sourceBalances[currentSourceIndex];
                const transferAmount = Math.min(source.balance, neededAmount);

                if (transferAmount > 0) {
                    transfers.push({
                        from: source.wallet,
                        to: targetWallets[targetIndex],
                        amount: transferAmount
                    });

                    source.balance -= transferAmount;
                    remainingAmounts[targetIndex] -= transferAmount;

                    if (source.balance <= 0) {
                        currentSourceIndex++;
                    }
                } else {
                    currentSourceIndex++;
                }
            }
        }

        return transfers;
    }

    async executeTransfer(from, to, amount) {
        const connection = SolanaServiceManager.getConnection();
        const fromKeypair = await this.#walletManager.getWalletKeypair(from);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: new PublicKey(to),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );

        const signature = await connection.sendTransaction(transaction, [fromKeypair]);
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature);
        
        this.emit('transferComplete', {
            from,
            to,
            amount,
            signature,
            confirmation
        });

        return { signature, confirmation };
    }

    async executeMultiTransfer(transfers) {
        const results = [];
        
        for (const transfer of transfers) {
            try {
                const result = await this.executeTransfer(
                    transfer.from,
                    transfer.to,
                    transfer.amount
                );
                results.push({
                    ...transfer,
                    status: 'success',
                    signature: result.signature
                });
            } catch (error) {
                results.push({
                    ...transfer,
                    status: 'failed',
                    error: error.message
                });
                // Don't throw, continue with remaining transfers
            }
        }

        return results;
    }

    async distributeAmount(targetWallets, amounts) {
        // Get all active wallets as potential sources
        const allWallets = await this.#walletManager.getAllWallets();
        const sourceWallets = allWallets
            .filter(w => w.status === 'active')
            .map(w => w.public_key);

        const transfers = await this.calculateOptimalTransfers(
            sourceWallets,
            targetWallets,
            amounts
        );

        return this.executeMultiTransfer(transfers);
    }

    async balanceWallets(maxBalance = 100) {
        const wallets = await this.#walletManager.getAllWallets();
        const connection = SolanaServiceManager.getConnection();

        // Find wallets over limit
        const overLimit = [];
        const underLimit = [];

        for (const wallet of wallets) {
            const balance = await connection.getBalance(new PublicKey(wallet.public_key));
            const balanceSOL = balance / LAMPORTS_PER_SOL;

            if (balanceSOL > maxBalance) {
                overLimit.push({
                    wallet: wallet.public_key,
                    excess: balanceSOL - maxBalance
                });
            } else {
                underLimit.push({
                    wallet: wallet.public_key,
                    space: maxBalance - balanceSOL
                });
            }
        }

        if (overLimit.length === 0) {
            return { message: 'No wallets over limit', transfers: [] };
        }

        // Calculate redistributions
        const transfers = [];
        for (const source of overLimit) {
            let remaining = source.excess;
            
            for (const target of underLimit) {
                if (remaining <= 0) break;
                
                const amount = Math.min(remaining, target.space);
                if (amount > 0) {
                    transfers.push({
                        from: source.wallet,
                        to: target.wallet,
                        amount
                    });
                    
                    remaining -= amount;
                    target.space -= amount;
                }
            }
        }

        return this.executeMultiTransfer(transfers);
    }
}

export default Transfer; 