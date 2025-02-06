import { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../../config/config.js';
import { FaucetManager } from '../../utils/solana-suite/faucet-manager.js';
import { WalletGenerator } from '../../utils/solana-suite/wallet-generator.js';

const prisma = new PrismaClient();
const MIN_REQUIRED_USERS = 4;  // We want at least 4 users for our test cases
const TEST_SOL_AMOUNT = 0.025; // 0.025 SOL per test user (0.25 total for 10 users)
const MASTER_WALLET = config.master_wallet.address;

// Create Solana connection
const connection = new Connection(process.env.QUICKNODE_MAINNET_HTTP || 'https://api.mainnet-beta.solana.com', 'confirmed');

// Configure faucet with default settings
// These can be overridden using the faucet-manager.ts CLI
FaucetManager.setConfig({
  defaultAmount: 0.025,  // 0.025 SOL per test user
  minFaucetBalance: 0.05, // Keep 0.05 SOL in faucet
  maxTestUsers: 10  // Maximum 10 test users
});

// Get test faucet wallet
async function getTestFaucetWallet() {
  // First check if we already have a test faucet wallet
  const existingFaucet = await prisma.seed_wallets.findFirst({
    where: { identifier: 'test-faucet' }
  });

  if (existingFaucet) {
    // Decrypt and return existing wallet
    return WalletGenerator.getWallet('test-faucet');
  }

  // If no faucet exists, generate one
  console.log('\n=== IMPORTANT: Test Faucet Setup Required ===');
  console.log('Generating new test faucet wallet...');
  const faucetWallet = await WalletGenerator.generateWallet('test-faucet');
  console.log(`\nTest Faucet Address: ${faucetWallet.publicKey}`);
  console.log(`Please send at least ${TEST_SOL_AMOUNT * 10} SOL to this address for test user funding.`);
  console.log('===============================================\n');

  return faucetWallet;
}

async function distributeSOLToTestUsers(testUsers: { id: number; wallet_address: string }[]) {
  console.log('Checking test faucet wallet...');
  
  // Check faucet balance first
  const balance = await FaucetManager.checkBalance();
  const requiredBalance = testUsers.length * 0.025 + 0.05; // Amount needed + min balance

  if (balance < requiredBalance) {
    console.error(`\nInsufficient faucet balance!`);
    console.error(`Required: ${requiredBalance} SOL (${testUsers.length} users × 0.025 SOL + 0.05 SOL min balance)`);
    console.error(`Current balance: ${balance} SOL`);
    console.error(`Please send at least ${requiredBalance - balance} SOL to the faucet address shown above.\n`);
    return false;
  }

  console.log(`\nDistributing SOL to ${testUsers.length} test users...`);
  for (const user of testUsers) {
    try {
      const walletInfo = await WalletGenerator.getWallet(`test-user-${user.id}`);
      if (!walletInfo) {
        console.error(`Failed to get wallet for test user ${user.id}`);
        continue;
      }

      // Send SOL using FaucetManager
      const result = await FaucetManager.sendSOL(walletInfo.publicKey, 0.025);
      if (result) {
        console.log(`Sent 0.025 SOL to test user ${user.id} (${walletInfo.publicKey})`);
      }
    } catch (error) {
      console.error(`Failed to distribute SOL to test user ${user.id}:`, error);
    }
  }

  // Show updated faucet balance
  await FaucetManager.checkBalance();
  return true;
}

export async function seedPortfolios() {
  console.log('Seeding portfolios...');

  try {
    // Get all existing users first
    const existingUsers = await prisma.users.findMany({
      select: {
        id: true,
        wallet_address: true,
        role: true
      },
      orderBy: {
        created_at: 'asc'  // Ensures consistent ordering and that superadmin (likely first created) is preserved
      }
    });

    console.log(`Found ${existingUsers.length} existing users`);

    // Generate additional test users if needed
    const usersNeeded = Math.max(0, MIN_REQUIRED_USERS - existingUsers.length);
    const testUsers = [];

    if (usersNeeded > 0) {
      console.log(`Generating ${usersNeeded} additional test users...`);
      console.log('\n=== IMPORTANT: Test Wallet Funding Required ===');
      console.log('Please send test SOL to the following wallets:');
      
      for (let i = 0; i < usersNeeded; i++) {
        const identifier = `test-user-${Date.now()}-${i}`;
        const walletInfo = await WalletGenerator.generateWallet(identifier);
        
        const newUser = await prisma.users.create({
          data: {
            wallet_address: walletInfo.publicKey,
            nickname: `Test User ${i + 1}`,
            role: 'user',  // Default role
            created_at: new Date(),
            last_login: new Date()
          }
        });

        testUsers.push(newUser);
        console.log(`\nWallet ${i + 1}: ${walletInfo.publicKey}`);
        console.log(`Amount needed: ${TEST_SOL_AMOUNT} SOL`);
      }

      console.log('\nPlease fund these wallets before proceeding with testing.');
      console.log('You can use the wallet rake service to recover the SOL later.');
      console.log('===============================================\n');
    }

    // Combine existing and new users
    const users = [...existingUsers, ...testUsers];

    if (users.length < MIN_REQUIRED_USERS) {
      throw new Error(`Not enough users for seeding. Need at least ${MIN_REQUIRED_USERS}, but only have ${users.length}`);
    }

    console.log(`Proceeding with ${users.length} total users for portfolio seeding`);

    // Get active contests
    const activeContests = await prisma.contests.findMany({
      where: {
        status: 'active'
      }
    });

    // Get completed contests
    const completedContests = await prisma.contests.findMany({
      where: {
        status: 'completed'
      }
    });

    // Get tokens
    const tokens = await prisma.tokens.findMany();

    const portfolios = await Promise.all([
      // Portfolio for active contest (High Stakes Championship)
      ...activeContests.flatMap(contest => [
        // First token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[0].id,
            weight: 50 // 0.5 as integer percentage
          }
        }),
        // Second token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[1].id,
            weight: 50 // 0.5 as integer percentage
          }
        })
      ]),

      // Portfolio for completed contest (DeFi Masters Cup)
      ...completedContests.flatMap(contest => [
        // First token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[2].id,
            weight: 40 // 0.4 as integer percentage
          }
        }),
        // Second token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[3].id,
            weight: 30 // 0.3 as integer percentage
          }
        }),
        // Third token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[4].id,
            weight: 30 // 0.3 as integer percentage
          }
        })
      ]),

      // Another portfolio for active contest (Mixed Portfolio Challenge)
      ...activeContests.flatMap(contest => [
        // First token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[3].wallet_address,
            token_id: tokens[0].id,
            weight: 40 // 0.4 as integer percentage
          }
        }),
        // Second token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[3].wallet_address,
            token_id: tokens[3].id,
            weight: 30 // 0.3 as integer percentage
          }
        }),
        // Third token in portfolio
        prisma.contest_portfolios.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[3].wallet_address,
            token_id: tokens[4].id,
            weight: 30 // 0.3 as integer percentage
          }
        })
      ])
    ]);

    // Add example trades for active contests
    const trades = await Promise.all([
      ...activeContests.flatMap(contest => [
        // Initial trade for first token
        prisma.contest_portfolio_trades.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[0].id,
            type: 'BUY',
            old_weight: 0,
            new_weight: 50,
            price_at_trade: new Decimal('52000'),
            virtual_amount: new Decimal('50000'), // 50 * 1000
            executed_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
          }
        }),
        // Initial trade for second token
        prisma.contest_portfolio_trades.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[1].id,
            type: 'BUY',
            old_weight: 0,
            new_weight: 50,
            price_at_trade: new Decimal('2600'),
            virtual_amount: new Decimal('50000'), // 50 * 1000
            executed_at: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
          }
        }),
        // Example rebalance trade
        prisma.contest_portfolio_trades.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[0].id,
            type: 'SELL',
            old_weight: 50,
            new_weight: 40,
            price_at_trade: new Decimal('53000'),
            virtual_amount: new Decimal('10000'), // 10 * 1000
            executed_at: new Date(Date.now() - 12 * 60 * 60 * 1000) // 12 hours ago
          }
        }),
        prisma.contest_portfolio_trades.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[1].id,
            type: 'BUY',
            old_weight: 50,
            new_weight: 60,
            price_at_trade: new Decimal('2650'),
            virtual_amount: new Decimal('10000'), // 10 * 1000
            executed_at: new Date(Date.now() - 12 * 60 * 60 * 1000) // 12 hours ago
          }
        })
      ])
    ]);

    // Create token performance records
    await Promise.all([
      // Performance records for active contests
      ...activeContests.flatMap(contest => [
        prisma.contest_token_performance.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[0].id,
            profit_loss: new Decimal('4.00') // 4% profit
          }
        }),
        prisma.contest_token_performance.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[1].id,
            profit_loss: new Decimal('4.00') // 4% profit
          }
        })
      ]),

      // Performance records for completed contests
      ...completedContests.flatMap(contest => [
        prisma.contest_token_performance.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[2].id,
            profit_loss: new Decimal('10.00') // 10% profit
          }
        }),
        prisma.contest_token_performance.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[3].id,
            profit_loss: new Decimal('25.00') // 25% profit
          }
        }),
        prisma.contest_token_performance.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[4].id,
            profit_loss: new Decimal('20.00') // 20% profit
          }
        })
      ])
    ]);

    // Create token price records
    await Promise.all([
      // Price records for active contests
      ...activeContests.flatMap(contest => [
        prisma.contest_token_prices.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[0].id,
            amount: new Decimal('0.5'),
            price: new Decimal('52000')
          }
        }),
        prisma.contest_token_prices.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[0].wallet_address,
            token_id: tokens[1].id,
            amount: new Decimal('10'),
            price: new Decimal('2600')
          }
        })
      ]),

      // Price records for completed contests
      ...completedContests.flatMap(contest => [
        prisma.contest_token_prices.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[2].id,
            amount: new Decimal('100'),
            price: new Decimal('55')
          }
        }),
        prisma.contest_token_prices.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[3].id,
            amount: new Decimal('1000'),
            price: new Decimal('2.5')
          }
        }),
        prisma.contest_token_prices.create({
          data: {
            contest_id: contest.id,
            wallet_address: users[2].wallet_address,
            token_id: tokens[4].id,
            amount: new Decimal('5'),
            price: new Decimal('1200')
          }
        })
      ])
    ]);

    console.log(`Seeded ${portfolios.length} portfolio entries and ${trades.length} trade entries`);
    
    return { portfolios, trades };
  } catch (e) {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedPortfolios()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 
