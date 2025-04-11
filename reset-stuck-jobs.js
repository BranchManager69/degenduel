import prisma from './config/prisma.js';
import { logApi } from './utils/logger-suite/logger.js';

async function resetStuckJobs() {
  try {
    // Find jobs that have been in 'processing' state for too long
    const stuckJobs = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'processing',
      },
      orderBy: {
        id: 'asc'
      }
    });
    
    console.log(`Found ${stuckJobs.length} jobs in 'processing' state`);
    
    // Reset stuck jobs to 'pending' state
    for (const job of stuckJobs) {
      console.log(`Resetting job #${job.id} (${job.pattern}) - stuck since ${job.updated_at}`);
      
      await prisma.vanity_wallet_pool.update({
        where: { id: job.id },
        data: {
          status: 'pending',
          updated_at: new Date()
        }
      });
    }
    
    console.log(`Reset ${stuckJobs.length} jobs to 'pending' state`);
  } catch (error) {
    console.error('Error resetting stuck jobs:', error);
  } finally {
    await prisma.$disconnect();
  }
}

resetStuckJobs().then(() => process.exit(0));
