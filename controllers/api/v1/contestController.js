import prisma from '../../../config/prisma.js';
import { logApi } from '../../../utils/logger-suite/logger.js';
import { fancyColors } from '../../../utils/colors.js';
import { Decimal } from '@prisma/client/runtime/library'; // Import Decimal
import marketDataService from '../../../services/market-data/marketDataService.js'; // Import MarketDataService

const contestController = {
  // ... other existing controller methods ...

  /**
   * GET /api/v1/contests/:contestId/view
   * Fetches a comprehensive view of a specific contest, including leaderboard
   * and current user's performance details.
   */
  getContestView: async (req, res) => {
    const { contestId } = req.params;
    const numericContestId = parseInt(contestId);

    // Assuming requireAuth middleware adds user info to req.user
    const currentUserWalletAddress = req.user?.wallet_address;

    if (isNaN(numericContestId)) {
      return res.status(400).json({ success: false, error: 'Invalid contest ID format' });
    }

    if (!currentUserWalletAddress) {
      // This shouldn't happen if requireAuth middleware is working correctly
      logApi.error('[getContestView] User wallet address not found in request after requireAuth');
      return res.status(401).json({ success: false, error: 'Authentication context missing' });
    }

    try {
      // 1. Fetch Contest Details
      const contest = await prisma.contests.findUnique({
        where: { id: numericContestId },
        include: {
          _count: { select: { contest_participants: true } }
        }
      });

      if (!contest) {
        return res.status(404).json({ success: false, error: 'Contest not found' });
      }

      // 2. Fetch Participants for Leaderboard
      const participantsData = await prisma.contest_participants.findMany({
        where: { contest_id: numericContestId },
        include: {
          users: {
            select: {
              wallet_address: true,
              nickname: true,
              profile_image_url: true,
              role: true,
              is_ai_agent: true // Include the new AI agent flag
            }
          }
        },
        // Use existing rank if available and reliable, otherwise sort by portfolio_value
        orderBy: {
          // Prefer using the rank calculated by a dedicated service if available
          rank: 'asc' 
          // Fallback: portfolio_value: 'desc' 
        }
      });

      // 3. Check if Current User is Participating
      const currentUserParticipantRecord = participantsData.find(
        p => p.wallet_address === currentUserWalletAddress
      );
      const isCurrentUserParticipating = !!currentUserParticipantRecord;

      // 4. Format Leaderboard
      const leaderboard = participantsData.map((p, index) => {
        // Use pre-calculated rank if available, otherwise use index + 1 from sorting
        const rank = p.rank ?? (index + 1); 
        const portfolioValue = p.portfolio_value ?? new Decimal(0);
        const initialBalance = p.initial_balance ?? new Decimal(0);
        let performancePercentage = new Decimal(0);
        if (initialBalance.gt(0)) {
          performancePercentage = portfolioValue.sub(initialBalance).div(initialBalance).mul(100);
        } else if (portfolioValue.gt(0)) {
          performancePercentage = new Decimal(100); // Handle case where initial is 0 but value increased
        }

        const isCurrentUser = p.wallet_address === currentUserWalletAddress;
        // Safely access user data, providing fallbacks
        const user = p.users || {}; 
        const username = user.nickname || p.wallet_address.substring(0, 6) + '...';
        const isAiAgent = user.is_ai_agent || false;
        const profilePictureUrl = user.profile_image_url || null;

        return {
          rank: rank,
          userId: p.wallet_address, // Using wallet_address as userId as confirmed
          username: username,
          profilePictureUrl: profilePictureUrl, 
          portfolioValue: portfolioValue.toFixed(8), // Format as string 
          performancePercentage: performancePercentage.toFixed(2), // Format as string
          isCurrentUser: isCurrentUser,
          isAiAgent: isAiAgent,
          prizeAwarded: p.prize_amount ? p.prize_amount.toFixed(8) : null // Format as string if exists
        };
      });

      // 5. Prepare Current User Performance Data (if participating)
      let currentUserPerformance = null;
      if (isCurrentUserParticipating && currentUserParticipantRecord) {
        const userPortfolioValue = currentUserParticipantRecord.portfolio_value ?? new Decimal(0);
        const userInitialBalance = currentUserParticipantRecord.initial_balance ?? new Decimal(0);
        const userJoinedAt = currentUserParticipantRecord.joined_at; // Get join time
        let userPerformancePercentage = new Decimal(0);
        
        if (userInitialBalance.gt(0)) {
          userPerformancePercentage = userPortfolioValue.sub(userInitialBalance).div(userInitialBalance).mul(100);
        } else if (userPortfolioValue.gt(0)) {
          userPerformancePercentage = new Decimal(100);
        }
        
        const currentUserRank = leaderboard.find(entry => entry.isCurrentUser)?.rank || null;

        // Fetch user's token portfolio including quantity
        const userPortfolioTokensData = await prisma.contest_portfolios.findMany({
          where: {
            contest_id: numericContestId,
            wallet_address: currentUserWalletAddress
          },
          include: {
            tokens: { 
              select: {
                id: true, // Need ID for price lookups
                symbol: true,
                name: true,
                image_url: true
              }
            }
          },
          // Select quantity explicitly
          select: {
              token_id: true,
              quantity: true,
              weight: true, // Keep weight for display if needed
              tokens: true // Include the nested select
          }
        });
        
        let userTokens = []; // Initialize array
        if (userPortfolioTokensData.length > 0) {
            const userTokenIds = userPortfolioTokensData.map(pt => pt.token_id);

            // Fetch current prices
            let currentTokenPricesMap = new Map();
            try {
                currentTokenPricesMap = await marketDataService.getCurrentPricesMap(userTokenIds);
            } catch (priceError) {
                 logApi.warn(`[getContestView] Failed to get current prices for user ${currentUserWalletAddress}, contest ${contestId}: ${priceError.message}`);
                 // Proceed without current price data for tokens, values will be null
            }

            // Fetch initial prices (closest price BEFORE or AT CONTEST START time)
            const contestStartTime = contest.start_time; // Use contest start time
            const initialPricePromises = userTokenIds.map(tokenId => 
                prisma.token_price_history.findFirst({
                    where: {
                        token_id: tokenId,
                        timestamp: { lte: contestStartTime } // Use contestStartTime
                    },
                    orderBy: {
                        timestamp: 'desc' // Get the latest one before/at contest start
                    },
                    select: { token_id: true, price: true }
                })
            );
            const initialPriceResults = await Promise.all(initialPricePromises);
            const initialTokenPricesMap = new Map();
            initialPriceResults.forEach(p => {
                if (p) { // Check if a price was found
                    initialTokenPricesMap.set(p.token_id, p.price ? new Decimal(p.price) : new Decimal(0));
                }
            });

            // Calculate detailed performance for each token
            userTokens = userPortfolioTokensData.map(pt => {
                const quantity = pt.quantity ? new Decimal(pt.quantity) : new Decimal(0);
                const currentPrice = currentTokenPricesMap.get(pt.token_id) ?? new Decimal(0);
                const initialPriceAtContestStart = initialTokenPricesMap.get(pt.token_id) ?? new Decimal(0); // Price at start

                const currentValueContribution = quantity.mul(currentPrice);
                // Initial value is based on quantity (determined at join) * price at contest start
                const initialValueContribution = quantity.mul(initialPriceAtContestStart); 
                const profitLossValueContribution = currentValueContribution.sub(initialValueContribution);
                
                let performancePercentage = new Decimal(0);
                if (initialValueContribution.gt(0)) {
                    performancePercentage = profitLossValueContribution.div(initialValueContribution).mul(100);
                } else if (currentValueContribution.gt(0)) {
                    // If started at 0 value but now has value, PnL is effectively infinite/100%
                    performancePercentage = new Decimal(100); 
                }

                return {
                    symbol: pt.tokens.symbol || 'UNKNOWN',
                    name: pt.tokens.name || 'Unknown Token',
                    imageUrl: pt.tokens.image_url || null,
                    weight: pt.weight, // Include weight as it might be useful context
                    quantity: quantity.toFixed(8), // Return quantity as string
                    initialValueContribution: initialValueContribution.toFixed(8),
                    currentValueContribution: currentValueContribution.toFixed(8),
                    performancePercentage: performancePercentage.toFixed(2),
                    profitLossValueContribution: profitLossValueContribution.toFixed(8)
                };
            });
        }

        // Fetch historical performance data from snapshots
        let historicalPerformance = [];
        try {
            const historyData = await prisma.contest_portfolio_history.findMany({
                where: { contest_participant_id: currentUserParticipantRecord.id },
                orderBy: { timestamp: 'asc' },
                select: { timestamp: true, portfolio_value: true }
            });
            historicalPerformance = historyData.map(h => ({
                timestamp: h.timestamp.toISOString(),
                value: h.portfolio_value.toFixed(8)
            }));
        } catch (historyError) {
            logApi.error(`[getContestView] Failed to fetch portfolio history for user ${currentUserWalletAddress}, contest ${contestId}: ${historyError.message}`);
            // Return empty array on error
        }

        currentUserPerformance = {
          rank: currentUserRank,
          portfolioValue: userPortfolioValue.toFixed(8),
          initialPortfolioValue: userInitialBalance.toFixed(8),
          performancePercentage: userPerformancePercentage.toFixed(2),
          historicalPerformance: historicalPerformance, // Assign fetched data (could be empty)
          tokens: userTokens 
        };
      }

      // 6. Assemble Final Response
      const responsePayload = {
        contest: {
          id: contest.id.toString(),
          name: contest.name,
          description: contest.description || '',
          status: contest.status,
          startTime: contest.start_time.toISOString(),
          endTime: contest.end_time.toISOString(),
          entryFee: contest.entry_fee?.toFixed(8) || '0.00000000',
          prizePool: contest.prize_pool.toFixed(8), // Assuming prize_pool is not nullable
          currency: 'SOL', // TODO: Make currency dynamic if needed
          participantCount: contest._count.contest_participants,
          settings: {
            // TODO: Populate settings from contest.settings JSON or other sources
            difficulty: contest.settings?.difficulty || 'unknown', 
            maxParticipants: contest.max_participants || null,
            minParticipants: contest.min_participants,
            tokenTypesAllowed: contest.settings?.tokenTypesAllowed || ['SPL'], 
            startingPortfolioValue: contest.settings?.startingPortfolioValue || '10000' // Example default
          },
          isCurrentUserParticipating: isCurrentUserParticipating
        },
        leaderboard: leaderboard,
        currentUserPerformance: currentUserPerformance
      };

      res.status(200).json({ success: true, data: responsePayload });

    } catch (error) {
      logApi.error(`${fancyColors.RED}[getContestView - Contest ID: ${contestId}] Error fetching contest view data:${fancyColors.RESET}`, error);
      res.status(500).json({ success: false, error: 'Internal server error while fetching contest data.' });
    }
  },

  // ... other existing controller methods ...
};

export default contestController; 