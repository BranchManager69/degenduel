/**
 * AMM Math Module for LiquiditySim
 * 
 * This module provides mathematical functions for working with Automated Market Maker (AMM)
 * liquidity pools, focusing on calculations related to price impact, token swaps,
 * and other key metrics for constant product pools (x*y=k).
 */

/**
 * Calculate the maximum number of tokens that can be sold to achieve a specified price impact
 * 
 * @param {number} maxPriceImpactPct - The maximum price impact as a percentage (negative for sell impact)
 * @param {number} poolBaseReserve - The base token reserve in the pool
 * @param {number} poolQuoteReserve - The quote token reserve in the pool
 * @param {boolean} exact - Whether to use the exact calculation (true) or approximation (false)
 * @returns {number} The maximum number of tokens that can be sold
 */
function getMaxTokensForPriceImpact(maxPriceImpactPct, poolBaseReserve, poolQuoteReserve, exact = false) {
  // Current price
  const currentPrice = poolQuoteReserve / poolBaseReserve;
  
  // For sell orders, price impact is negative (price goes down)
  // Handle case where a positive number was passed in
  const pctImpact = maxPriceImpactPct < 0 ? maxPriceImpactPct : -Math.abs(maxPriceImpactPct);
  
  // Target price after impact
  const targetPrice = currentPrice * (1 + pctImpact/100);
  
  // Constant product k
  const k = poolBaseReserve * poolQuoteReserve;
  
  if (!exact) {
    // APPROXIMATION method (faster, good for up to ~20% price impact)
    // For price drop of p%, use formula: poolBaseReserve * (p / (100 - p))
    const absPriceImpact = Math.abs(pctImpact);
    return poolBaseReserve * (absPriceImpact / (100 - absPriceImpact));
  } else {
    // EXACT calculation (solves the quadratic equation)
    // For constant product AMM (x*y=k), if we add Δx tokens to sell:
    // (x + Δx) * (y - Δy) = k, where k = x * y
    // And the new price is: (y - Δy) / (x + Δx) = targetPrice
    
    // This gives us: (x + Δx) * targetPrice = (y - Δy)
    // Substituting Δy = y - (k / (x + Δx)):
    // (x + Δx) * targetPrice = y - (y - (k / (x + Δx)))
    // (x + Δx) * targetPrice = k / (x + Δx)
    // (x + Δx)² * targetPrice = k
    // (x + Δx)² = k / targetPrice
    // x + Δx = √(k / targetPrice)
    // Δx = √(k / targetPrice) - x
    
    const tokensToSell = Math.sqrt(k / targetPrice) - poolBaseReserve;
    return Math.max(0, tokensToSell); // Ensure non-negative
  }
}

/**
 * Calculate the price impact of selling a specific amount of tokens
 * 
 * @param {number} tokenAmount - The amount of tokens to sell
 * @param {number} poolBaseReserve - The base token reserve in the pool
 * @param {number} poolQuoteReserve - The quote token reserve in the pool
 * @returns {number} The price impact as a percentage (negative for sell impact)
 */
function calculatePriceImpact(tokenAmount, poolBaseReserve, poolQuoteReserve) {
  // Current price
  const currentPrice = poolQuoteReserve / poolBaseReserve;
  
  // Constant product k
  const k = poolBaseReserve * poolQuoteReserve;
  
  // New base reserve after selling tokens
  const newBaseReserve = poolBaseReserve + tokenAmount;
  
  // New quote reserve calculated from constant product
  const newQuoteReserve = k / newBaseReserve;
  
  // New price after selling tokens
  const newPrice = newQuoteReserve / newBaseReserve;
  
  // Calculate price impact as a percentage
  const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;
  
  return priceImpact;
}

/**
 * Calculate the amount of quote tokens received when selling base tokens
 * 
 * @param {number} tokenAmount - The amount of base tokens to sell
 * @param {number} poolBaseReserve - The base token reserve in the pool
 * @param {number} poolQuoteReserve - The quote token reserve in the pool
 * @returns {Object} Object containing received amount and price impact
 */
function simulateSell(tokenAmount, poolBaseReserve, poolQuoteReserve) {
  // Constant product k
  const k = poolBaseReserve * poolQuoteReserve;
  
  // New base reserve after selling tokens
  const newBaseReserve = poolBaseReserve + tokenAmount;
  
  // New quote reserve calculated from constant product
  const newQuoteReserve = k / newBaseReserve;
  
  // Amount of quote tokens received
  const quoteReceived = poolQuoteReserve - newQuoteReserve;
  
  // Calculate price impact
  const priceImpact = calculatePriceImpact(tokenAmount, poolBaseReserve, poolQuoteReserve);
  
  return {
    baseAmount: tokenAmount,
    quoteReceived,
    newBaseReserve,
    newQuoteReserve,
    priceImpact
  };
}

/**
 * Calculate the amount of base tokens received when buying with quote tokens
 * 
 * @param {number} quoteAmount - The amount of quote tokens to spend
 * @param {number} poolBaseReserve - The base token reserve in the pool
 * @param {number} poolQuoteReserve - The quote token reserve in the pool
 * @returns {Object} Object containing received amount and price impact
 */
function simulateBuy(quoteAmount, poolBaseReserve, poolQuoteReserve) {
  // Constant product k
  const k = poolBaseReserve * poolQuoteReserve;
  
  // New quote reserve after buying tokens
  const newQuoteReserve = poolQuoteReserve + quoteAmount;
  
  // New base reserve calculated from constant product
  const newBaseReserve = k / newQuoteReserve;
  
  // Amount of base tokens received
  const baseReceived = poolBaseReserve - newBaseReserve;
  
  // Current price
  const currentPrice = poolQuoteReserve / poolBaseReserve;
  
  // New price after buying tokens
  const newPrice = newQuoteReserve / newBaseReserve;
  
  // Calculate price impact as a percentage (positive for buy)
  const priceImpact = ((newPrice - currentPrice) / currentPrice) * 100;
  
  return {
    quoteAmount,
    baseReceived,
    newBaseReserve,
    newQuoteReserve,
    priceImpact
  };
}

/**
 * Calculate the impermanent loss percentage for a given price change
 *
 * @param {number} priceRatio - The ratio of new price to initial price
 * @returns {number} The impermanent loss as a percentage
 */
function calculateImpermanentLoss(priceRatio) {
  // Formula: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
  const impermanentLoss = (2 * Math.sqrt(priceRatio) / (1 + priceRatio)) - 1;
  return impermanentLoss * 100;
}

/**
 * Estimate the daily interest earned from providing liquidity based on trading volume
 *
 * @param {number} poolLiquidityUsd - Total pool liquidity in USD
 * @param {number} dailyVolumeUsd - Daily trading volume in USD
 * @param {number} feePercent - Pool fee percentage (e.g., 0.3 for 0.3%)
 * @returns {number} Daily interest rate as a percentage
 */
function estimateLiquidityProviderAPR(poolLiquidityUsd, dailyVolumeUsd, feePercent) {
  // Daily interest = (volume * fee%) / liquidity
  const dailyInterest = (dailyVolumeUsd * (feePercent / 100)) / poolLiquidityUsd;
  
  // Annualized (simple interest)
  const apr = dailyInterest * 365 * 100;
  
  return apr;
}

export default {
  getMaxTokensForPriceImpact,
  calculatePriceImpact,
  simulateSell,
  simulateBuy,
  calculateImpermanentLoss,
  estimateLiquidityProviderAPR
};