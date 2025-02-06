import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';
import { WalletGenerator } from './utils/wallet-generator.js';

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
      role: 'admin',
      baseBalance: 1000,
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
      role: 'user',
      baseBalance: 10000,
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
      role: 'user',
      baseBalance: 500,
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
      role: 'user',
      baseBalance: 100,
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
      role: 'user',
      baseBalance: 50,
      baseExp: 0,
      baseAchievements: 0,
      baseRank: 1000,
      contestRange: { min: 0, max: 2 },
      winRange: { min: 0, max: 1 },
      riskLevel: 0,
      kycStatus: null
    },
    // Bots (10)
    {
      count: 10,
      role: 'bot',
      baseBalance: 1000,
      baseExp: 30000,
      baseAchievements: 1500,
      baseRank: 1600,
      contestRange: { min: 30, max: 50 },
      winRange: { min: 5, max: 12 },
      riskLevel: 0,
      kycStatus: 'VERIFIED'
    },
    // Moderators (2)
    {
      count: 2,
      role: 'moderator',
      baseBalance: 500,
      baseExp: 40000,
      baseAchievements: 2000,
      baseRank: 1700,
      contestRange: { min: 15, max: 25 },
      winRange: { min: 3, max: 8 },
      riskLevel: 0,
      kycStatus: 'VERIFIED'
    },
    // Banned Users (5)
    {
      count: 5,
      role: 'banned',
      baseBalance: 0,
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
        const balanceVariation = Math.floor(Math.random() * 100); // 0-100 variation

        // Generate unique identifier for this user
        const userIdentifier = `${group.role}_${groupIndex}_${index}`;
        const wallet = WalletGenerator.generateWallet(userIdentifier);

        return prisma.users.create({
          data: {
            wallet_address: wallet.publicKey,
            nickname: generateNickname(group.role, index),
            role: group.role,
            balance: new Decimal(group.baseBalance + balanceVariation),
            total_contests: contests,
            total_wins: wins,
            experience_points: group.baseExp + expVariation,
            total_achievement_points: group.baseAchievements,
            rank_score: group.baseRank + rankVariation,
            highest_rank_score: group.baseRank + Math.max(0, rankVariation),
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

  // Add your personal admin account
  const superAdmin = await prisma.users.upsert({
    where: {
      wallet_address: WalletGenerator.generateWallet('superadmin').publicKey
    },
    update: {
      nickname: 'BranchManager69',
      role: 'superadmin',
      balance: new Decimal('1069'),
      experience_points: 100000,
      total_achievement_points: 5000,
      rank_score: 2500,
      highest_rank_score: 2800,
      is_banned: false,
      kyc_status: 'VERIFIED',
      risk_level: 0,
      user_stats: {
        upsert: {
          create: {
            contests_entered: 50,
            contests_won: 20,
            total_prize_money: new Decimal('5000'),
            best_score: new Decimal('95.5'),
            avg_score: new Decimal('82.3')
          },
          update: {
            contests_entered: 50,
            contests_won: 20,
            total_prize_money: new Decimal('5000'),
            best_score: new Decimal('95.5'),
            avg_score: new Decimal('82.3')
          }
        }
      }
    },
    create: {
      wallet_address: WalletGenerator.generateWallet('superadmin').publicKey,
      nickname: 'BranchManager69',
      role: 'superadmin',
      balance: new Decimal('1069'),
      experience_points: 100000,
      total_achievement_points: 5000,
      rank_score: 2500,
      highest_rank_score: 2800,
      is_banned: false,
      kyc_status: 'VERIFIED',
      risk_level: 0,
      user_stats: {
        create: {
          contests_entered: 50,
          contests_won: 20,
          total_prize_money: new Decimal('5000'),
          best_score: new Decimal('95.5'),
          avg_score: new Decimal('82.3')
        }
      }
    }
  });

  const totalUsers = users.length + 1; // +1 for superadmin
  console.log(`Seeded ${totalUsers} users`);
  console.log('Created superadmin account:', {
    nickname: superAdmin.nickname,
    role: superAdmin.role,
    wallet: superAdmin.wallet_address
  });
  
  return [...users, superAdmin];
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
