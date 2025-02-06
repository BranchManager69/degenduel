import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedUserLevels() {
  console.log('Seeding user levels...');

  // Create user levels
  const levels = await Promise.all([
    prisma.user_levels.create({
      data: {
        level_number: 1,
        class_name: 'Novice',
        title: 'Trading Initiate',
        min_exp: 0,
        bronze_achievements_required: 0,
        silver_achievements_required: 0,
        gold_achievements_required: 0,
        platinum_achievements_required: 0,
        diamond_achievements_required: 0,
        icon_url: '/assets/levels/novice.png'
      }
    }),
    prisma.user_levels.create({
      data: {
        level_number: 5,
        class_name: 'Apprentice',
        title: 'Market Explorer',
        min_exp: 1000,
        bronze_achievements_required: 3,
        silver_achievements_required: 1,
        gold_achievements_required: 0,
        platinum_achievements_required: 0,
        diamond_achievements_required: 0,
        icon_url: '/assets/levels/apprentice.png'
      }
    }),
    prisma.user_levels.create({
      data: {
        level_number: 10,
        class_name: 'Journeyman',
        title: 'Portfolio Strategist',
        min_exp: 5000,
        bronze_achievements_required: 8,
        silver_achievements_required: 3,
        gold_achievements_required: 1,
        platinum_achievements_required: 0,
        diamond_achievements_required: 0,
        icon_url: '/assets/levels/journeyman.png'
      }
    }),
    prisma.user_levels.create({
      data: {
        level_number: 25,
        class_name: 'Expert',
        title: 'Market Maven',
        min_exp: 25000,
        bronze_achievements_required: 15,
        silver_achievements_required: 8,
        gold_achievements_required: 3,
        platinum_achievements_required: 1,
        diamond_achievements_required: 0,
        icon_url: '/assets/levels/expert.png'
      }
    }),
    prisma.user_levels.create({
      data: {
        level_number: 50,
        class_name: 'Master',
        title: 'Trading Virtuoso',
        min_exp: 100000,
        bronze_achievements_required: 25,
        silver_achievements_required: 15,
        gold_achievements_required: 8,
        platinum_achievements_required: 3,
        diamond_achievements_required: 1,
        icon_url: '/assets/levels/master.png'
      }
    })
  ]);

  // Create level rewards
  const rewards = await Promise.all([
    // Level 5 rewards
    prisma.level_rewards.create({
      data: {
        level_id: levels[1].id,
        reward_type: 'CONTEST_FEE_DISCOUNT',
        reward_value: { percentage: 5 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[1].id,
        reward_type: 'BONUS_EXP',
        reward_value: { percentage: 10 }
      }
    }),

    // Level 10 rewards
    prisma.level_rewards.create({
      data: {
        level_id: levels[2].id,
        reward_type: 'CONTEST_FEE_DISCOUNT',
        reward_value: { percentage: 10 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[2].id,
        reward_type: 'BONUS_EXP',
        reward_value: { percentage: 15 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[2].id,
        reward_type: 'SPECIAL_TITLE',
        reward_value: { title: 'Portfolio Pro' }
      }
    }),

    // Level 25 rewards
    prisma.level_rewards.create({
      data: {
        level_id: levels[3].id,
        reward_type: 'CONTEST_FEE_DISCOUNT',
        reward_value: { percentage: 20 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[3].id,
        reward_type: 'BONUS_EXP',
        reward_value: { percentage: 25 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[3].id,
        reward_type: 'SPECIAL_AVATAR_FRAME',
        reward_value: { frame_id: 'expert_frame_1' }
      }
    }),

    // Level 50 rewards
    prisma.level_rewards.create({
      data: {
        level_id: levels[4].id,
        reward_type: 'CONTEST_FEE_DISCOUNT',
        reward_value: { percentage: 30 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[4].id,
        reward_type: 'BONUS_EXP',
        reward_value: { percentage: 50 }
      }
    }),
    prisma.level_rewards.create({
      data: {
        level_id: levels[4].id,
        reward_type: 'EXCLUSIVE_CONTESTS',
        reward_value: { contest_types: ['MASTER_LEAGUE', 'ELITE_CHALLENGES'] }
      }
    })
  ]);

  console.log(`Seeded ${levels.length} user levels`);
  console.log(`Seeded ${rewards.length} level rewards`);
  
  return { levels, rewards };
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedUserLevels()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 