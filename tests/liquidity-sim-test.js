/**
 * LiquiditySim Service Test
 * 
 * This script tests the LiquiditySim service to ensure it's working correctly.
 */

import liquiditySimService from '../services/liquidity-sim/index.js';
import { logApi } from '../utils/logger-suite/logger.js';

// Test data for a token
const testData = {
  totalSupply: 1000000000,
  currentPrice: 0.05,
  baseReserve: 15000000,
  quoteReserve: 5000,
  acquisitionLevel: 'medium',
  personalRatio: 0.5,
  days: 180,
  scenarioType: 'baseCase',
  calculateExact: true,
  includeDailyDetails: true
};

async function runTests() {
  logApi.info('[LiquiditySim Test] Starting tests...');
  
  try {
    // Initialize the service
    await liquiditySimService.initialize();
    logApi.info('[LiquiditySim Test] Service initialized successfully');
    
    // Test AMM Math functions
    const maxTokens = liquiditySimService.getMaxTokensForPriceImpact(
      -5,
      testData.baseReserve,
      testData.quoteReserve,
      false // use approximation
    );
    logApi.info(`[LiquiditySim Test] Max tokens for -5% price impact (approximation): ${maxTokens.toLocaleString()}`);
    
    const maxTokensExact = liquiditySimService.getMaxTokensForPriceImpact(
      -5,
      testData.baseReserve,
      testData.quoteReserve,
      true // use exact calculation
    );
    logApi.info(`[LiquiditySim Test] Max tokens for -5% price impact (exact): ${maxTokensExact.toLocaleString()}`);
    
    // Test sell simulation
    const sellResult = liquiditySimService.simulateSell(
      1000000,
      testData.baseReserve,
      testData.quoteReserve
    );
    logApi.info(`[LiquiditySim Test] Simulated sell of 1,000,000 tokens:`);
    logApi.info(`• Received: ${sellResult.quoteReceived.toLocaleString()} SOL`);
    logApi.info(`• USD Value: $${(sellResult.quoteReceived * (testData.quoteReserve * testData.currentPrice / testData.baseReserve)).toLocaleString()}`);
    logApi.info(`• Price Impact: ${sellResult.priceImpact.toFixed(2)}%`);
    
    // Test volume presets
    const presets = liquiditySimService.getVolumePresets();
    logApi.info(`[LiquiditySim Test] Available volume presets: ${Object.keys(presets).join(', ')}`);
    
    // Test full simulation
    logApi.info('[LiquiditySim Test] Running full simulation...');
    const results = liquiditySimService.runSimulation(testData);
    
    // Log results
    logApi.info(`[LiquiditySim Test] Simulation complete for ${results.simulationSummary.scenario} scenario`);
    logApi.info(`• Initial Position: ${results.position.personal.tokens.toLocaleString()} tokens (${results.position.personal.percentage}% of supply)`);
    
    // Log strategy results
    Object.entries(results.strategies).forEach(([strategy, data]) => {
      logApi.info(`• ${strategy} Strategy Results:`);
      logApi.info(`  - Tokens Sold: ${data.tokensSold.toLocaleString()} (${data.percentLiquidated.toFixed(2)}% of position)`);
      logApi.info(`  - Value Realized: $${data.totalValueRealized.toLocaleString()}`);
      logApi.info(`  - Days to Half: ${data.daysToHalf}`);
    });
    
    logApi.info(`• Best Strategy: ${results.simulationSummary.bestStrategy}`);
    
    // Test grid simulation
    logApi.info('[LiquiditySim Test] Running grid simulation...');
    const gridResults = liquiditySimService.runSimulationGrid({
      totalSupply: testData.totalSupply,
      currentPrice: testData.currentPrice,
      baseReserve: testData.baseReserve,
      quoteReserve: testData.quoteReserve,
      personalRatio: 0.5,
      acquisitionLevels: ['low', 'medium', 'high'],
      scenarios: ['baseCase', 'bullCase'],
      days: 180,
      calculateExact: false
    });
    
    logApi.info(`[LiquiditySim Test] Grid simulation complete with ${Object.keys(gridResults.results).length} acquisition levels and multiple scenarios`);
    
    // Shut down the service
    await liquiditySimService.shutdown();
    logApi.info('[LiquiditySim Test] Service shutdown successfully');
    
    // All tests passed
    logApi.info('[LiquiditySim Test] All tests completed successfully! 🎉');
  } catch (error) {
    // Log any errors
    logApi.error('[LiquiditySim Test] Error during tests:', error);
  }
}

// Run the tests
runTests();