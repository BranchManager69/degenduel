## Services

/* Import all DegenDuel services */

//   (1)  Infrastructure Layer
import solanaEngine from '../../services/solana-engine/index.js';
import walletGeneratorService from '../../services/walletGenerationService.js';
import liquidityService from '../../services/liquidityService.js';
// Legacy solana service - imported but not used as primary [EDIT 4/27/25: Now deprecated. Fully removed from here!]
////import solanaService from '../../services/solanaService.js';

//   (2)  Data Layer
// tokenSyncService has been permanently removed
// tokenWhitelistService has been permanently disabled (using token.is_active flag instead)
import marketDataService from '../../services/market-data/marketDataService.js';
import tokenRefreshIntegration from '../../services/token-refresh-integration.js';
import tokenDEXDataService from '../../services/token-dex-data-service/index.js';
import tokenDetectionService from '../../services/token-detection-service/index.js';
// [the one below is brand new!]
import tokenEnrichmentService from '../../services/token-enrichment/index.js';
// [the one below doesn't exist yet...]
//import tokenPriorityService from '../../services/token-priority/index.js';

//   (3)  Contest Layer
// Discord notification service
import discordNotificationService from '../../services/discord/discordNotificationService.js';
import discordInteractiveService from '../../services/discord/discord-interactive-service.js';

//   (4)  Contest Layer
import contestEvaluationService from '../../services/contestEvaluationService.js';
import contestSchedulerService from '../../services/contestSchedulerService.js';
import achievementService from '../../services/achievementService.js';
import referralService from '../../services/referralService.js';
import levelingService from '../../services/levelingService.js';
import launchEventService from '../../services/launchEventService.js';
import portfolioSnapshotService from '../../services/portfolioSnapshotService.js';

//   (5)  Wallet Layer
import contestWalletService from '../../services/contest-wallet/index.js';
import adminWalletService from '../../services/admin-wallet/index.js';
import userBalanceTrackingService from '../../services/user-balance-tracking/index.js';
import vanityWalletService from '../../services/vanity-wallet/index.js';
// DEPRECATED: walletRakeService - functionality has been integrated into contestWalletService
// import walletRakeService from '../../services/walletRakeService.js';

//   (6) Application Layer (New)
import aiService from '../../services/ai-service/index.js';