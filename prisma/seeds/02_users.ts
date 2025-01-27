import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedUsers() {
  console.log('Seeding users...');

  const users = await Promise.all([
    // Super admin user (you)
    prisma.users.upsert({
      where: {
        wallet_address: 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp'
      },
      update: {
        nickname: 'BranchManager69',
        role: 'superadmin',
        balance: new Decimal('1069')
      },
      create: {
        wallet_address: 'BPuRhkeCkor7DxMrcPVsB4AdW6Pmp5oACjVzpPb72Mhp',
        nickname: 'BranchManager69',
        role: 'superadmin',
        balance: new Decimal('1069')
      }
    }),

    // Regular admin
    prisma.users.create({
      data: {
        wallet_address: 'AdminWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        nickname: 'AdminDude',
        role: 'admin',
        balance: new Decimal('500')
      }
    }),

    // Active user with high balance
    prisma.users.create({
      data: {
        wallet_address: 'WhaleWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        nickname: 'CryptoWhale',
        role: 'user',
        balance: new Decimal('10000'),
        total_contests: 25,
        total_wins: 8
      }
    }),

    // Regular active user
    prisma.users.create({
      data: {
        wallet_address: 'User1WalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        nickname: 'TraderJoe',
        role: 'user',
        balance: new Decimal('250'),
        total_contests: 12,
        total_wins: 2
      }
    }),

    // New user
    prisma.users.create({
      data: {
        wallet_address: 'NewbieWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        nickname: 'CryptoNewbie',
        role: 'user',
        balance: new Decimal('100'),
        total_contests: 0,
        total_wins: 0
      }
    }),

    // Banned user
    prisma.users.create({
      data: {
        wallet_address: 'BannedWalletXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        nickname: 'Cheater123',
        role: 'banned',
        balance: new Decimal('0'),
        total_contests: 5,
        total_wins: 0,
        ban_reason: 'Attempted manipulation of contest results'
      }
    })
  ]);

  console.log(`Seeded ${users.length} users`);
  
  return users;
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedUsers()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 
