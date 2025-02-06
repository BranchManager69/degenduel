import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedAchievements() {
  console.log('Seeding achievements...');

  // Create achievement categories
  const categories = await Promise.all([
    prisma.achievement_categories.create({
      data: {
        name: 'Trading Performance',
        description: 'Achievements related to trading success and portfolio management'
      }
    }),
    prisma.achievement_categories.create({
      data: {
        name: 'Contest Participation',
        description: 'Achievements for participating in and winning contests'
      }
    }),
    prisma.achievement_categories.create({
      data: {
        name: 'Community Engagement',
        description: 'Achievements for community participation and social interaction'
      }
    }),
    prisma.achievement_categories.create({
      data: {
        name: 'Market Analysis',
        description: 'Achievements for successful market predictions and analysis'
      }
    })
  ]);

  // Create achievement tiers
  const tiers = await Promise.all([
    prisma.achievement_tiers.create({
      data: {
        name: 'Bronze',
        color_hex: '#CD7F32',
        points: 100
      }
    }),
    prisma.achievement_tiers.create({
      data: {
        name: 'Silver',
        color_hex: '#C0C0C0',
        points: 250
      }
    }),
    prisma.achievement_tiers.create({
      data: {
        name: 'Gold',
        color_hex: '#FFD700',
        points: 500
      }
    }),
    prisma.achievement_tiers.create({
      data: {
        name: 'Platinum',
        color_hex: '#E5E4E2',
        points: 1000
      }
    }),
    prisma.achievement_tiers.create({
      data: {
        name: 'Diamond',
        color_hex: '#B9F2FF',
        points: 2500
      }
    })
  ]);

  // Create achievement tier requirements
  const requirements = await Promise.all([
    // Trading Performance Requirements
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'PROFITABLE_TRADES',
        tier_id: tiers[0].id,
        requirement_value: { count: 10, profit_percentage: 5 }
      }
    }),
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'PROFITABLE_TRADES',
        tier_id: tiers[4].id,
        requirement_value: { count: 100, profit_percentage: 20 }
      }
    }),

    // Contest Participation Requirements
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'CONTEST_WINS',
        tier_id: tiers[0].id,
        requirement_value: { wins: 1 }
      }
    }),
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'CONTEST_WINS',
        tier_id: tiers[4].id,
        requirement_value: { wins: 50 }
      }
    }),

    // Portfolio Diversity Requirements
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'PORTFOLIO_DIVERSITY',
        tier_id: tiers[0].id,
        requirement_value: { unique_tokens: 5 }
      }
    }),
    prisma.achievement_tier_requirements.create({
      data: {
        achievement_type: 'PORTFOLIO_DIVERSITY',
        tier_id: tiers[4].id,
        requirement_value: { unique_tokens: 25 }
      }
    })
  ]);

  console.log(`Seeded ${categories.length} achievement categories`);
  console.log(`Seeded ${tiers.length} achievement tiers`);
  console.log(`Seeded ${requirements.length} achievement requirements`);
  
  return { categories, tiers, requirements };
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedAchievements()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 