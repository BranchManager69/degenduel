import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedPortfolios() {
  console.log('Seeding portfolios...');

  // Get users
  const users = await prisma.users.findMany({
    where: {
      role: {
        in: ['user', 'superadmin']
      }
    }
  });

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

  console.log(`Seeded ${portfolios.length} portfolio entries`);
  
  return portfolios;
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
