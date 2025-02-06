// /routes/superadmin.js

import { exec } from 'child_process';
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import logApi from '../utils/logger-suite/logger.js';
import prisma from '../config/prisma.js';
import { PrismaClient } from '@prisma/client';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { WalletGenerator } from '../utils/solana-suite/wallet-generator.js';
import { FaucetManager } from '../utils/solana-suite/faucet-manager.js';
import { getContestWallet } from '../utils/solana-suite/solana-wallet.js';
import bs58 from 'bs58';

const LOG_DIR = path.join(process.cwd(), 'logs');

// Router
const router = express.Router();
const prismaClient = new PrismaClient();

// Solana connection
const connection = new Connection(process.env.QUICKNODE_MAINNET_HTTP || 'https://api.mainnet-beta.solana.com', 'confirmed');

// Middleware to ensure superadmin role
const requireSuperAdminMiddleware = (req, res, next) => {
    if (req.user?.role !== 'superadmin') {
        return res.status(403).json({
            error: 'Superadmin access required'
        });
    }
    next();
};

// Get available log files (SUPERADMIN ONLY)
router.get('/logs/available', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(file => file.endsWith('.log'));
        const logFilesWithStats = await Promise.all(
            logFiles.map(async (file) => {
                const stats = await fs.stat(path.join(LOG_DIR, file));
                return {
                    name: file,
                    size: stats.size,
                    created: stats.birthtime,
                    modified: stats.mtime
                };
            })
        );
        res.json(logFilesWithStats);
    } catch (error) {
        logApi.error('Error reading log directory:', error);
        res.status(500).json({ 
            error: 'Error reading log directory',
            details: error.message 
        });
    }
});

// Get specific log file content (SUPERADMIN ONLY)
router.get('/logs/:filename', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(LOG_DIR, filename);
        
        // Validate the file path is within LOG_DIR
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(path.resolve(LOG_DIR))) {
            return res.status(403).json({ 
                error: 'Access denied: Invalid log file path!'
            });
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({
                error: 'Log file not found'
            });
        }

        const content = await fs.readFile(filePath, 'utf8');
        res.json({ content });
    } catch (error) {
        logApi.error('Error reading log file:', error);
        res.status(500).json({ 
            error: 'Error reading log file',
            details: error.message 
        });
    }
});

// Get contest wallet private key (SUPERADMIN ONLY)
router.get('/contests/:id/wallet', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const contestId = parseInt(req.params.id);
        
        // Get contest wallet
        const contestWallet = await prisma.contest_wallets.findUnique({
            where: { contest_id: contestId }
        });

        if (!contestWallet) {
            return res.status(404).json({ error: 'Contest wallet not found' });
        }

        // Get wallet instance (this decrypts the private key)
        const wallet = await getContestWallet(contestWallet.private_key, contestWallet.wallet_address);
        
        // Return private key in hex format
        res.json({
            contest_id: contestId,
            wallet_address: contestWallet.wallet_address,
            private_key: Buffer.from(wallet.secretKey).toString('hex')
        });
    } catch (error) {
        logApi.error('Error getting contest wallet:', error);
        res.status(500).json({ 
            error: 'Failed to get contest wallet',
            details: error.message 
        });
    }
});

// Novelty generate-tree endpoint (SUPERADMIN ONLY)
router.post('/generate-tree', requireAuth, requireSuperAdmin, (req, res) => {
    exec('/home/websites/degenduel/scripts/tree.sh', (error, stdout, stderr) => {
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ 
            message: 'Project tree generated successfully',
            output: stdout,
            timestamp: new Date().toISOString()
        });
    });
});

// Phase definitions with rollback support
const phaseDefinitions = {
    'clear': {
        dependencies: [],
        seed: async () => {
            await prismaClient.$transaction([
                prismaClient.transactions.deleteMany(),
                prismaClient.contest_participants.deleteMany(),
                prismaClient.contest_portfolios.deleteMany(),
                prismaClient.contest_token_performance.deleteMany(),
                prismaClient.contest_token_prices.deleteMany(),
                prismaClient.contest_wallets.deleteMany(),
                prismaClient.contests.deleteMany(),
                prismaClient.user_stats.deleteMany({
                    where: {
                        user: {
                            role: { not: 'superadmin' }
                        }
                    }
                }),
                prismaClient.users.deleteMany({
                    where: {
                        role: { not: 'superadmin' }
                    }
                }),
                prismaClient.tokens.deleteMany(),
                prismaClient.token_buckets.deleteMany(),
                prismaClient.achievement_tier_requirements.deleteMany(),
                prismaClient.achievement_tiers.deleteMany(),
                prismaClient.achievement_categories.deleteMany(),
                prismaClient.user_levels.deleteMany()
            ]);
            return 'Database cleared successfully (preserved superadmin account)';
        },
        rollback: async () => {
            // No rollback for clear - it's already deleted
            return 'Clear phase cannot be rolled back';
        }
    },
    'tokens': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedTokens } = await import('../prisma/seeds/01_tokens.js');
            await seedTokens();
            return 'Tokens seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.token_prices.deleteMany(),
                prismaClient.token_bucket_memberships.deleteMany(),
                prismaClient.tokens.deleteMany(),
                prismaClient.token_buckets.deleteMany()
            ]);
            return 'Tokens rolled back successfully';
        }
    },
    'achievements': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedAchievements } = await import('../prisma/seeds/05_achievements.js');
            await seedAchievements();
            return 'Achievements seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.achievement_tier_requirements.deleteMany(),
                prismaClient.achievement_tiers.deleteMany(),
                prismaClient.achievement_categories.deleteMany()
            ]);
            return 'Achievements rolled back successfully';
        }
    },
    'user_levels': {
        dependencies: ['clear'],
        seed: async () => {
            const { seedUserLevels } = await import('../prisma/seeds/06_user_levels.js');
            await seedUserLevels();
            return 'User levels seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.level_rewards.deleteMany(),
                prismaClient.user_levels.deleteMany()
            ]);
            return 'User levels rolled back successfully';
        }
    },
    'users': {
        dependencies: ['clear', 'user_levels'],
        seed: async () => {
            const { seedUsers } = await import('../prisma/seeds/02_users.js');
            await seedUsers();
            return 'Users seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.user_stats.deleteMany(),
                prismaClient.users.deleteMany()
            ]);
            return 'Users rolled back successfully';
        }
    },
    'contests': {
        dependencies: ['clear', 'tokens', 'users'],
        seed: async () => {
            const { seedContests } = await import('../prisma/seeds/03_contests.js');
            await seedContests();
            return 'Contests seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.contest_wallets.deleteMany(),
                prismaClient.contests.deleteMany()
            ]);
            return 'Contests rolled back successfully';
        }
    },
    'participants': {
        dependencies: ['contests', 'users'],
        seed: async () => {
            const { seedContestParticipants } = await import('../prisma/seeds/07_contest_participants.js');
            await seedContestParticipants();
            return 'Contest participants seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.contest_participants.deleteMany()
            ]);
            return 'Contest participants rolled back successfully';
        }
    },
    'portfolios': {
        dependencies: ['contests', 'participants', 'tokens'],
        seed: async () => {
            const { seedPortfolios } = await import('../prisma/seeds/04_portfolios.js');
            await seedPortfolios();
            return 'Portfolios seeded successfully';
        },
        rollback: async () => {
            await prismaClient.$transaction([
                prismaClient.contest_token_performance.deleteMany(),
                prismaClient.contest_token_prices.deleteMany(),
                prismaClient.contest_portfolios.deleteMany()
            ]);
            return 'Portfolios rolled back successfully';
        }
    }
};

// Get current seeding phase status
router.get('/reseed-status', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const status = await prismaClient.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });

        return res.json({
            current_phase: status?.value?.current_phase || 'not_started',
            phases_completed: status?.value?.phases_completed || [],
            last_updated: status?.updated_at || null,
            available_phases: Object.keys(phaseDefinitions),
            phase_dependencies: Object.fromEntries(
                Object.entries(phaseDefinitions).map(([phase, def]) => [phase, def.dependencies])
            )
        });
    } catch (error) {
        logApi.error('Error getting reseed status:', error);
        return res.status(500).json({ error: 'Failed to get reseed status' });
    }
});

// Rollback a specific phase
router.post('/reseed-rollback/:phase', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { phase } = req.params;
        
        if (!phaseDefinitions[phase]) {
            return res.status(400).json({
                error: 'Invalid phase',
                available_phases: Object.keys(phaseDefinitions)
            });
        }

        // Check if any other phases depend on this one
        const dependentPhases = Object.entries(phaseDefinitions)
            .filter(([_, def]) => def.dependencies.includes(phase))
            .map(([p]) => p);

        if (dependentPhases.length > 0) {
            return res.status(400).json({
                error: 'Cannot rollback phase with dependencies',
                dependent_phases: dependentPhases,
                message: 'You must first rollback the dependent phases'
            });
        }

        // Update status before starting rollback
        await prismaClient.system_settings.upsert({
            where: { key: 'reseed_status' },
            update: {
                value: {
                    current_phase: `rolling_back_${phase}`,
                    in_progress: true
                },
                updated_at: new Date()
            },
            create: {
                key: 'reseed_status',
                value: {
                    current_phase: `rolling_back_${phase}`,
                    in_progress: true
                },
                updated_at: new Date()
            }
        });

        // Execute the rollback
        const message = await phaseDefinitions[phase].rollback();

        // Update status after completion
        const status = await prismaClient.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });

        const completedPhases = status?.value?.phases_completed || [];
        const updatedPhases = completedPhases.filter(p => p !== phase);

        await prismaClient.system_settings.update({
            where: { key: 'reseed_status' },
            data: {
                value: {
                    current_phase: 'completed',
                    phases_completed: updatedPhases,
                    in_progress: false
                },
                updated_at: new Date()
            }
        });

        logApi.info(`Database phase ${phase} rolled back`, {
            admin: req.user.wallet_address,
            phase
        });

        return res.json({
            message,
            phase,
            status: 'rolled_back'
        });

    } catch (error) {
        logApi.error(`Error rolling back phase ${req.params.phase}:`, {
            error: error.message,
            admin: req.user?.wallet_address
        });
        return res.status(500).json({
            error: `Failed to rollback phase ${req.params.phase}`,
            details: error.message
        });
    }
});

// Start or continue reseeding process with specific phase
router.post('/reseed-database/:phase', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { phase } = req.params;
        
        if (!phaseDefinitions[phase]) {
            return res.status(400).json({
                error: 'Invalid phase',
                available_phases: Object.keys(phaseDefinitions)
            });
        }

        // Check dependencies
        const status = await prismaClient.system_settings.findUnique({
            where: { key: 'reseed_status' }
        });
        const completedPhases = status?.value?.phases_completed || [];
        const missingDependencies = phaseDefinitions[phase].dependencies.filter(
            dep => !completedPhases.includes(dep)
        );

        if (missingDependencies.length > 0) {
            return res.status(400).json({
                error: 'Missing dependencies',
                missing: missingDependencies,
                message: 'Please complete these phases first'
            });
        }

        // Update status before starting
        await prismaClient.system_settings.upsert({
            where: { key: 'reseed_status' },
            update: {
                value: {
                    current_phase: phase,
                    phases_completed: completedPhases,
                    in_progress: true
                },
                updated_at: new Date()
            },
            create: {
                key: 'reseed_status',
                value: {
                    current_phase: phase,
                    phases_completed: completedPhases,
                    in_progress: true
                },
                updated_at: new Date()
            }
        });

        // Execute the phase
        const message = await phaseDefinitions[phase].seed();

        // Update status after completion
        await prismaClient.system_settings.update({
            where: { key: 'reseed_status' },
            data: {
                value: {
                    current_phase: 'completed',
                    phases_completed: [...completedPhases, phase],
                    in_progress: false
                },
                updated_at: new Date()
            }
        });

        logApi.info(`Database phase ${phase} completed`, {
            admin: req.user.wallet_address,
            phase
        });

        return res.json({
            message,
            phase,
            status: 'completed'
        });

    } catch (error) {
        logApi.error(`Error in reseed phase ${req.params.phase}:`, {
            error: error.message,
            admin: req.user?.wallet_address
        });
        return res.status(500).json({
            error: `Failed to execute phase ${req.params.phase}`,
            details: error.message
        });
    }
});

// Get faucet balance (SUPERADMIN ONLY)
router.get('/faucet/balance', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const balance = await FaucetManager.checkBalance();
        res.json({ 
            balance,
            config: FaucetManager.config
        });
    } catch (error) {
        logApi.error('Error checking faucet balance:', error);
        res.status(500).json({ 
            error: 'Failed to check faucet balance',
            details: error.message 
        });
    }
});

// Configure faucet settings (SUPERADMIN ONLY)
router.post('/faucet/config', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        const { defaultAmount, minFaucetBalance, maxTestUsers } = req.body;
        FaucetManager.setConfig({
            defaultAmount: parseFloat(defaultAmount),
            minFaucetBalance: parseFloat(minFaucetBalance),
            maxTestUsers: parseInt(maxTestUsers)
        });
        res.json({ 
            message: 'Faucet configuration updated',
            config: FaucetManager.config
        });
    } catch (error) {
        logApi.error('Error updating faucet config:', error);
        res.status(500).json({ 
            error: 'Failed to update faucet configuration',
            details: error.message 
        });
    }
});

// Recover SOL from test wallets (SUPERADMIN ONLY)
router.post('/faucet/recover', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        await FaucetManager.recoverFromTestWallets();
        res.json({ 
            message: 'Recovery process completed successfully'
        });
    } catch (error) {
        logApi.error('Error recovering from test wallets:', error);
        res.status(500).json({ 
            error: 'Failed to recover from test wallets',
            details: error.message 
        });
    }
});

// Nuclear recover SOL from test wallets - leaves minimal balance (SUPERADMIN ONLY)
router.post('/faucet/recover-nuclear', requireAuth, requireSuperAdmin, async (req, res) => {
    try {
        // Get all test users (created in the last 24 hours)
        const testUsers = await prisma.users.findMany({
            where: {
                created_at: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                },
                nickname: {
                    startsWith: 'Test User'
                }
            },
            select: {
                id: true,
                wallet_address: true
            }
        });

        const faucetWallet = await FaucetManager.getFaucetWallet();
        if (!faucetWallet) {
            throw new Error('Failed to get test faucet wallet');
        }

        let totalRecovered = 0;

        for (const user of testUsers) {
            try {
                const balance = await connection.getBalance(new PublicKey(user.wallet_address));
                if (balance <= 0) continue;

                const balanceSOL = balance / LAMPORTS_PER_SOL;

                const walletInfo = await WalletGenerator.getWallet(`test-user-${user.id}`);
                if (!walletInfo) {
                    console.log(`No private key found for ${user.wallet_address}, skipping...`);
                    continue;
                }

                const userKeypair = Keypair.fromSecretKey(bs58.decode(walletInfo.secretKey));
                
                // Leave absolute minimum for rent (0.000001 SOL)
                const recoveryAmount = balance - (0.000001 * LAMPORTS_PER_SOL);
                if (recoveryAmount <= 0) continue;

                const recoveryAmountSOL = recoveryAmount / LAMPORTS_PER_SOL;

                const transaction = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: userKeypair.publicKey,
                        toPubkey: new PublicKey(faucetWallet.publicKey),
                        lamports: recoveryAmount
                    })
                );

                const signature = await connection.sendTransaction(transaction, [userKeypair]);
                await connection.confirmTransaction(signature);

                totalRecovered += recoveryAmountSOL;
                console.log(`Recovered ${recoveryAmountSOL} SOL from ${user.wallet_address}`);

                // Log the recovery transaction
                await prisma.transactions.create({
                    data: {
                        wallet_address: user.wallet_address,
                        type: 'WITHDRAWAL',
                        amount: recoveryAmountSOL,
                        balance_before: balanceSOL,
                        balance_after: 0.000001, // Minimal balance left
                        status: 'completed',
                        metadata: {
                            blockchain_signature: signature
                        },
                        description: 'Nuclear test wallet SOL recovery',
                        processed_at: new Date()
                    }
                });

            } catch (error) {
                console.error(`Failed to recover SOL from ${user.wallet_address}:`, error);
            }
        }

        await FaucetManager.checkBalance();
        res.json({ 
            message: 'Nuclear recovery process completed successfully',
            totalRecovered
        });
    } catch (error) {
        logApi.error('Error performing nuclear recovery:', error);
        res.status(500).json({ 
            error: 'Failed to perform nuclear recovery',
            details: error.message 
        });
    }
});

export default router;