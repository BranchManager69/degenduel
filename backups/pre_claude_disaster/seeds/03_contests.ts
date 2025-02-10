import { PrismaClient, contest_status } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';
import { WalletGenerator } from '../../utils/solana-suite/wallet-generator.js';

const prisma = new PrismaClient();

function generateContestCode(id: number): string {
  return `CONTEST_${id.toString().padStart(4, '0')}`;
}

export async function seedContests() {
  console.log('Seeding contests...');

  // Get token buckets for allowed_buckets
  const buckets = await prisma.token_buckets.findMany();
  const bucketIds = buckets.map(b => b.id);

  const now = new Date();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;

  const contests = await Promise.all([
    // Active contest with high prize pool
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(1),
        name: 'Big Ass Duel',
        description: 'Big ass degen duel for experienced traders',
        start_time: new Date(now.getTime() - oneHour),
        end_time: new Date(now.getTime() + oneDay),
        entry_fee: new Decimal('1.00'),
        prize_pool: new Decimal('9.00'),
        current_prize_pool: new Decimal('2.70'),
        status: 'active' as contest_status,
        participant_count: 3,
        min_participants: 2,
        max_participants: 10,
        allowed_buckets: bucketIds,
        settings: {
          scoring: {
            weight_market_cap: 0.0,
            weight_volume: 0.0,
            weight_price_change: 1.0,
          },
          requirements: {
            min_rank_score: 0,
            min_contests_completed: 0
          },
          payout_structure: {
            place_1: 0.70,
            place_2: 0.20,
            place_3: 0.10
          }
        },
        contest_wallets: {
          create: {
            wallet_address: WalletGenerator.generateWallet('contest_1_main').publicKey,
            private_key: WalletGenerator.generateWallet('contest_1_main').secretKey,
            balance: new Decimal('0')
          }
        }
      }
    }),

    // Pending contest starting soon
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(2),
        name: 'Sweaty Basement Duel',
        description: 'Perfect for trash bags with a low entry fee',
        start_time: new Date(now.getTime() + oneHour),
        end_time: new Date(now.getTime() + oneDay + oneHour),
        entry_fee: new Decimal('0.10'),
        prize_pool: new Decimal('0.90'),
        current_prize_pool: new Decimal('0.45'),
        status: 'pending' as contest_status,
        participant_count: 5,
        min_participants: 10,
        max_participants: 50,
        allowed_buckets: [bucketIds[0], bucketIds[1], bucketIds[2], bucketIds[3], bucketIds[4], bucketIds[5], bucketIds[6], bucketIds[7], bucketIds[8], bucketIds[9] ], // All buckets
        settings: {
          scoring: {
            weight_market_cap: 0.0,
            weight_volume: 0.0,
            weight_price_change: 1.0,
          },
          requirements: {
            min_rank_score: 0,
            min_contests_completed: 0
          }
        },
        contest_wallets: {
          create: {
            wallet_address: WalletGenerator.generateWallet('contest_2_main').publicKey,
            private_key: WalletGenerator.generateWallet('contest_2_main').secretKey,
            balance: new Decimal('0')
          }
        }
      }
    }),

    // Completed contest
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(3),
        name: 'DeFi Degen Showdown',
        description: 'Ape into DeFi tokens and pray for the best',
        start_time: new Date(now.getTime() - oneDay - oneHour),
        end_time: new Date(now.getTime() - oneHour),
        entry_fee: new Decimal('0.50'),
        prize_pool: new Decimal('4.50'),
        current_prize_pool: new Decimal('4.50'),
        status: 'completed' as contest_status,
        participant_count: 9,
        min_participants: 2,
        max_participants: 10,
        allowed_buckets: [bucketIds[3]], // Only DeFi bucket
        settings: {
          scoring: {
            weight_market_cap: 0.0,
            weight_volume: 0.0,
            weight_price_change: 1.0,
          },
          requirements: {
            min_rank_score: 0,
            min_contests_completed: 0
          },
          payout_structure: {
            place_1: 0.70,
            place_2: 0.20,
            place_3: 0.10
          }
        },
        contest_wallets: {
          create: {
            wallet_address: WalletGenerator.generateWallet('contest_3_main').publicKey,
            private_key: WalletGenerator.generateWallet('contest_3_main').secretKey,
            balance: new Decimal('0')
          }
        }
      }
    }),

    // Cancelled contest
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(4),
        name: 'Gamer Rage Quit',
        description: 'Trade gaming tokens until you rage quit',
        start_time: new Date(now.getTime() - oneDay),
        end_time: new Date(now.getTime() + oneDay),
        entry_fee: new Decimal('0.25'),
        prize_pool: new Decimal('2.25'),
        current_prize_pool: new Decimal('0'),
        status: 'cancelled' as contest_status,
        participant_count: 3,
        min_participants: 2,
        max_participants: 10,
        allowed_buckets: [bucketIds[4]], // Only gaming bucket
        settings: {
          scoring: {
            weight_market_cap: 0.0,
            weight_volume: 0.0,
            weight_price_change: 1.0
          },
          requirements: {
            min_rank_score: 0,
            min_contests_completed: 0
          },
          payout_structure: {
            place_1: 0.70,
            place_2: 0.20,
            place_3: 0.10
          }
        },
        cancelled_at: new Date(now.getTime() - oneHour),
        cancellation_reason: 'Not enough degens showed up',
        contest_wallets: {
          create: {
            wallet_address: WalletGenerator.generateWallet('contest_4_main').publicKey,
            private_key: WalletGenerator.generateWallet('contest_4_main').secretKey,
            balance: new Decimal('0')
          }
        }
      }
    }),

    // Active contest with mixed buckets
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(5),
        name: 'Kitchen Sink Degen',
        description: 'Throw everything at the wall and see what sticks',
        start_time: new Date(now.getTime() - 2 * oneHour),
        end_time: new Date(now.getTime() + oneDay - oneHour),
        entry_fee: new Decimal('0.75'),
        prize_pool: new Decimal('6.75'),
        current_prize_pool: new Decimal('6.75'),
        status: 'active' as contest_status,
        participant_count: 9,
        min_participants: 2,
        max_participants: 10,
        allowed_buckets: [bucketIds[0], bucketIds[3], bucketIds[4]], // Large cap, DeFi, and Gaming
        settings: {
          scoring: {
            weight_market_cap: 0.0,
            weight_volume: 0.0,
            weight_price_change: 1.0
          },
          requirements: {
            min_rank_score: 0,
            min_contests_completed: 0
          },
          payout_structure: {
            place_1: 0.70,
            place_2: 0.20,
            place_3: 0.10
          }
        },
        contest_wallets: {
          create: {
            wallet_address: WalletGenerator.generateWallet('contest_5_main').publicKey,
            private_key: WalletGenerator.generateWallet('contest_5_main').secretKey,
            balance: new Decimal('0')
          }
        }
      }
    })
  ]);

  console.log(`Seeded ${contests.length} contests`);
  
  return contests;
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedContests()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 
