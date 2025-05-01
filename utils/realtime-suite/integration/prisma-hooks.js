/**
 * @file Prisma middleware integration for realtime events
 * @description Automatically publishes events when data changes
 */

import realtime from '../index.js';
import { TOKEN_CHANNELS, CONTEST_CHANNELS, USER_CHANNELS } from '../channels.js';
import { logApi } from '../../logger-suite/logger.js';

/**
 * Configure Prisma middleware to publish realtime events on data changes
 * @param {PrismaClient} prisma - Prisma client instance
 */
export function setupPrismaRealtimeHooks(prisma) {
  // Add middleware for automatic event publishing
  prisma.$use(async (params, next) => {
    // Process the operation
    const result = await next(params);
    
    // Don't process anything for non-mutations
    if (params.action !== 'update' && params.action !== 'create' && params.action !== 'delete') {
      return result;
    }
    
    try {
      // Handle token_prices updates
      if (params.model === 'token_prices' && params.action === 'update') {
        // Get the token information
        const token = await prisma.tokens.findUnique({
          where: { id: params.args.where.token_id },
          select: { id: true, address: true }
        });
        
        if (token) {
          // Publish price update event
          await realtime.publish(TOKEN_CHANNELS.PRICE, {
            id: token.id,
            address: token.address,
            price: params.args.data.price,
            previousPrice: result.price, // From the update result
            timestamp: Date.now()
          });
        }
      }
      
      // Handle contests status updates
      if (params.model === 'contests' && params.action === 'update' && params.args.data.status) {
        await realtime.publish(CONTEST_CHANNELS.STATUS, {
          id: params.args.where.id,
          code: result.contest_code,
          previousStatus: result.status, 
          status: params.args.data.status,
          participantCount: result.participant_count,
          prizePool: result.current_prize_pool.toString(),
          timestamp: Date.now()
        });
      }
      
      // Handle wallet balance updates
      if (params.model === 'wallet_balance_history' && params.action === 'create') {
        await realtime.publish(USER_CHANNELS.BALANCE, {
          walletAddress: result.wallet_address,
          balance: result.balance_lamports.toString(),
          currency: 'SOL',
          timestamp: Date.now()
        });
      }
    } catch (err) {
      // Log error but don't block the operation
      logApi.error('Error in Prisma middleware realtime hook:', err);
    }
    
    // Always return the result
    return result;
  });
  
  logApi.info('Prisma realtime hooks configured');
}