import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedTokens() {
  console.log('Seeding tokens and buckets...');

  // Create token buckets first
  const buckets = await Promise.all([
    prisma.token_buckets.create({
      data: {
        name: 'Large Cap',
        description: 'Top market cap tokens',
        bucket_code: 'LARGE_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'Mid Cap',
        description: 'Medium market cap tokens',
        bucket_code: 'MID_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'Small Cap',
        description: 'Small market cap tokens',
        bucket_code: 'SMALL_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'DeFi',
        description: 'Decentralized Finance tokens',
        bucket_code: 'DEFI'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'Gaming',
        description: 'Gaming and Metaverse tokens',
        bucket_code: 'GAMING'
      }
    })
  ]);

  // Create tokens with realistic data
  const tokens = await Promise.all([
    // Large Cap Tokens
    prisma.tokens.create({
      data: {
        address: 'So11111111111111111111111111111111111111112',
        symbol: 'SOL',
        name: 'Solana',
        decimals: 9,
        is_active: true,
        market_cap: new Decimal('28614450000'),
        change_24h: new Decimal('2.45'),
        volume_24h: new Decimal('1234567890'),
        token_bucket_memberships: {
          create: {
            bucket_id: buckets[0].id // Large Cap
          }
        },
        token_prices: {
          create: {
            price: new Decimal('104.23')
          }
        }
      }
    }),
    prisma.tokens.create({
      data: {
        address: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
        symbol: 'RAY',
        name: 'Raydium',
        decimals: 6,
        is_active: true,
        market_cap: new Decimal('456789000'),
        change_24h: new Decimal('-1.23'),
        volume_24h: new Decimal('98765432'),
        token_bucket_memberships: {
          create: [
            { bucket_id: buckets[1].id }, // Mid Cap
            { bucket_id: buckets[3].id }  // DeFi
          ]
        },
        token_prices: {
          create: {
            price: new Decimal('2.45')
          }
        }
      }
    }),
    prisma.tokens.create({
      data: {
        address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        is_active: true,
        market_cap: new Decimal('45678900000'),
        change_24h: new Decimal('0.01'),
        volume_24h: new Decimal('987654321'),
        token_bucket_memberships: {
          create: {
            bucket_id: buckets[0].id // Large Cap
          }
        },
        token_prices: {
          create: {
            price: new Decimal('1.00')
          }
        }
      }
    }),
    // Gaming Token
    prisma.tokens.create({
      data: {
        address: 'SAMUmmSvrE8yqtcG94oyP1Zu2P9t8PSRSV52sG6cqwV',
        symbol: 'SAMU',
        name: 'Samurai',
        decimals: 9,
        is_active: true,
        market_cap: new Decimal('12345678'),
        change_24h: new Decimal('5.67'),
        volume_24h: new Decimal('1234567'),
        token_bucket_memberships: {
          create: [
            { bucket_id: buckets[2].id }, // Small Cap
            { bucket_id: buckets[4].id }  // Gaming
          ]
        },
        token_prices: {
          create: {
            price: new Decimal('0.0123')
          }
        }
      }
    }),
    // DeFi Token
    prisma.tokens.create({
      data: {
        address: 'MERt85fc5boKw3BW1eYdxonEuJNvXbiMbs6hvheau5K',
        symbol: 'MER',
        name: 'Mercurial',
        decimals: 6,
        is_active: true,
        market_cap: new Decimal('23456789'),
        change_24h: new Decimal('-3.45'),
        volume_24h: new Decimal('2345678'),
        token_bucket_memberships: {
          create: [
            { bucket_id: buckets[2].id }, // Small Cap
            { bucket_id: buckets[3].id }  // DeFi
          ]
        },
        token_prices: {
          create: {
            price: new Decimal('0.145')
          }
        }
      }
    })
  ]);

  console.log(`Seeded ${buckets.length} token buckets`);
  console.log(`Seeded ${tokens.length} tokens`);
  
  return { buckets, tokens };
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedTokens()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 
