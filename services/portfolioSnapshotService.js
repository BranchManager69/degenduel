// services/portfolioSnapshotService.js

/**
 * Portfolio Snapshot Service
 *  
 *     This service is responsible for creating and saving portfolio snapshots for active participants.
 * 
 *     It runs periodically to collect and save portfolio values for all active participants.
 */

import prisma from '../config/prisma.js';
import { BaseService } from '../utils/service-suite/base-service.js';
import { SERVICE_NAMES } from '../utils/service-suite/service-constants.js';
import { logApi } from '../utils/logger-suite/logger.js';
import { fancyColors, serviceColors } from '../utils/colors.js';
import { Decimal } from '@prisma/client/runtime/library';
import serviceManager from '../utils/service-suite/service-manager.js';
import serviceEvents from '../utils/service-suite/service-events.js';

// --- Configuration ---
const SERVICE_NAME = SERVICE_NAMES.PORTFOLIO_SNAPSHOT;
const CHECK_INTERVAL_MS = 15 * 1000; // Run every 15 seconds
const BATCH_SIZE = 100; // Process participants in batches
// ---------------------

class PortfolioSnapshotService extends BaseService {
  constructor() {
    super({
      name: SERVICE_NAME,
      checkIntervalMs: CHECK_INTERVAL_MS,
      // Add other BaseService config overrides if needed (e.g., circuit breaker)
    });
  }

  /**
   * Main operation method called by the BaseService interval.
   */
  async onPerformOperation() {
    const startTime = Date.now();
    logApi.info(`${serviceColors.info}[${this.name}]${fancyColors.RESET} Starting portfolio snapshot cycle...`);

    try {
      let totalParticipantsProcessed = 0;
      let totalSnapshotsSaved = 0;
      let hasMoreParticipants = true;
      let skip = 0;

      // Get MarketDataService instance
      const marketDataService = this.serviceManager.getService(SERVICE_NAMES.MARKET_DATA);
      if (!marketDataService) {
        logApi.warn(`[${this.name}] Market Data Service not available, skipping cycle.`);
        return;
      }

      while (hasMoreParticipants) {
        // 1. Fetch a batch of active participants 
        // Ensure we fetch fields needed for event emissions later
        const currentBatchParticipants = await prisma.contest_participants.findMany({
          where: {
            status: 'active',
            contests: { status: 'active' }
          },
          select: {
            id: true,
            contest_id: true,         // Needed for leaderboard event
            wallet_address: true,     // Needed for participant event
            initial_balance: true,    // Needed for performance % in leaderboard/participant event
            rank: true,               // Current rank, might be useful context
            contest_portfolios: { 
              select: {
                token_id: true,
                quantity: true
              }
            },
            // Include users to get is_ai_agent and nickname for leaderboard context if needed directly here
            users: { select: { wallet_address: true, nickname: true, profile_image_url: true, role: true, is_ai_agent: true } }
          },
          orderBy: { id: 'asc' },
          skip: skip,
          take: BATCH_SIZE,
        });

        if (currentBatchParticipants.length === 0) {
          hasMoreParticipants = false;
          continue;
        }

        // 2. Collect unique token IDs (from currentBatchParticipants)
        const uniqueTokenIds = Array.from(
          new Set(
            currentBatchParticipants.flatMap(p => p.contest_portfolios.map(cp => cp.token_id))
          )
        );

        // 3. Fetch current prices for these tokens using MarketDataService
        let currentTokenPricesMap = new Map();
        if (uniqueTokenIds.length > 0) {
            try {
                 currentTokenPricesMap = await marketDataService.getCurrentPricesMap(uniqueTokenIds);
            } catch (priceError) {
                logApi.error(`[${this.name}] Failed to get prices from MarketDataService: ${priceError.message}. Skipping batch.`);
                skip += BATCH_SIZE; // Move to next batch on price error
                continue; 
            }
        } else {
             // If a participant has no tokens somehow, skip price fetch for this batch
             logApi.debug(`[${this.name}] No unique token IDs found in current participant batch (Skip: ${skip}).`);
        }
       
        totalParticipantsProcessed += currentBatchParticipants.length;
        const snapshotsToSave = [];
        const participantUpdatesForDB = [];
        const participantDetailsForEvent = []; // Store details needed for events
        const now = new Date();
        const affectedContestIdsForEvents = new Set();

        // 4. Calculate current portfolio value and prepare updates
        for (const participant of currentBatchParticipants) {
          let calculatedPortfolioValue = new Decimal(0);
          if (participant.contest_portfolios && participant.contest_portfolios.length > 0) {
            for (const portfolioItem of participant.contest_portfolios) {
              const currentPrice = currentTokenPricesMap.get(portfolioItem.token_id);
              const quantity = portfolioItem.quantity ? new Decimal(portfolioItem.quantity) : new Decimal(0);
              if (currentPrice && quantity.greaterThan(0) && currentPrice.greaterThanOrEqualTo(0)) { 
                calculatedPortfolioValue = calculatedPortfolioValue.add(quantity.mul(currentPrice));
              }
            }
          }
          if (calculatedPortfolioValue.greaterThan(0)) {
            snapshotsToSave.push({
              contest_participant_id: participant.id,
              timestamp: now,
              portfolio_value: calculatedPortfolioValue
            });
          }
          participantUpdatesForDB.push({
            id: participant.id,
            portfolio_value: calculatedPortfolioValue
          });
          // Store details for event emission AFTER DB update
          participantDetailsForEvent.push({
              id: participant.id,
              contest_id: participant.contest_id,
              wallet_address: participant.wallet_address,
              initial_balance: participant.initial_balance,
              new_portfolio_value: calculatedPortfolioValue
          });
          affectedContestIdsForEvents.add(participant.contest_id);
        }

        // 5. Save batch of snapshots
        if (snapshotsToSave.length > 0) {
          const result = await prisma.contest_portfolio_history.createMany({
            data: snapshotsToSave,
            skipDuplicates: true,
          });
          totalSnapshotsSaved += result.count;
        }

        // 6. Batch update contest_participants.portfolio_value using prisma.$transaction
        if (participantUpdatesForDB.length > 0) {
          try {
            await prisma.$transaction(
              participantUpdatesForDB.map(update => 
                prisma.contest_participants.update({
                  where: { id: update.id },
                  data: { portfolio_value: update.portfolio_value },
                })
              )
            );
            logApi.info(`[${this.name}] Batch updated portfolio_value for ${participantUpdatesForDB.length} participants.`);

            // --- Emit events AFTER successful DB update ---
            for (const details of participantDetailsForEvent) {
                const initialBalance = details.initial_balance ?? new Decimal(0);
                let perfPercentage = new Decimal(0);
                if (initialBalance.gt(0)) {
                    perfPercentage = details.new_portfolio_value.sub(initialBalance).div(initialBalance).mul(100);
                }

                // Calculate fresh rank for this participant
                const newRank = await prisma.contest_participants.count({
                    where: {
                        contest_id: details.contest_id,
                        portfolio_value: { gt: details.new_portfolio_value } 
                    }
                }) + 1;

                serviceEvents.emit('contest:participant:updated', {
                    contestId: details.contest_id,
                    walletAddress: details.wallet_address,
                    participantData: {
                        rank: newRank, // Freshly calculated rank
                        portfolioValue: details.new_portfolio_value.toFixed(8),
                        performancePercentage: perfPercentage.toFixed(2)
                    }
                });
            }

            for (const contestId of affectedContestIdsForEvents) {
                // Re-fetch top N for leaderboard broadcast - rank will be based on latest values
                const latestLeaderboardData = await prisma.contest_participants.findMany({
                    where: { contest_id: contestId, status: 'active' },
                    include: { users: { select: { wallet_address: true, nickname: true, profile_image_url: true, role: true, is_ai_agent: true } } },
                    orderBy: { portfolio_value: 'desc' },
                    take: 100, // Or a configurable limit
                });

                const formattedLeaderboard = latestLeaderboardData.map((lp, index) => {
                    const initialBalance = lp.initial_balance ?? new Decimal(0);
                    const portfolioValue = lp.portfolio_value ?? new Decimal(0);
                    let performancePercentage = new Decimal(0);
                    if (initialBalance.gt(0)) {
                        performancePercentage = portfolioValue.sub(initialBalance).div(initialBalance).mul(100);
                    }
                    return {
                        rank: index + 1,
                        userId: lp.users.wallet_address,
                        username: lp.users.nickname || lp.users.wallet_address.substring(0,6) + '...',
                        profilePictureUrl: lp.users.profile_image_url,
                        portfolioValue: portfolioValue.toFixed(8),
                        performancePercentage: performancePercentage.toFixed(2),
                        isCurrentUser: false, // Client can determine this
                        isAiAgent: lp.users.is_ai_agent || false,
                        prizeAwarded: lp.prize_amount ? lp.prize_amount.toFixed(8) : null
                    };
                });

                serviceEvents.emit('contest:leaderboard:updated', {
                    contestId: contestId,
                    leaderboard: formattedLeaderboard
                });
                logApi.info(`[${this.name}] Emitted leaderboard update for contest ${contestId}`);
            }

          } catch (batchUpdateError) {
            logApi.error(`[${this.name}] Error batch updating portfolio_value for participants via transaction:`, batchUpdateError);
            // Consider how to handle partial failures if not all updates in transaction succeed, though $transaction should roll back.
            // For now, we log the error. The service will retry the whole batch on the next cycle if a transient error occurred.
          }
        }

        skip += BATCH_SIZE;
      } // End while loop

      const durationMs = Date.now() - startTime;
      logApi.info(`[${this.name}] Cycle complete. Processed: ${totalParticipantsProcessed}, Saved: ${totalSnapshotsSaved}, Duration: ${durationMs}ms`);

    } catch (error) {
      logApi.error(`[${this.name}] Error during snapshot cycle:`, error);
      throw error; 
    }
  }
}

// Export an instance of the service
const portfolioSnapshotService = new PortfolioSnapshotService();
export default portfolioSnapshotService; 