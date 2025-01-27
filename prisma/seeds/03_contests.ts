import { PrismaClient, contest_status } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

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
        name: 'High Stakes Championship',
        description: 'Big prize pool contest for experienced traders',
        start_time: new Date(now.getTime() - oneHour),
        end_time: new Date(now.getTime() + oneDay),
        entry_fee: new Decimal('100'),
        prize_pool: new Decimal('10000'),
        current_prize_pool: new Decimal('10000'),
        status: 'active' as contest_status,
        participant_count: 45,
        min_participants: 10,
        max_participants: 100,
        allowed_buckets: bucketIds,
        settings: {
          scoring: {
            weight_market_cap: 0.3,
            weight_volume: 0.3,
            weight_price_change: 0.4
          }
        },
        contest_wallets: {
          create: {
            wallet_address: 'Contest1WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            private_key: 'encrypted_key_1',
            balance: new Decimal('10000')
          }
        }
      }
    }),

    // Pending contest starting soon
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(2),
        name: 'Newcomer Challenge',
        description: 'Perfect for beginners with a low entry fee',
        start_time: new Date(now.getTime() + oneHour),
        end_time: new Date(now.getTime() + oneDay + oneHour),
        entry_fee: new Decimal('10'),
        prize_pool: new Decimal('1000'),
        current_prize_pool: new Decimal('0'),
        status: 'pending' as contest_status,
        participant_count: 5,
        min_participants: 5,
        max_participants: 20,
        allowed_buckets: [bucketIds[0], bucketIds[1]], // Only large and mid cap
        settings: {
          scoring: {
            weight_market_cap: 0.4,
            weight_volume: 0.3,
            weight_price_change: 0.3
          }
        },
        contest_wallets: {
          create: {
            wallet_address: 'Contest2WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            private_key: 'encrypted_key_2',
            balance: new Decimal('1000')
          }
        }
      }
    }),

    // Completed contest
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(3),
        name: 'DeFi Masters Cup',
        description: 'Specialized contest focusing on DeFi tokens',
        start_time: new Date(now.getTime() - oneDay - oneHour),
        end_time: new Date(now.getTime() - oneHour),
        entry_fee: new Decimal('50'),
        prize_pool: new Decimal('5000'),
        current_prize_pool: new Decimal('5000'),
        status: 'completed' as contest_status,
        participant_count: 25,
        min_participants: 10,
        max_participants: 50,
        allowed_buckets: [bucketIds[3]], // Only DeFi bucket
        settings: {
          scoring: {
            weight_market_cap: 0.2,
            weight_volume: 0.4,
            weight_price_change: 0.4
          }
        },
        contest_wallets: {
          create: {
            wallet_address: 'Contest3WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            private_key: 'encrypted_key_3',
            balance: new Decimal('5000')
          }
        }
      }
    }),

    // Cancelled contest
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(4),
        name: 'Gaming Tokens Special',
        description: 'Focus on gaming and metaverse tokens',
        start_time: new Date(now.getTime() - oneDay),
        end_time: new Date(now.getTime() + oneDay),
        entry_fee: new Decimal('25'),
        prize_pool: new Decimal('2500'),
        current_prize_pool: new Decimal('0'),
        status: 'cancelled' as contest_status,
        participant_count: 3,
        min_participants: 10,
        max_participants: 30,
        allowed_buckets: [bucketIds[4]], // Only gaming bucket
        settings: {
          scoring: {
            weight_market_cap: 0.3,
            weight_volume: 0.3,
            weight_price_change: 0.4
          }
        },
        cancelled_at: new Date(now.getTime() - oneHour),
        cancellation_reason: 'Insufficient participants',
        contest_wallets: {
          create: {
            wallet_address: 'Contest4WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            private_key: 'encrypted_key_4',
            balance: new Decimal('0')
          }
        }
      }
    }),

    // Active contest with mixed buckets
    prisma.contests.create({
      data: {
        contest_code: generateContestCode(5),
        name: 'Mixed Portfolio Challenge',
        description: 'Create a balanced portfolio across different sectors',
        start_time: new Date(now.getTime() - 2 * oneHour),
        end_time: new Date(now.getTime() + oneDay - oneHour),
        entry_fee: new Decimal('75'),
        prize_pool: new Decimal('7500'),
        current_prize_pool: new Decimal('7500'),
        status: 'active' as contest_status,
        participant_count: 30,
        min_participants: 20,
        max_participants: 50,
        allowed_buckets: [bucketIds[0], bucketIds[3], bucketIds[4]], // Large cap, DeFi, and Gaming
        settings: {
          scoring: {
            weight_market_cap: 0.3,
            weight_volume: 0.3,
            weight_price_change: 0.4
          }
        },
        contest_wallets: {
          create: {
            wallet_address: 'Contest5WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
            private_key: 'encrypted_key_5',
            balance: new Decimal('7500')
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
