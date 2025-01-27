import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';
import { seedTokens } from './01_tokens.js';
import { seedUsers } from './02_users.js';
import { seedContests } from './03_contests.js';
import { seedPortfolios } from './04_portfolios.js';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Starting database seeding...');

    // Run seeds in order
    await seedTokens();
    console.log('✓ Tokens seeded successfully');

    await seedUsers();
    console.log('✓ Users seeded successfully');

    await seedContests();
    console.log('✓ Contests seeded successfully');

    await seedPortfolios();
    console.log('✓ Portfolios seeded successfully');

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} 
