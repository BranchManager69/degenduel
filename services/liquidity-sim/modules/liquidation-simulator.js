/**
 * Liquidation Simulator Module for LiquiditySim
 * 
 * This module provides functions to simulate token liquidation strategies
 * under different market conditions, accounting for position constraints,
 * price impact, and volume-based selling limits.
 */

import ammMath from './amm-math.js';
import volumeProfiles from './volume-profiles.js';

/**
 * Default price impact constraints (how they change over time)
 */
const DEFAULT_PRICE_IMPACT_CONSTRAINTS = {
  initialLimit: -5.0,    // Initial max price impact (-5%)
  finalLimit: -1.0,      // Final max price impact (-1%)
  adjustmentDays: 21,    // Takes 3 weeks to reach final impact
  bearMarketFactor: 1.5  // Allow 50% more impact in bear markets
};

/**
 * Default selling strategy percentages
 */
const DEFAULT_SELLING_STRATEGIES = {
  conservative: 1.0,   // 1% of daily volume
  moderate: 2.5,       // 2.5% of daily volume
  aggressive: 5.0      // 5% of daily volume
};

/**
 * Acquisition level percentages
 */
const ACQUISITION_LEVELS = {
  low: 50,       // 50% of supply
  medium: 60,    // 60% of supply
  high: 70       // 70% of supply
};

/**
 * Calculate the token position based on acquisition level and personal ratio
 * 
 * @param {number} totalSupply - Total token supply
 * @param {string} acquisitionLevel - Acquisition level (low/medium/high)
 * @param {number} personalRatio - Personal allocation as fraction of acquired tokens (0-1)
 * @returns {Object} Object with organization position and personal position
 */
function calculatePosition(totalSupply, acquisitionLevel = 'medium', personalRatio = 0.5) {
  const levelPct = ACQUISITION_LEVELS[acquisitionLevel.toLowerCase()] || ACQUISITION_LEVELS.medium;
  const orgTokens = totalSupply * (levelPct / 100);
  const personalTokens = orgTokens * personalRatio;
  
  return {
    organization: {
      tokens: orgTokens,
      percentage: levelPct
    },
    personal: {
      tokens: personalTokens,
      percentage: levelPct * personalRatio
    }
  };
}

/**
 * Run a liquidation simulation for a given scenario
 * 
 * @param {Object} params - Simulation parameters
 * @returns {Object} Simulation results
 */
function runSimulation(params) {
  const {
    // Token and pool parameters
    totalSupply,
    currentPrice,
    baseReserve,
    quoteReserve,
    
    // Position parameters
    acquisitionLevel = 'medium',
    personalRatio = 0.5,
    
    // Simulation parameters
    days = 180,
    scenarioType = 'baseCase',
    customVolumeProfile = null,
    
    // Constraints
    priceImpactConstraints = DEFAULT_PRICE_IMPACT_CONSTRAINTS,
    sellingStrategies = DEFAULT_SELLING_STRATEGIES,
    
    // Options
    calculateExact = false,
    includeDailyDetails = false
  } = params;
  
  // Calculate initial position
  const position = calculatePosition(totalSupply, acquisitionLevel, personalRatio);
  
  // Generate volume profile
  let volumeData;
  if (customVolumeProfile) {
    volumeData = customVolumeProfile;
  } else if (volumeProfiles.volumePresets[scenarioType]) {
    volumeData = volumeProfiles.volumePresets[scenarioType].generator(days);
  } else {
    // Default to base case if scenario type not found
    volumeData = volumeProfiles.volumePresets.baseCase.generator(days);
  }
  
  const { volumes, priceFactors } = volumeData;
  const isPriceDeclineScenario = Array.isArray(priceFactors);
  
  // Initialize strategies
  const strategies = ['conservative', 'moderate', 'aggressive'];
  
  // Initialize results data structure
  const results = {
    inputParams: { ...params },
    position,
    simulationSummary: {},
    strategies: {}
  };
  
  // Initialize daily data if requested
  if (includeDailyDetails) {
    results.dailyData = {
      volumes,
      priceFactors: priceFactors || Array(days).fill(1),
      strategies: {}
    };
    
    strategies.forEach(strategy => {
      results.dailyData.strategies[strategy] = {
        tokensSold: [],
        tokensRemaining: [],
        valueRealized: [],
        priceImpact: []
      };
    });
  }
  
  // For each strategy, simulate day by day
  strategies.forEach(strategy => {
    // Get strategy percentage of daily volume
    const strategyPct = sellingStrategies[strategy];
    
    // Track tokens remaining
    let tokensRemaining = position.personal.tokens;
    
    // Arrays to track daily data
    const dailyTokensSold = [];
    const dailyValueRealized = [];
    const dailyPriceImpact = [];
    const dailyTokensRemaining = [];
    
    // Track cumulative data
    let cumulativeTokensSold = 0;
    let cumulativeValueRealized = 0;
    
    // Track days to reach key liquidation milestones
    let daysToHalf = null;
    let daysToFull = null;
    
    // Simulate day by day
    for (let day = 0; day < days; day++) {
      // Get daily volume
      const dailyVolume = volumes[day];
      
      // Apply price factor if scenario has price decline
      const currentDayPrice = isPriceDeclineScenario 
        ? currentPrice * priceFactors[day]
        : currentPrice;
      
      // Calculate volume in tokens
      const volumeInTokens = dailyVolume / currentDayPrice;
      
      // Calculate volume-based amount for this strategy
      const volumeBasedAmount = volumeInTokens * (strategyPct / 100);
      
      // Calculate max price impact for this day (linearly decreases)
      let maxPriceImpact;
      if (day < priceImpactConstraints.adjustmentDays) {
        // Linear interpolation from initial to final impact
        maxPriceImpact = priceImpactConstraints.initialLimit + 
          (priceImpactConstraints.finalLimit - priceImpactConstraints.initialLimit) * 
          (day / priceImpactConstraints.adjustmentDays);
      } else {
        maxPriceImpact = priceImpactConstraints.finalLimit;
      }
      
      // In bear market, more aggressive impact limits may be needed
      if (isPriceDeclineScenario) {
        maxPriceImpact = maxPriceImpact * priceImpactConstraints.bearMarketFactor;
      }
      
      // Calculate max tokens that can be sold with the current price impact limit
      const maxTokensForImpact = ammMath.getMaxTokensForPriceImpact(
        maxPriceImpact, 
        baseReserve, 
        quoteReserve,
        calculateExact
      );
      
      // Apply constraints: min of (volume-based amount, remaining tokens, price impact limit)
      const tokensToSell = Math.min(
        volumeBasedAmount,
        tokensRemaining,
        maxTokensForImpact
      );
      
      // Calculate price impact of this sale
      const priceImpact = ammMath.calculatePriceImpact(
        tokensToSell,
        baseReserve,
        quoteReserve
      );
      
      // Calculate value realized
      const valueRealized = tokensToSell * currentDayPrice;
      
      // Update tokens remaining
      tokensRemaining -= tokensToSell;
      
      // Update cumulative data
      cumulativeTokensSold += tokensToSell;
      cumulativeValueRealized += valueRealized;
      
      // Store daily data
      dailyTokensSold.push(tokensToSell);
      dailyValueRealized.push(valueRealized);
      dailyPriceImpact.push(priceImpact);
      dailyTokensRemaining.push(tokensRemaining);
      
      // Track days to reach half position (if not already found)
      if (daysToHalf === null && cumulativeTokensSold >= position.personal.tokens * 0.5) {
        daysToHalf = day + 1;
      }
      
      // Track days to reach full position (if not already found)
      if (daysToFull === null && tokensRemaining <= 0) {
        daysToFull = day + 1;
        break; // Stop simulation once all tokens are sold
      }
    }
    
    // Store strategy results
    results.strategies[strategy] = {
      tokensAtStart: position.personal.tokens,
      tokensSold: cumulativeTokensSold,
      tokensRemaining,
      totalValueRealized: cumulativeValueRealized,
      percentLiquidated: (cumulativeTokensSold / position.personal.tokens) * 100,
      daysToHalf: daysToHalf || 'N/A',
      daysToFull: daysToFull || 'N/A',
      averageDailyTokens: cumulativeTokensSold / days,
      averageDailyValue: cumulativeValueRealized / days
    };
    
    // Include daily details if requested
    if (includeDailyDetails) {
      results.dailyData.strategies[strategy] = {
        tokensSold: dailyTokensSold,
        tokensRemaining: dailyTokensRemaining,
        valueRealized: dailyValueRealized,
        priceImpact: dailyPriceImpact
      };
    }
  });
  
  // Add overall simulation summary
  results.simulationSummary = {
    scenario: scenarioType,
    days,
    avgPrice: isPriceDeclineScenario 
      ? currentPrice * (priceFactors.reduce((sum, factor) => sum + factor, 0) / priceFactors.length)
      : currentPrice,
    avgVolume: volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length,
    isPriceDecline: isPriceDeclineScenario,
    bestStrategy: determineBestStrategy(results.strategies, isPriceDeclineScenario)
  };
  
  return results;
}

/**
 * Determine the best strategy based on simulation results
 * 
 * @param {Object} strategies - Strategy results
 * @param {boolean} isPriceDecline - Whether price is declining in the scenario
 * @returns {string} Name of the best strategy
 */
function determineBestStrategy(strategies, isPriceDecline) {
  // In price decline, prioritize quick realization
  if (isPriceDecline) {
    // Sort by total value realized (descending)
    const sorted = Object.entries(strategies).sort((a, b) => 
      b[1].totalValueRealized - a[1].totalValueRealized
    );
    return sorted[0][0]; // Return name of the strategy with highest value realized
  } 
  
  // In stable or growth scenarios, balance value and time
  else {
    // Create a score for each strategy (higher is better)
    const scores = {};
    
    Object.entries(strategies).forEach(([name, data]) => {
      // Weight factors: value (70%), days to half (30%)
      const valueScore = data.totalValueRealized / 1000000; // Normalize to millions
      const timeScore = data.daysToHalf === 'N/A' ? 0 : (365 - data.daysToHalf) / 10; // Higher score for quicker half-liquidation
      
      scores[name] = (valueScore * 0.7) + (timeScore * 0.3);
    });
    
    // Return strategy with highest score
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  }
}

/**
 * Run a grid of simulations for different acquisition levels and scenarios
 * 
 * @param {Object} params - Base simulation parameters
 * @returns {Object} Grid of simulation results
 */
function runSimulationGrid(params) {
  const {
    totalSupply,
    currentPrice,
    baseReserve,
    quoteReserve,
    
    // Grid specific parameters
    personalRatio = 0.5,
    acquisitionLevels = Object.keys(ACQUISITION_LEVELS),
    scenarios = Object.keys(volumeProfiles.volumePresets),
    
    // Other parameters
    days = 180,
    calculateExact = false
  } = params;
  
  const grid = {
    inputParams: { ...params },
    results: {}
  };
  
  // Run simulations for each acquisition level
  acquisitionLevels.forEach(level => {
    grid.results[level] = {};
    
    // Run simulations for each scenario
    scenarios.forEach(scenario => {
      const simulationParams = {
        totalSupply,
        currentPrice,
        baseReserve,
        quoteReserve,
        days,
        acquisitionLevel: level,
        personalRatio,
        scenarioType: scenario,
        calculateExact,
        includeDailyDetails: false // For grid simulations, omit daily details for brevity
      };
      
      grid.results[level][scenario] = runSimulation(simulationParams);
    });
  });
  
  return grid;
}

export default {
  runSimulation,
  runSimulationGrid,
  calculatePosition,
  DEFAULT_PRICE_IMPACT_CONSTRAINTS,
  DEFAULT_SELLING_STRATEGIES,
  ACQUISITION_LEVELS
};