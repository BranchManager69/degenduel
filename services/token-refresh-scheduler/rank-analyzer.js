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
    // Guard clause for empty or invalid input
    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return {
        totalTokens: 0, activeInContests: 0, withPriceData: 0, withRankData: 0, withoutRefreshData: 0,
        avgRefreshInterval: 0, totalRefreshIntervals: 0, tiers: {}, refreshDistribution: {}
      };
    }

    const tiers = {
      tier1: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier2: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier3: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier4: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      tier5: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 },
      other: { count: 0, minRefresh: Infinity, maxRefresh: 0, avgRefresh: 0, totalRefresh: 0 }
    };
    
    const stats = {
      totalTokens: tokens.length,
      activeInContests: 0,
      withPriceData: 0,
      withRankData: 0,
      withoutRefreshData: 0,
      avgRefreshInterval: 0,
      totalRefreshIntervals: 0,
      tiers: tiers,
      refreshDistribution: {
        '15s_or_less': 0,
        '16s_to_30s': 0,
        '31s_to_60s': 0,
        '61s_to_5m': 0,
        'over_5m': 0
      }
    };
    
    for (const token of tokens) {
      if (!token) continue; // Skip if token object itself is null/undefined in the array

      if (token.contest_portfolios && Array.isArray(token.contest_portfolios) && token.contest_portfolios.length > 0) {
        stats.activeInContests++;
      }
      
      if (token.token_prices && token.token_prices.price !== null && token.token_prices.price !== undefined) {
        stats.withPriceData++;
      }
      
      const hasRankData = token.rank_history && Array.isArray(token.rank_history) && token.rank_history.length > 0 && token.rank_history[0].rank !== null && token.rank_history[0].rank !== undefined;
      if (hasRankData) {
        stats.withRankData++;
      }
      
      let tierName = 'other'; // Default to 'other'
      if (hasRankData) {
        const rank = token.rank_history[0].rank;
        if (rank <= 50) tierName = 'tier1';
        else if (rank <= 200) tierName = 'tier2';
        else if (rank <= 500) tierName = 'tier3';
        else if (rank <= 1000) tierName = 'tier4';
        else if (rank <= 3000) tierName = 'tier5';
        // else it remains 'other'
      }
      
      // Ensure the tier exists in the tiers object before trying to increment
      if (stats.tiers[tierName]) {
        stats.tiers[tierName].count++;
      } else { // Should not happen if tiers object is comprehensive
        stats.tiers.other.count++;
      }
      
      const currentTierStats = stats.tiers[tierName] || stats.tiers.other; // Fallback to other if tierName is somehow invalid
      const refreshInterval = token.refresh_interval_seconds;
      if (refreshInterval !== null && refreshInterval !== undefined && !isNaN(refreshInterval)) {
        currentTierStats.minRefresh = Math.min(currentTierStats.minRefresh, refreshInterval);
        currentTierStats.maxRefresh = Math.max(currentTierStats.maxRefresh, refreshInterval);
        currentTierStats.totalRefresh += refreshInterval;
        stats.totalRefreshIntervals += refreshInterval;
        
        if (refreshInterval <= 15) stats.refreshDistribution['15s_or_less']++;
        else if (refreshInterval <= 30) stats.refreshDistribution['16s_to_30s']++;
        else if (refreshInterval <= 60) stats.refreshDistribution['31s_to_60s']++;
        else if (refreshInterval <= 300) stats.refreshDistribution['61s_to_5m']++;
        else stats.refreshDistribution['over_5m']++;
      } else {
        stats.withoutRefreshData++;
      }
    }
    
    if (stats.totalTokens > 0 && stats.totalRefreshIntervals > 0) { // Avoid division by zero if no tokens had refresh data
      stats.avgRefreshInterval = stats.totalRefreshIntervals / (stats.totalTokens - stats.withoutRefreshData);
      if (isNaN(stats.avgRefreshInterval) || !isFinite(stats.avgRefreshInterval)) stats.avgRefreshInterval = 0; // Sanitize NaN/Infinity
    } else {
      stats.avgRefreshInterval = 0;
    }
    
    for (const tierKey in stats.tiers) {
      const tier = stats.tiers[tierKey];
      if (tier.count > 0 && tier.totalRefresh > 0) {
        tier.avgRefresh = tier.totalRefresh / tier.count;
        if (isNaN(tier.avgRefresh) || !isFinite(tier.avgRefresh)) tier.avgRefresh = 0;
      }
      if (tier.minRefresh === Infinity) {
        tier.minRefresh = 0;
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