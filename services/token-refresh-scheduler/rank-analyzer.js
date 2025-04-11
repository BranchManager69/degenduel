/**
 * Token Rank Analyzer
 * 
 * Analyzes token ranks, importance, and activity to provide insights
 * for optimized scheduling.
 */

export default class TokenRankAnalyzer {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Analyze token distribution to get insight on refresh needs
   * @param {Array} tokens - Array of tokens from database
   * @returns {Object} Token distribution statistics
   */
  analyzeTokenDistribution(tokens) {
    // Initialize tier counters
    const tiers = {
      tier1: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier2: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier3: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier4: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier5: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      other: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 }
    };
    
    // Initialize counters for different categories
    const stats = {
      totalTokens: tokens.length,
      activeInContests: 0,
      withPriceData: 0,
      withRankData: 0,
      withoutRefreshData: 0,
      avgRefreshInterval: 0,
      totalRefreshIntervals: 0,
      // Add token refresh distribution by tier
      tiers: tiers,
      // Distribution by refresh interval (buckets)
      refreshDistribution: {
        '15s_or_less': 0,
        '16s_to_30s': 0,
        '31s_to_60s': 0,
        '61s_to_5m': 0,
        'over_5m': 0
      }
    };
    
    // Analyze each token
    for (const token of tokens) {
      // Check contest activity
      if (token.contest_portfolios && token.contest_portfolios.length > 0) {
        stats.activeInContests++;
      }
      
      // Check price data
      if (token.token_prices && token.token_prices.price) {
        stats.withPriceData++;
      }
      
      // Check rank data
      const hasRankData = token.rank_history && token.rank_history.length > 0;
      if (hasRankData) {
        stats.withRankData++;
      }
      
      // Determine token tier based on rank
      let tier;
      if (hasRankData) {
        const rank = token.rank_history[0].rank;
        if (rank <= 50) tier = 'tier1';
        else if (rank <= 200) tier = 'tier2';
        else if (rank <= 500) tier = 'tier3';
        else if (rank <= 1000) tier = 'tier4';
        else if (rank <= 3000) tier = 'tier5';
        else tier = 'other';
      } else {
        tier = 'other';
      }
      
      // Increment tier counter
      tiers[tier].count++;
      
      // Check refresh interval data
      const refreshInterval = token.refresh_interval_seconds;
      if (refreshInterval) {
        // Update tier stats
        tiers[tier].minRefresh = Math.min(tiers[tier].minRefresh, refreshInterval);
        tiers[tier].maxRefresh = Math.max(tiers[tier].maxRefresh, refreshInterval);
        tiers[tier].totalRefresh += refreshInterval;
        
        // Update overall stats
        stats.totalRefreshIntervals += refreshInterval;
        
        // Increment refresh distribution counters
        if (refreshInterval <= 15) stats.refreshDistribution['15s_or_less']++;
        else if (refreshInterval <= 30) stats.refreshDistribution['16s_to_30s']++;
        else if (refreshInterval <= 60) stats.refreshDistribution['31s_to_60s']++;
        else if (refreshInterval <= 300) stats.refreshDistribution['61s_to_5m']++;
        else stats.refreshDistribution['over_5m']++;
      } else {
        stats.withoutRefreshData++;
      }
    }
    
    // Calculate averages
    if (tokens.length > 0) {
      stats.avgRefreshInterval = stats.totalRefreshIntervals / tokens.length;
      
      // Calculate tier averages
      for (const tier in tiers) {
        if (tiers[tier].count > 0) {
          tiers[tier].avgRefresh = tiers[tier].totalRefresh / tiers[tier].count;
        }
        // Set min to 0 if no tokens in tier
        if (tiers[tier].minRefresh === Infinity) {
          tiers[tier].minRefresh = 0;
        }
      }
    }
    
    return stats;
  }

  /**
   * Get recommended token refresh intervals based on analysis
   * @param {Array} tokens - Array of tokens from database
   * @returns {Object} Recommendations for token refresh intervals
   */
  getRefreshRecommendations(tokens) {
    // Get distribution
    const distribution = this.analyzeTokenDistribution(tokens);
    
    // Calculate API call requirements
    const calculateApiCallsPerMinute = (tokens, distribution) => {
      let totalCallsPerMinute = 0;
      
      // Estimate based on refresh distribution
      totalCallsPerMinute += (distribution.refreshDistribution['15s_or_less'] / 15) * 60;
      totalCallsPerMinute += (distribution.refreshDistribution['16s_to_30s'] / 30) * 60;
      totalCallsPerMinute += (distribution.refreshDistribution['31s_to_60s'] / 60) * 60;
      totalCallsPerMinute += (distribution.refreshDistribution['61s_to_5m'] / 300) * 60;
      totalCallsPerMinute += (distribution.refreshDistribution['over_5m'] / 600) * 60;
      
      // Adjust for batch size
      const batchSize = this.config.maxTokensPerBatch || 50;
      return Math.ceil(totalCallsPerMinute / batchSize);
    };
    
    const apiCallsPerMinute = calculateApiCallsPerMinute(tokens, distribution);
    
    // Generate recommendations
    return {
      apiCallsPerMinute,
      apiCallsPerSecond: apiCallsPerMinute / 60,
      totalActiveTokens: distribution.totalTokens,
      contestTokens: distribution.activeInContests,
      recommendedBatchSize: this.config.maxTokensPerBatch || 50,
      recommendations: {
        tier1: { 
          count: distribution.tiers.tier1.count, 
          recommendedInterval: 15, 
          adjustedInterval: Math.max(15, Math.min(30, 15 * (apiCallsPerMinute > 90 ? 2 : 1)))
        },
        tier2: { 
          count: distribution.tiers.tier2.count, 
          recommendedInterval: 30, 
          adjustedInterval: Math.max(30, Math.min(60, 30 * (apiCallsPerMinute > 75 ? 1.5 : 1)))
        },
        tier3: { 
          count: distribution.tiers.tier3.count, 
          recommendedInterval: 60, 
          adjustedInterval: Math.max(60, Math.min(120, 60 * (apiCallsPerMinute > 60 ? 1.5 : 1)))
        },
        tier4: { 
          count: distribution.tiers.tier4.count, 
          recommendedInterval: 180, 
          adjustedInterval: Math.max(180, Math.min(300, 180 * (apiCallsPerMinute > 45 ? 1.5 : 1)))
        },
        tier5: { 
          count: distribution.tiers.tier5.count, 
          recommendedInterval: 300, 
          adjustedInterval: Math.max(300, Math.min(600, 300 * (apiCallsPerMinute > 30 ? 1.5 : 1)))
        }
      }
    };
  }
}