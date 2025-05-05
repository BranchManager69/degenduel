# DegenDuel Service Architecture Compliance Audit

**Running in:** `/home/branchmanager/websites/degenduel`

## Searching for service files...
Found 74 potential service files

## Checking for BaseService extension...

## Checking for super.initialize() calls...
✅ ./services/solana-engine/solana-engine.js calls super.initialize()
✅ ./services/solana-engine/jupiter-client.js calls super.initialize()
✅ ./services/adminWalletService.js calls super.initialize()
❌ ./services/market-data/tokenDetectionService.js extends BaseService but doesn't call super.initialize()
❌ ./services/market-data/marketDataService.js extends BaseService but doesn't call super.initialize()
❌ ./services/discord/discordNotificationService.js extends BaseService but doesn't call super.initialize()
❌ ./services/discord/discord-interactive-service.js extends BaseService but doesn't call super.initialize()
✅ ./services/userBalanceTrackingService.js calls super.initialize()
✅ ./services/tokenMonitorService.js calls super.initialize()
❌ ./services/vanity-wallet/vanity-wallet-service.js extends BaseService but doesn't call super.initialize()
✅ ./services/liquidityService.js calls super.initialize()
✅ ./services/referralService.js calls super.initialize()
✅ ./services/token-enrichment/tokenEnrichmentService.js calls super.initialize()
❌ ./services/token-refresh-integration.js extends BaseService but doesn't call super.initialize()
✅ ./services/solanaService.js calls super.initialize()
✅ ./services/walletRakeService.js calls super.initialize()
✅ ./services/levelingService.js calls super.initialize()
✅ ./services/tokenWhitelistService.js calls super.initialize()
✅ ./services/ai-service/ai-service.js calls super.initialize()
✅ ./services/walletGenerationService.js calls super.initialize()
✅ ./services/aiService.js calls super.initialize()
❌ ./services/token-dex-data-service.js extends BaseService but doesn't call super.initialize()
❌ ./services/token-refresh-scheduler.js extends BaseService but doesn't call super.initialize()
✅ ./services/achievementService.js calls super.initialize()
✅ ./services/admin-wallet/admin-wallet-service.js calls super.initialize()

## Checking for service event emission...
⚠️ ./services/solana-engine/solana-engine.js may not emit service events
✅ ./services/solana-engine/jupiter-client.js emits service events
⚠️ ./services/adminWalletService.js may not emit service events
✅ ./services/market-data/tokenDetectionService.js emits service events
✅ ./services/market-data/marketDataService.js emits service events
⚠️ ./services/discord/discordNotificationService.js may not emit service events
⚠️ ./services/discord/discord-interactive-service.js may not emit service events
⚠️ ./services/userBalanceTrackingService.js may not emit service events
✅ ./services/tokenMonitorService.js emits service events
⚠️ ./services/vanity-wallet/vanity-wallet-service.js may not emit service events
⚠️ ./services/liquidityService.js may not emit service events
⚠️ ./services/referralService.js may not emit service events
✅ ./services/token-enrichment/tokenEnrichmentService.js emits service events
⚠️ ./services/token-refresh-integration.js may not emit service events
⚠️ ./services/solanaService.js may not emit service events
⚠️ ./services/walletRakeService.js may not emit service events
✅ ./services/levelingService.js emits service events
⚠️ ./services/tokenWhitelistService.js may not emit service events
⚠️ ./services/ai-service/ai-service.js may not emit service events
⚠️ ./services/walletGenerationService.js may not emit service events
⚠️ ./services/aiService.js may not emit service events
⚠️ ./services/token-dex-data-service.js may not emit service events
⚠️ ./services/token-refresh-scheduler.js may not emit service events
⚠️ ./services/achievementService.js may not emit service events
⚠️ ./services/admin-wallet/admin-wallet-service.js may not emit service events

## Checking for circuit breaker implementation...
⚠️ ./services/solana-engine/solana-engine.js may not implement circuit breaker pattern
✅ ./services/solana-engine/jupiter-client.js implements circuit breaker pattern
✅ ./services/adminWalletService.js implements circuit breaker pattern
⚠️ ./services/market-data/tokenDetectionService.js may not implement circuit breaker pattern
✅ ./services/market-data/marketDataService.js implements circuit breaker pattern
✅ ./services/discord/discordNotificationService.js implements circuit breaker pattern
⚠️ ./services/discord/discord-interactive-service.js may not implement circuit breaker pattern
✅ ./services/userBalanceTrackingService.js implements circuit breaker pattern
⚠️ ./services/tokenMonitorService.js may not implement circuit breaker pattern
⚠️ ./services/vanity-wallet/vanity-wallet-service.js may not implement circuit breaker pattern
✅ ./services/liquidityService.js implements circuit breaker pattern
✅ ./services/referralService.js implements circuit breaker pattern
✅ ./services/token-enrichment/tokenEnrichmentService.js implements circuit breaker pattern
✅ ./services/token-refresh-integration.js implements circuit breaker pattern
✅ ./services/solanaService.js implements circuit breaker pattern
✅ ./services/walletRakeService.js implements circuit breaker pattern
✅ ./services/levelingService.js implements circuit breaker pattern
✅ ./services/tokenWhitelistService.js implements circuit breaker pattern
✅ ./services/ai-service/ai-service.js implements circuit breaker pattern
✅ ./services/walletGenerationService.js implements circuit breaker pattern
✅ ./services/aiService.js implements circuit breaker pattern
⚠️ ./services/token-dex-data-service.js may not implement circuit breaker pattern
⚠️ ./services/token-refresh-scheduler.js may not implement circuit breaker pattern
✅ ./services/achievementService.js implements circuit breaker pattern
✅ ./services/admin-wallet/admin-wallet-service.js implements circuit breaker pattern

## Checking for handleError usage...
❌ ./services/solana-engine/solana-engine.js doesn't use handleError method
✅ ./services/solana-engine/jupiter-client.js uses handleError
✅ ./services/adminWalletService.js uses handleError
✅ ./services/market-data/tokenDetectionService.js uses handleError
✅ ./services/market-data/marketDataService.js uses handleError
❌ ./services/discord/discordNotificationService.js doesn't use handleError method
❌ ./services/discord/discord-interactive-service.js doesn't use handleError method
❌ ./services/userBalanceTrackingService.js doesn't use handleError method
❌ ./services/tokenMonitorService.js doesn't use handleError method
❌ ./services/vanity-wallet/vanity-wallet-service.js doesn't use handleError method
✅ ./services/liquidityService.js uses handleError
✅ ./services/referralService.js uses handleError
✅ ./services/token-enrichment/tokenEnrichmentService.js uses handleError
❌ ./services/token-refresh-integration.js doesn't use handleError method
❌ ./services/solanaService.js doesn't use handleError method
✅ ./services/walletRakeService.js uses handleError
❌ ./services/levelingService.js doesn't use handleError method
✅ ./services/tokenWhitelistService.js uses handleError
❌ ./services/ai-service/ai-service.js doesn't use handleError method
✅ ./services/walletGenerationService.js uses handleError
❌ ./services/aiService.js doesn't use handleError method
❌ ./services/token-dex-data-service.js doesn't use handleError method
✅ ./services/token-refresh-scheduler.js uses handleError
✅ ./services/achievementService.js uses handleError
✅ ./services/admin-wallet/admin-wallet-service.js uses handleError

## Checking for unsafe stats access patterns...
✅ ./services/solana-engine/solana-engine.js has no obvious unsafe stats access
❌ ./services/solana-engine/jupiter-client.js may have unsafe stats access without null checks:
666:    this.stats.customStats = {
706:      set(this.stats.customStats.tokens, 'total', safe(this.tokenList, 'length', 0));
734:      set(this.stats.customStats.api, 'lastError', error.message);
   ... and 23 more instances
✅ ./services/adminWalletService.js has no obvious unsafe stats access
❌ ./services/market-data/tokenDetectionService.js may have unsafe stats access without null checks:
209:            this.stats.lastCheck = new Date().toISOString();
210:            this.stats.lastBatchSize = tokenAddresses.length;
213:                this.stats.totalDetected += changes.added.length;
   ... and 4 more instances
❌ ./services/market-data/marketDataService.js may have unsafe stats access without null checks:
443:            const lastFailure = new Date(this.stats.circuitBreaker.lastFailure || 0);
451:                this.stats.circuitBreaker.isOpen = false;
452:                this.stats.circuitBreaker.failures = 0;
   ... and 2 more instances
❌ ./services/discord/discordNotificationService.js may have unsafe stats access without null checks:
293:          circuitBreakerStatus: this.stats.circuitBreaker.isOpen ? 'open' : 'closed'
✅ ./services/discord/discord-interactive-service.js has no obvious unsafe stats access
❌ ./services/userBalanceTrackingService.js may have unsafe stats access without null checks:
1289:                serviceStartTime: this.stats.history.lastStarted,
✅ ./services/tokenMonitorService.js has no obvious unsafe stats access
✅ ./services/vanity-wallet/vanity-wallet-service.js has no obvious unsafe stats access
✅ ./services/liquidityService.js has no obvious unsafe stats access
✅ ./services/referralService.js has no obvious unsafe stats access
❌ ./services/token-enrichment/tokenEnrichmentService.js may have unsafe stats access without null checks:
386:        this.stats.enqueuedTotal = (this.stats.enqueuedTotal || 0) + 1;
387:        this.stats.currentQueueSize = this.processingQueue ? this.processingQueue.length : 0;
448:        processedTotal: this.stats.processedTotal,
   ... and 27 more instances
✅ ./services/token-refresh-integration.js has no obvious unsafe stats access
❌ ./services/solanaService.js may have unsafe stats access without null checks:
562:                serviceStartTime: this.stats.history.lastStarted
✅ ./services/walletRakeService.js has no obvious unsafe stats access
✅ ./services/levelingService.js has no obvious unsafe stats access
✅ ./services/tokenWhitelistService.js has no obvious unsafe stats access
❌ ./services/ai-service/ai-service.js may have unsafe stats access without null checks:
268:      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
269:      this.stats.operations.total++;
270:      this.stats.operations.successful++;
   ... and 25 more instances
✅ ./services/walletGenerationService.js has no obvious unsafe stats access
❌ ./services/aiService.js may have unsafe stats access without null checks:
263:      this.stats.performance.lastOperationTimeMs = Date.now() - startTime;
264:      this.stats.operations.total++;
265:      this.stats.operations.successful++;
   ... and 12 more instances
✅ ./services/token-dex-data-service.js has no obvious unsafe stats access
✅ ./services/token-refresh-scheduler.js has no obvious unsafe stats access
✅ ./services/achievementService.js has no obvious unsafe stats access
❌ ./services/admin-wallet/admin-wallet-service.js may have unsafe stats access without null checks:
613:                serviceStartTime: this.stats.history.lastStarted,

## Checking for prisma singleton import...
❌ ./services/solana-engine/solana-engine.js creates new PrismaClient instance
✅ ./services/adminWalletService.js imports prisma singleton
❌ ./services/market-data/marketDataService.js creates new PrismaClient instance
✅ ./services/discord/discordNotificationService.js imports prisma singleton
✅ ./services/discord/discord-interactive-service.js imports prisma singleton
✅ ./services/userBalanceTrackingService.js imports prisma singleton
✅ ./services/tokenMonitorService.js imports prisma singleton
✅ ./services/vanity-wallet/vanity-wallet-service.js imports prisma singleton
✅ ./services/liquidityService.js imports prisma singleton
✅ ./services/referralService.js imports prisma singleton
✅ ./services/token-enrichment/tokenEnrichmentService.js imports prisma singleton
❌ ./services/token-refresh-integration.js creates new PrismaClient instance
✅ ./services/walletRakeService.js imports prisma singleton
✅ ./services/levelingService.js imports prisma singleton
✅ ./services/tokenWhitelistService.js imports prisma singleton
✅ ./services/ai-service/ai-service.js imports prisma singleton
✅ ./services/walletGenerationService.js imports prisma singleton
✅ ./services/aiService.js imports prisma singleton
❌ ./services/token-dex-data-service.js creates new PrismaClient instance
❌ ./services/token-refresh-scheduler.js creates new PrismaClient instance
✅ ./services/achievementService.js imports prisma singleton
✅ ./services/admin-wallet/admin-wallet-service.js imports prisma singleton

## Checking for stop method implementation...
⚠️ ./services/solana-engine/solana-engine.js implements stop method but doesn't call super.stop()
✅ ./services/solana-engine/jupiter-client.js implements stop method with super.stop()
✅ ./services/adminWalletService.js implements stop method with super.stop()
✅ ./services/market-data/tokenDetectionService.js implements stop method with super.stop()
✅ ./services/market-data/marketDataService.js implements stop method with super.stop()
❌ ./services/discord/discordNotificationService.js doesn't implement stop method
✅ ./services/discord/discord-interactive-service.js implements stop method with super.stop()
✅ ./services/userBalanceTrackingService.js implements stop method with super.stop()
❌ ./services/tokenMonitorService.js doesn't implement stop method
❌ ./services/vanity-wallet/vanity-wallet-service.js doesn't implement stop method
✅ ./services/liquidityService.js implements stop method with super.stop()
✅ ./services/referralService.js implements stop method with super.stop()
✅ ./services/token-enrichment/tokenEnrichmentService.js implements stop method with super.stop()
❌ ./services/token-refresh-integration.js doesn't implement stop method
✅ ./services/solanaService.js implements stop method with super.stop()
✅ ./services/walletRakeService.js implements stop method with super.stop()
❌ ./services/levelingService.js doesn't implement stop method
✅ ./services/tokenWhitelistService.js implements stop method with super.stop()
❌ ./services/ai-service/ai-service.js doesn't implement stop method
✅ ./services/walletGenerationService.js implements stop method with super.stop()
❌ ./services/aiService.js doesn't implement stop method
❌ ./services/token-dex-data-service.js doesn't implement stop method
⚠️ ./services/token-refresh-scheduler.js implements stop method but doesn't call super.stop()
✅ ./services/achievementService.js implements stop method with super.stop()
✅ ./services/admin-wallet/admin-wallet-service.js implements stop method with super.stop()

## Checking for serviceManager.register usage...
❌ ./services/solana-engine/solana-engine.js doesn't use serviceManager.register
✅ ./services/solana-engine/jupiter-client.js uses serviceManager.register at line 690
❌ ./services/adminWalletService.js doesn't use serviceManager.register
✅ ./services/market-data/tokenDetectionService.js uses serviceManager.register at line 97
✅ ./services/market-data/marketDataService.js uses serviceManager.register at line 180
❌ ./services/discord/discordNotificationService.js doesn't use serviceManager.register
❌ ./services/discord/discord-interactive-service.js doesn't use serviceManager.register
❌ ./services/userBalanceTrackingService.js doesn't use serviceManager.register
❌ ./services/tokenMonitorService.js doesn't use serviceManager.register
❌ ./services/vanity-wallet/vanity-wallet-service.js doesn't use serviceManager.register
❌ ./services/liquidityService.js doesn't use serviceManager.register
❌ ./services/referralService.js doesn't use serviceManager.register
✅ ./services/token-enrichment/tokenEnrichmentService.js uses serviceManager.register at line 173
✅ ./services/token-refresh-integration.js uses serviceManager.register at line 72
❌ ./services/solanaService.js doesn't use serviceManager.register
❌ ./services/walletRakeService.js doesn't use serviceManager.register
❌ ./services/levelingService.js doesn't use serviceManager.register
❌ ./services/tokenWhitelistService.js doesn't use serviceManager.register
✅ ./services/ai-service/ai-service.js uses serviceManager.register at line 1200
❌ ./services/walletGenerationService.js doesn't use serviceManager.register
✅ ./services/aiService.js uses serviceManager.register at line 981
❌ ./services/token-dex-data-service.js doesn't use serviceManager.register
❌ ./services/token-refresh-scheduler.js doesn't use serviceManager.register
❌ ./services/achievementService.js doesn't use serviceManager.register
❌ ./services/admin-wallet/admin-wallet-service.js doesn't use serviceManager.register

## Checking for potential circular reference issues in error logging...
✅ ./services/pool-data-manager/helius-integration.js has no obvious circular references in error logging
✅ ./services/pool-data-manager/pool-data-manager.js has no obvious circular references in error logging
✅ ./services/pool-data-manager/index.js has no obvious circular references in error logging
✅ ./services/solana-engine/connection-manager.js has no obvious circular references in error logging
✅ ./services/solana-engine/dexscreener-client.js has no obvious circular references in error logging
✅ ./services/solana-engine/helius-balance-tracker.js has no obvious circular references in error logging
✅ ./services/solana-engine/solana-engine.js has no obvious circular references in error logging
✅ ./services/solana-engine/jupiter-client.js has no obvious circular references in error logging
✅ ./services/solana-engine/helius-client.js has no obvious circular references in error logging
✅ ./services/solana-engine/helius-pool-tracker.js has no obvious circular references in error logging
✅ ./services/solana-engine/index.js has no obvious circular references in error logging
❌ ./services/adminWalletService.js has potential circular reference in error logging:
130:                logApi.error('Failed to get Solana connection from SolanaServiceManager:', error);
725:            logApi.error('Error stopping Admin Wallet Service:', error);
900:            logApi.error('☠️ Admin wallet service operation failed:', error);
❌ ./services/market-data/marketDataAnalytics.js has potential circular reference in error logging:
118:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing price changes:${fancyColors.RESET}`, error);
207:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing volume changes:${fancyColors.RESET}`, error);
314:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error sorting tokens by relevance:${fancyColors.RESET}`, error);
✅ ./services/market-data/marketDataEnricher.js has no obvious circular references in error logging
❌ ./services/market-data/tokenDetectionService.js has potential circular reference in error logging:
121:            logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization failed:${fancyColors.RESET}`, error);
139:                logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error in check interval:${fancyColors.RESET}`, error);
161:                logApi.error(`${fancyColors.GOLD}[TokenDetectionSvc]${fancyColors.RESET} ${fancyColors.RED}Error in cleanup interval:${fancyColors.RESET}`, error);
   ... and 7 more instances
❌ ./services/market-data/tokenListDeltaTracker.js has potential circular reference in error logging:
150:      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error tracking token changes:${fancyColors.RESET}`, error);
175:      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error getting tracked tokens:${fancyColors.RESET}`, error);
219:      logApi.error(`${fancyColors.GOLD}[TokenListDeltaTracker]${fancyColors.RESET} ${fancyColors.RED}Error cleaning up old token sets:${fancyColors.RESET}`, error);
   ... and 1 more instances
❌ ./services/market-data/marketDataService.js has potential circular reference in error logging:
265:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
286:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking token sync status:${fancyColors.RESET}`, error);
312:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error checking for new tokens:${fancyColors.RESET}`, error);
   ... and 11 more instances
❌ ./services/market-data/marketDataBatchProcessor.js has potential circular reference in error logging:
205:                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Batch ${batchIndex + 1}/${totalBatches}: Error fetching metadata:${fancyColors.RESET}`, error.message);
227:                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Batch ${batchIndex + 1}/${totalBatches}: Error fetching prices:${fancyColors.RESET}`, error.message);
259:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing batch ${batchIndex + 1}/${totalBatches}:${fancyColors.RESET}`, error);
❌ ./services/market-data/marketDataRankTracker.js has potential circular reference in error logging:
314:                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing hot tokens:${fancyColors.RESET}`, error);
338:                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank risers:${fancyColors.RESET}`, error);
362:                logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error processing rank droppers:${fancyColors.RESET}`, error);
   ... and 1 more instances
❌ ./services/market-data/marketDataRepository.js has potential circular reference in error logging:
53:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting existing tokens:${fancyColors.RESET}`, error);
145:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting all tokens:${fancyColors.RESET}`, error);
225:            logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting token by symbol:${fancyColors.RESET}`, error);
   ... and 7 more instances
✅ ./services/market-data/index.js has no obvious circular references in error logging
✅ ./services/discord/discordConfig.js has no obvious circular references in error logging
❌ ./services/discord/discordNotificationService.js has potential circular reference in error logging:
192:      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send server startup notification:${fancyColors.RESET}`, error);
223:      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send server shutdown notification:${fancyColors.RESET}`, error);
721:      logApi.error(`${fancyColors.CYAN}[Discord]${fancyColors.RESET} ${fancyColors.RED}Failed to send contest activity notification:${fancyColors.RESET}`, error);
   ... and 7 more instances
❌ ./services/discord/discord-interactive-service.js has potential circular reference in error logging:
109:      logApi.error('Discord Interactive Bot initialization failed:', error);
161:        logApi.error('Error handling Discord interaction:', error);
308:      logApi.error('Failed to send contest started notification:', error);
   ... and 10 more instances
❌ ./services/userBalanceTrackingService.js has potential circular reference in error logging:
214:            logApi.error('Failed to initialize User Balance Tracking Service:', error);
1327:        logApi.error('Error verifying balance tracking schema:', error);
❌ ./services/tokenMonitorService.js has potential circular reference in error logging:
80:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
142:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error loading monitored tokens:${fancyColors.RESET}`, error);
211:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Error adding token to monitor:${fancyColors.RESET}`, error);
   ... and 8 more instances
✅ ./services/userProfileImageService.js has no obvious circular references in error logging
✅ ./services/liquidity-sim/modules/liquidation-simulator.js has no obvious circular references in error logging
✅ ./services/liquidity-sim/modules/volume-profiles.js has no obvious circular references in error logging
✅ ./services/liquidity-sim/modules/amm-math.js has no obvious circular references in error logging
❌ ./services/liquidity-sim/index.js has potential circular reference in error logging:
43:      logApi.error('[LiquiditySimService] Error initializing service:', error);
68:      logApi.error('[LiquiditySimService] Error during shutdown:', error);
171:      logApi.error('[LiquiditySimService] Error broadcasting simulation results:', error);
   ... and 2 more instances
✅ ./services/vanity-wallet/generators/local-generator.js has no obvious circular references in error logging
✅ ./services/vanity-wallet/generators/index.js has no obvious circular references in error logging
✅ ./services/vanity-wallet/vanity-api-client.js has no obvious circular references in error logging
✅ ./services/vanity-wallet/vanity-wallet-service.js has no obvious circular references in error logging
✅ ./services/vanity-wallet/index.js has no obvious circular references in error logging
✅ ./services/liquidityService.js has no obvious circular references in error logging
❌ ./services/referralService.js has potential circular reference in error logging:
377:                    logApi.error(`Failed to process referral ${referral.id}:`, error);
710:                logApi.error('Failed to update rankings:', error);
809:            logApi.error('Error stopping Referral Service:', error);
❌ ./services/token-enrichment/collectors/jupiterCollector.js has potential circular reference in error logging:
38:      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error initializing:${fancyColors.RESET}`, error);
77:      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token info:${fancyColors.RESET}`, error);
194:      logApi.error(`${fancyColors.GOLD}[JupiterCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching batch token info:${fancyColors.RESET}`, error);
   ... and 3 more instances
❌ ./services/token-enrichment/collectors/heliusCollector.js has potential circular reference in error logging:
58:      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching token metadata:${fancyColors.RESET}`, error);
168:      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error fetching batch token metadata:${fancyColors.RESET}`, error);
271:      logApi.error(`${fancyColors.GOLD}[HeliusCollector]${fancyColors.RESET} ${fancyColors.RED}Error in batch token metadata:${fancyColors.RESET}`, error);
   ... and 1 more instances
✅ ./services/token-enrichment/collectors/dexScreenerCollector.js has no obvious circular references in error logging
❌ ./services/token-enrichment/tokenEnrichmentService.js has potential circular reference in error logging:
747:      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error getting enrichment attempts:${fancyColors.RESET}`, error);
786:      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error incrementing enrichment attempts:${fancyColors.RESET}`, error);
936:      logApi.error(`${fancyColors.GOLD}[TokenEnrichmentSvc]${fancyColors.RESET} ${fancyColors.RED}Error collecting token data:${fancyColors.RESET}`, error);
   ... and 4 more instances
✅ ./services/token-enrichment/index.js has no obvious circular references in error logging
❌ ./services/token-refresh-integration.js has potential circular reference in error logging:
83:    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Initialization error:`, error);
102:      logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error handling token update event:`, error);
163:    logApi.error(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Error refreshing token:`, error);
   ... and 6 more instances
❌ ./services/solanaService.js has potential circular reference in error logging:
244:            logApi.error('Error processing Solana RPC request queue:', error);
416:            logApi.warn('Solana connection error detected, attempting reconnect...', error);
460:            logApi.error('Failed to reconnect to Solana:', error);
   ... and 2 more instances
❌ ./services/walletRakeService.js has potential circular reference in error logging:
187:            logApi.error('Wallet Rake Service initialization error:', error);
560:            logApi.error('Force rake operation failed:', error);
591:            logApi.error('Error stopping Wallet Rake Service:', error);
❌ ./services/levelingService.js has potential circular reference in error logging:
49:            logApi.error('Leveling Service initialization error:', error);
343:            logApi.error('Leveling service health check failed:', error);
✅ ./services/tokenWhitelistService.js has no obvious circular references in error logging
✅ ./services/ai-service/image-generator.js has no obvious circular references in error logging
❌ ./services/ai-service/utils/additional-functions.js has potential circular reference in error logging:
239:    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching token metrics history:`, error);
393:    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching platform activity:`, error);
443:    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching service status:`, error);
   ... and 4 more instances
❌ ./services/ai-service/utils/terminal-function-handler.js has potential circular reference in error logging:
311:    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error parsing function arguments:`, error);
397:    logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Function call error:`, error);
481:      logApi.error(`${fancyColors.MAGENTA}[AI Service]${fancyColors.RESET} Error fetching token website:`, error);
   ... and 4 more instances
❌ ./services/ai-service/utils/prompt-builder.js has potential circular reference in error logging:
81:    logApi.warn(`${fancyColors.MAGENTA}[${serviceName}]${fancyColors.RESET} Failed to enhance system prompt with user data:`, error);
✅ ./services/ai-service/models/loadout-config.js has no obvious circular references in error logging
❌ ./services/ai-service/ai-service.js has potential circular reference in error logging:
157:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
278:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Analysis operation failed:${fancyColors.RESET}`, error);
407:          logApi.warn(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} Failed to enhance prompt with user context; Falling back to default. Details:`, error);
   ... and 10 more instances
❌ ./services/ai-service/analyzers/admin-analyzer.js has potential circular reference in error logging:
171:    logApi.error(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} ${fancyColors.RED}Admin actions analysis failed:${fancyColors.RESET}`, error);
❌ ./services/ai-service/analyzers/error-analyzer.js has potential circular reference in error logging:
189:    logApi.error(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} ${fancyColors.RED}Client error analysis failed:${fancyColors.RESET}`, error);
❌ ./services/ai-service/analyzers/log-analyzer.js has potential circular reference in error logging:
115:    logApi.error(`${fancyColors.MAGENTA}[${aiService.name}]${fancyColors.RESET} ${fancyColors.RED}Error log analysis failed:${fancyColors.RESET}`, error);
428:    logApi.error(`${serviceSpecificColors.aiService.tag}[AISvc]${fancyColors.RESET} ${fancyColors.RED}Service log analysis failed for ${serviceKey}:${fancyColors.RESET}`, error);
✅ ./services/ai-service/index.js has no obvious circular references in error logging
❌ ./services/token-history-functions.js has potential circular reference in error logging:
62:        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording volume history:${fancyColors.RESET}`, error);
108:        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording liquidity history:${fancyColors.RESET}`, error);
155:        logApi.error(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.RED}Error batch recording market cap history:${fancyColors.RESET}`, error);
   ... and 2 more instances
❌ ./services/walletGenerationService.js has potential circular reference in error logging:
156:            logApi.error('Wallet Generator Service initialization error:', error);
493:            logApi.error('Error stopping Wallet Generator Service:', error);
534:            logApi.error('Error during wallet generator cleanup:', error);
❌ ./services/aiService.js has potential circular reference in error logging:
234:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
273:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Analysis operation failed:${fancyColors.RESET}`, error);
397:      logApi.error(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.RED}Client error analysis failed:${fancyColors.RESET}`, error);
   ... and 6 more instances
✅ ./services/token-dex-data-service.js has no obvious circular references in error logging
❌ ./services/token-refresh-scheduler.js has potential circular reference in error logging:
194:      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.RED}Initialization error:${fancyColors.RESET}`, error);
232:      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error loading configuration:`, error);
277:      logApi.error(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} Error loading priority tiers:`, error);
   ... and 4 more instances
✅ ./services/token-refresh-scheduler/rank-analyzer.js has no obvious circular references in error logging
✅ ./services/token-refresh-scheduler/metrics-collector.js has no obvious circular references in error logging
✅ ./services/token-refresh-scheduler/priority-queue.js has no obvious circular references in error logging
✅ ./services/token-refresh-scheduler/batch-optimizer.js has no obvious circular references in error logging
❌ ./services/achievementService.js has potential circular reference in error logging:
195:            logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Achievement Service initialization error:${fancyColors.RESET}`, error);
338:                    logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to process achievements for user ${user.id}:${fancyColors.RESET}`, error);
380:                    logApi.error(`${fancyColors.MAGENTA}[achievementService]${fancyColors.RESET} ${fancyColors.RED}Failed to check category ${category.id} for user ${user.id}:${fancyColors.RESET}`, error);
   ... and 1 more instances
✅ ./services/admin-wallet/modules/wallet-transactions.js has no obvious circular references in error logging
✅ ./services/admin-wallet/modules/wallet-crypto.js has no obvious circular references in error logging
✅ ./services/admin-wallet/modules/batch-operations.js has no obvious circular references in error logging
✅ ./services/admin-wallet/modules/wallet-balance.js has no obvious circular references in error logging
❌ ./services/admin-wallet/admin-wallet-service.js has potential circular reference in error logging:
501:            logApi.error('Error stopping Admin Wallet Service:', error);
579:            logApi.error('☠️ Admin wallet service operation failed:', error);
✅ ./services/admin-wallet/index.js has no obvious circular references in error logging

## Checking for unsafe nested property access...
⚠️ ./services/solana-engine/solana-engine.js may have unsafe nested property access:
13: * @version 1.0.0
80:      tokenData: config.websocket.topics.MARKET_DATA,
114:      const connectionManagerInitialized = await this.connectionManager.initialize();
   ... and 30 more instances
⚠️ ./services/solana-engine/jupiter-client.js may have unsafe nested property access:
8: * @version 1.9.0
65:        headers: this.config.getHeaders(),
108:      const response = await this.makeRequest('GET', this.config.endpoints.tokens.getTokens);
   ... and 67 more instances
⚠️ ./services/adminWalletService.js may have unsafe nested property access:
141:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Admin Wallet Service is disabled in the '${config.services.active_profile}' service profile`);
152:            const settings = await prisma.system_settings.findUnique({
163:                    ...this.config,
   ... and 88 more instances
⚠️ ./services/market-data/tokenDetectionService.js may have unsafe nested property access:
13: * @version 1.9.0
109:            serviceEvents.on('token:new', this.handleNewToken.bind(this));
177:            const tokenList = this.jupiterClient.tokenList;
   ... and 17 more instances
⚠️ ./services/market-data/marketDataService.js may have unsafe nested property access:
1:// services/marketDataService.js.slim
70:    datasourceUrl: process.env.DATABASE_URL
185:                logApi.warn(`${fancyColors.GOLD}[MktDataSvc]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Market Data Service is disabled in the '${config.services.active_profile}' service profile`);
   ... and 49 more instances
⚠️ ./services/discord/discordNotificationService.js may have unsafe nested property access:
22: * @version 1.9.0
94:      const serviceConfig = await prisma.service_configuration.findUnique({
129:    this.events.on(SERVICE_EVENTS.CONTEST_CREATED, this.onContestCreated.bind(this));
   ... and 60 more instances
⚠️ ./services/discord/discord-interactive-service.js may have unsafe nested property access:
20: * @version 1.9.0
63:      contests: config.discord.channel_ids.contests,
64:      trades: config.discord.channel_ids.trades,
   ... and 62 more instances
⚠️ ./services/userBalanceTrackingService.js may have unsafe nested property access:
28:const USER_BALANCE_TRACKING_MODE = FORCE_WEBSOCKET_MODE ? 'websocket' : config.service_thresholds.user_balance_tracking_mode; // 'polling' or 'websocket'
29:const USER_BALANCE_TRACKING_DYNAMIC_TARGET_RPC_CALLS_PER_DAY = config.service_thresholds.user_balance_tracking_dynamic_target_rpc_calls_per_day; // dynamic target RPC calls per day (specific to user balance tracking service)
30:const USER_BALANCE_TRACKING_CHECK_INTERVAL = config.service_intervals.user_balance_tracking_check_interval; // cycle interval (minutes)
   ... and 108 more instances
⚠️ ./services/tokenMonitorService.js may have unsafe nested property access:
47:        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Monitor Service is disabled in the '${config.services.active_profile}' service profile`);
73:        jupiterClient.onPriceUpdate(this.handlePriceUpdate.bind(this));
77:      logApi.info(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.GREEN}Token Monitor Service initialized with ${this.monitoredTokens.size} tokens${fancyColors.RESET}`);
   ... and 19 more instances
⚠️ ./services/vanity-wallet/vanity-wallet-service.js may have unsafe nested property access:
106:        this.targetCounts = config.vanityWallet.targetCounts;
110:        this.intervalMs = 1000 * 60 * config.vanityWallet.checkIntervalMinutes;
112:        this.config.checkIntervalMs = this.intervalMs;
   ... and 56 more instances
⚠️ ./services/liquidityService.js may have unsafe nested property access:
39:        masterWallet: config.master_wallet.address
49:        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
105:                this.config.checkIntervalMs // Default from static config
   ... and 49 more instances
⚠️ ./services/referralService.js may have unsafe nested property access:
118:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Referral Service is disabled in the '${config.services.active_profile}' service profile`);
130:                this.referralStats.dependencies.contestEvaluation = {
138:            const settings = await prisma.system_settings.findUnique({
   ... and 72 more instances
⚠️ ./services/token-enrichment/tokenEnrichmentService.js may have unsafe nested property access:
12: * @version 1.9.0
235:        await this.enqueueTokenEnrichment(tokenInfo.address, CONFIG.PRIORITY_TIERS.HIGH);
257:      const existingToken = await this.db.tokens.findFirst({
   ... and 96 more instances
⚠️ ./services/token-refresh-integration.js may have unsafe nested property access:
9: * @version 1.9.0
62:      logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Refresh Scheduler is disabled in the '${config.services.active_profile}' service profile`);
96:        logApi.info(`${fancyColors.GOLD}[TokenRefreshIntegration]${fancyColors.RESET} Received token update event for ${data.updatedTokens.length} tokens`);
   ... and 6 more instances
⚠️ ./services/solanaService.js may have unsafe nested property access:
16: * @version 0.6.9
72:            maxConcurrentRequests: SOLANA_SERVICE_CONFIG.rpcLimiter.maxConcurrentRequests,
89:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Solana Service is disabled in the '${config.services.active_profile}' service profile`);
   ... and 70 more instances
⚠️ ./services/walletRakeService.js may have unsafe nested property access:
46:        min_balance_sol: config.master_wallet.min_contest_wallet_balance,
47:        master_wallet: config.master_wallet.address,
64:        this.connection = new Connection(config.rpc_urls.primary, "confirmed");
   ... and 69 more instances
⚠️ ./services/levelingService.js may have unsafe nested property access:
41:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Leveling Service is disabled in the '${config.services.active_profile}' service profile`);
84:                const user = await tx.users.findUnique({
99:                const nextLevel = await tx.user_levels.findFirst({
   ... and 10 more instances
⚠️ ./services/tokenWhitelistService.js may have unsafe nested property access:
73:        this.umi = createUmi(config.rpc_urls.primary).use(mplTokenMetadata());
119:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Whitelist Service is disabled in the '${config.services.active_profile}' service profile`);
127:            const settings = await prisma.system_settings.findUnique({
   ... and 66 more instances
⚠️ ./services/ai-service/ai-service.js may have unsafe nested property access:
16: * @version 1.9.0
128:        apiKey: config.api_keys.openai
134:        const cleanupResult = await logApi.serviceLog.cleanup(14);
   ... and 82 more instances
⚠️ ./services/walletGenerationService.js may have unsafe nested property access:
88:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Wallet Generator Service is disabled in the '${config.services.active_profile}' service profile`);
99:            const settings = await prisma.system_settings.findUnique({
110:                    ...this.config,
   ... and 61 more instances
⚠️ ./services/aiService.js may have unsafe nested property access:
16: * @version 1.8.9
214:        logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} AI Service is disabled in the '${config.services.active_profile}' service profile`);
228:        apiKey: config.api_keys.openai
   ... and 60 more instances
⚠️ ./services/token-dex-data-service.js may have unsafe nested property access:
84:        logApi.warn(`${formatLog.tag()} ${formatLog.warning('SERVICE DISABLED')} Token DEX Data Service is disabled in the '${config.services.active_profile}' service profile`);
96:      serviceEvents.on('token.refresh', this.handleTokenRefreshEvent.bind(this));
97:      serviceEvents.on('token.batch.refresh', this.handleBatchRefreshEvent.bind(this));
   ... and 61 more instances
⚠️ ./services/token-refresh-scheduler.js may have unsafe nested property access:
17: * @version 1.9.0
162:        logApi.warn(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Token Refresh Scheduler is disabled in the '${config.services.active_profile}' service profile`);
189:      logApi.info(`${fancyColors.GOLD}[TokenRefreshSched]${fancyColors.RESET} ${fancyColors.BG_GREEN}${fancyColors.BLACK} INITIALIZED ${fancyColors.RESET} Token Refresh Scheduler ready with ${this.activeTokens.size} active tokens`);
   ... and 48 more instances
⚠️ ./services/achievementService.js may have unsafe nested property access:
104:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Achievement Service is disabled in the '${config.services.active_profile}' service profile`);
118:            const settings = await prisma.system_settings.findUnique({
129:                    ...this.config,
   ... and 62 more instances
⚠️ ./services/admin-wallet/admin-wallet-service.js may have unsafe nested property access:
137:                logApi.warn(`${fancyColors.MAGENTA}[${this.name}]${fancyColors.RESET} ${fancyColors.BG_YELLOW}${fancyColors.BLACK} SERVICE DISABLED ${fancyColors.RESET} Admin Wallet Service is disabled in the '${config.services.active_profile}' service profile`);
167:            this.walletStats.dependencies.SOLANA_ENGINE.status = 'available';
168:            this.walletStats.dependencies.SOLANA_ENGINE.lastCheck = new Date();
   ... and 50 more instances

## Checking for proper async/await usage in error handling...
✅ ./services/solana-engine/solana-engine.js appears to use proper async/await patterns
✅ ./services/solana-engine/jupiter-client.js appears to use proper async/await patterns
✅ ./services/adminWalletService.js appears to use proper async/await patterns
✅ ./services/market-data/tokenDetectionService.js appears to use proper async/await patterns
⚠️ ./services/market-data/marketDataService.js may have missing await in promise handling:
569:            .then(success => {
601:            .catch(err => {
✅ ./services/discord/discordNotificationService.js appears to use proper async/await patterns
✅ ./services/discord/discord-interactive-service.js appears to use proper async/await patterns
✅ ./services/userBalanceTrackingService.js appears to use proper async/await patterns
✅ ./services/tokenMonitorService.js appears to use proper async/await patterns
✅ ./services/vanity-wallet/vanity-wallet-service.js appears to use proper async/await patterns
⚠️ ./services/liquidityService.js may have missing await in promise handling:
119:                        () => this.performOperation().catch(error => this.handleError(error)),
✅ ./services/referralService.js appears to use proper async/await patterns
✅ ./services/token-enrichment/tokenEnrichmentService.js appears to use proper async/await patterns
✅ ./services/token-refresh-integration.js appears to use proper async/await patterns
✅ ./services/solanaService.js appears to use proper async/await patterns
✅ ./services/walletRakeService.js appears to use proper async/await patterns
✅ ./services/levelingService.js appears to use proper async/await patterns
✅ ./services/tokenWhitelistService.js appears to use proper async/await patterns
✅ ./services/ai-service/ai-service.js appears to use proper async/await patterns
✅ ./services/walletGenerationService.js appears to use proper async/await patterns
✅ ./services/aiService.js appears to use proper async/await patterns
✅ ./services/token-dex-data-service.js appears to use proper async/await patterns
✅ ./services/token-refresh-scheduler.js appears to use proper async/await patterns
✅ ./services/achievementService.js appears to use proper async/await patterns
✅ ./services/admin-wallet/admin-wallet-service.js appears to use proper async/await patterns

## Checking for potential circular dependency imports...
❌ Potential circular import detected:
  ./services/vanity-wallet/vanity-api-client.js imports index.js
  ./services/vanity-wallet/index.js imports vanity-api-client.js
❌ Potential circular import detected:
  ./services/vanity-wallet/vanity-wallet-service.js imports index.js
  ./services/vanity-wallet/index.js imports vanity-wallet-service.js
❌ Potential circular import detected:
  ./services/vanity-wallet/index.js imports vanity-api-client.js
  ./services/vanity-wallet/vanity-api-client.js imports index.js
❌ Potential circular import detected:
  ./services/vanity-wallet/index.js imports vanity-wallet-service.js
  ./services/vanity-wallet/vanity-wallet-service.js imports index.js
❌ Potential circular import detected:
  ./services/admin-wallet/modules/wallet-transactions.js imports index.js
  ./services/admin-wallet/index.js imports wallet-transactions.js
❌ Potential circular import detected:
  ./services/admin-wallet/admin-wallet-service.js imports index.js
  ./services/admin-wallet/index.js imports admin-wallet-service.js
❌ Potential circular import detected:
  ./services/admin-wallet/index.js imports wallet-transactions.js
  ./services/admin-wallet/modules/wallet-transactions.js imports index.js
❌ Potential circular import detected:
  ./services/admin-wallet/index.js imports admin-wallet-service.js
  ./services/admin-wallet/admin-wallet-service.js imports index.js

# Audit Complete

To view this report as Markdown, run: `./service-audit.sh --markdown > service-audit-results.md`
