import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

export async function seedContestParticipants() {
  console.log('Seeding contest participants...');

  // Get all contests
  const contests = await prisma.contests.findMany();

  // Get users that can participate (excluding banned users)
  const users = await prisma.users.findMany({
    where: {
      role: {
        in: ['user', 'superadmin', 'admin']
      },
      isBanned: false // Explicitly exclude banned users
    }
  });

  const participants = await Promise.all(
    contests.map(async (contest) => {
      // Get random users up to participant_count (default to 2 if null)
      const participantCount = contest.participant_count || 2;
      const shuffledUsers = users.sort(() => 0.5 - Math.random());
      const contestUsers = shuffledUsers.slice(0, participantCount);

      // Create participants for this contest
      return Promise.all(
        contestUsers.map(async (user, index) => {
          const isWinner = index < 3; // Top 3 for completed contests
          const finalRank = isWinner ? index + 1 : Math.floor(Math.random() * (participantCount - 3)) + 4;
          
          // Create entry transaction
          const entryTransaction = await prisma.transactions.create({
            data: {
              wallet_address: user.wallet_address,
              type: 'CONTEST_ENTRY',
              amount: contest.entry_fee || new Decimal('0'),
              contest_id: contest.id,
              description: `Entry fee for contest ${contest.name}`,
              status: 'completed',
              balance_before: new Decimal('0'),
              balance_after: new Decimal('0')
            }
          });

          // For completed contests, create prize transaction for winners
          let prizeTransaction = null;
          if (contest.status === 'completed' && isWinner) {
            const prizeStructure = [0.70, 0.20, 0.10];
            const prizeAmount = new Decimal(contest.prize_pool || '0').mul(prizeStructure[index]);
            
            prizeTransaction = await prisma.transactions.create({
              data: {
                wallet_address: user.wallet_address,
                type: 'PRIZE_PAYOUT',
                amount: prizeAmount,
                contest_id: contest.id,
                description: `Prize payout for ${finalRank}${finalRank === 1 ? 'st' : finalRank === 2 ? 'nd' : 'rd'} place in contest ${contest.name}`,
                status: 'completed',
                balance_before: new Decimal('0'),
                balance_after: new Decimal('0')
              }
            });
          }

          // Create contest participant
          return prisma.contest_participants.create({
            data: {
              contest_id: contest.id,
              wallet_address: user.wallet_address,
              rank: Math.floor(Math.random() * participantCount) + 1,
              entry_transaction_id: entryTransaction.id,
              final_rank: contest.status === 'completed' ? finalRank : null,
              prize_amount: prizeTransaction?.amount || null,
              prize_transaction_id: prizeTransaction?.id || null,
              prize_paid_at: prizeTransaction ? new Date() : null
            }
          });
        })
      );
    })
  );

  const totalParticipants = participants.reduce((acc, curr) => acc + curr.length, 0);
  console.log(`Seeded ${totalParticipants} contest participants`);
  
  return participants;
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedContestParticipants()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 