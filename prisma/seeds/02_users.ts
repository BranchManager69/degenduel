import { PrismaClient, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';
import { WalletGenerator } from '../../utils/solana-suite/wallet-generator.js';

const prisma = new PrismaClient();

// Helper function to generate random nickname
function generateNickname(type: string, index: number): string {
  const adjectives = ['Crazy', 'Wild', 'Diamond', 'Savage', 'Lucky', 'Crypto', 'Moon', 'Degen', 'Based', 'Alpha'];
  const nouns = ['Trader', 'Ape', 'Wolf', 'Whale', 'Bull', 'Bear', 'Degen', 'Chad', 'Wizard', 'Guru'];
  
  if (index === 0) return type; // Return type for first of each category
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}${Math.floor(Math.random() * 1000)}`;
}

export async function seedUsers() {
  console.log('Seeding users...');

  const userGroups = [
    // Admins (3)
    {
      count: 3,
      role: 'admin' as UserRole,
      baseExp: 50000,
      baseAchievements: 2500,
      baseRank: 1800,
      contestRange: { min: 15, max: 30 },
      winRange: { min: 5, max: 10 },
      riskLevel: 0,
      kycStatus: 'VERIFIED'
    },
    // Whales (5)
    {
      count: 5,
      role: 'user' as UserRole,
      baseExp: 75000,
      baseAchievements: 3500,
      baseRank: 2200,
      contestRange: { min: 20, max: 40 },
      winRange: { min: 8, max: 15 },
      riskLevel: 1,
      kycStatus: 'VERIFIED'
    },
    // Active Traders (20)
    {
      count: 20,
      role: 'user' as UserRole,
      baseExp: 25000,
      baseAchievements: 1500,
      baseRank: 1500,
      contestRange: { min: 10, max: 25 },
      winRange: { min: 2, max: 8 },
      riskLevel: 0,
      kycStatus: 'VERIFIED'
    },
    // Casual Players (40)
    {
      count: 40,
      role: 'user' as UserRole,
      baseExp: 5000,
      baseAchievements: 500,
      baseRank: 1200,
      contestRange: { min: 3, max: 12 },
      winRange: { min: 0, max: 3 },
      riskLevel: 0,
      kycStatus: 'PENDING'
    },
    // Newbies (20)
    {
      count: 20,
      role: 'user' as UserRole,
      baseExp: 0,
      baseAchievements: 0,
      baseRank: 1000,
      contestRange: { min: 0, max: 2 },
      winRange: { min: 0, max: 1 },
      riskLevel: 0,
      kycStatus: null
    },
    // Banned Users (5)
    {
      count: 5,
      role: 'user' as UserRole,
      baseExp: 15000,
      baseAchievements: 800,
      baseRank: 800,
      contestRange: { min: 5, max: 15 },
      winRange: { min: 0, max: 2 },
      riskLevel: 3,
      kycStatus: 'REJECTED',
      isBanned: true,
      banReasons: [
        'Contest manipulation attempt',
        'Multiple account abuse',
        'Suspicious trading patterns',
        'KYC verification fraud',
        'Terms of service violation'
      ]
    }
  ];

  const users = await Promise.all(
    userGroups.flatMap((group, groupIndex) =>
      Array.from({ length: group.count }, async (_, index) => {
        const contests = Math.floor(Math.random() * (group.contestRange.max - group.contestRange.min + 1)) + group.contestRange.min;
        const wins = Math.floor(Math.random() * (group.winRange.max - group.winRange.min + 1)) + group.winRange.min;
        const rankVariation = Math.floor(Math.random() * 200) - 100; // ±100 variation
        const expVariation = Math.floor(Math.random() * 10000) - 5000; // ±5000 variation

        // Generate unique identifier for this user
        const userIdentifier = `${group.role}_${groupIndex}_${index}`;
        const wallet = await WalletGenerator.generateWallet(userIdentifier);

        return prisma.users.create({
          data: {
            wallet_address: wallet.publicKey,
            nickname: generateNickname(group.role, index),
            role: group.role,
            total_contests: contests,
            is_banned: group.isBanned || false,
            ban_reason: group.isBanned ? group.banReasons[index % group.banReasons.length] : null,
            kyc_status: group.kycStatus,
            risk_level: group.riskLevel,
            user_stats: {
              create: {
                contests_entered: contests,
                contests_won: wins,
                total_prize_money: new Decimal(wins * 100),
                best_score: new Decimal((Math.random() * 50 + 50).toFixed(2)),
                avg_score: new Decimal((Math.random() * 30 + 40).toFixed(2))
              }
            }
          }
        });
      })
    )
  );

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
