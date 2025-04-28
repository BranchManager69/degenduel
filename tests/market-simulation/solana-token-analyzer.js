// tests/market-simulation/solana-token-analyzer.js

/**
 * Solana Token Analyzer
 * 
 * A comprehensive tool for analyzing Solana tokens using multiple data sources.
 * Works with any token, including those with limited or no Jupiter liquidity.
 * 
 * Features:
 * - Token metadata retrieval (name, symbol, decimals, etc.)
 * - Supply and holder analysis
 * - DexScreener and Birdeye price lookup
 * - Basic market making insights
 * 
 * Run with: node tests/market-simulation/solana-token-analyzer.js [TOKEN_ADDRESS]
 */

import axios from 'axios';
import { fancyColors } from '../../utils/colors.js';
import { promises as fs } from 'fs';

// Get token address from command line or use default
const TOKEN_ADDRESS = process.argv[2] || '3Ym712hHjQipiq3vyzSpnhd5ysBngi1M9phQSQjTpump';

// Configuration
const CONFIG = {
  // Standard tokens for reference
  USDC_ADDRESS: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL_ADDRESS: 'So11111111111111111111111111111111111111112',
  
  // API endpoints
  APIS: {
    SOLSCAN: 'https://public-api.solscan.io',
    BIRDEYE: 'https://public-api.birdeye.so',
    DEXSCREENER: 'https://api.dexscreener.com/latest/dex/tokens',
    JUPITER: 'https://quote-api.jup.ag/v4'
  },
  
  // Analysis parameters
  ANALYSIS: {
    // Number of samples to collect
    SAMPLES: 3,
    // Time interval between samples (ms)
    INTERVAL_MS: 10000,
    // Market making parameters
    MARKET_MAKING: {
      SPREAD_DEFAULT: 0.03, // 3% default spread
      MIN_ORDER_SIZE_USDC: 10,
      MAX_ORDER_SIZE_USDC: 1000
    }
  },
  
  // Output options
  OUTPUT: {
    // Save analysis to file
    SAVE_TO_FILE: true,
    OUTPUT_DIR: '/tmp/token-analysis'
  }
};

// Formatting helpers
const format = {
  address: (addr) => `${addr.slice(0, 4)}...${addr.slice(-4)}`,
  price: (price) => price ? `$${parseFloat(price).toFixed(8)}` : 'Unknown',
  amount: (amount) => amount ? parseFloat(parseFloat(amount).toFixed(6)).toLocaleString() : 'Unknown',
  percentage: (pct) => pct ? `${(pct * 100).toFixed(2)}%` : 'Unknown',
  timestamp: () => new Date().toISOString(),
  dateTime: (date) => new Date(date).toLocaleString(),
  supply: (supply, decimals) => {
    if (!supply) return 'Unknown';
    return (supply / Math.pow(10, decimals)).toLocaleString();
  }
};

/**
 * Solana Token Analyzer Class
 */
class SolanaTokenAnalyzer {
  constructor(tokenAddress, config) {
    this.tokenAddress = tokenAddress;
    this.config = config;
    this.data = {
      metadata: null,
      supply: null,
      holders: null,
      prices: {
        birdeye: null,
        dexscreener: null,
        jupiter: null
      },
      marketMaking: {
        suggested: null
      },
      samples: [],
      lastUpdated: null
    };
  }
  
  /**
   * Run the complete analysis
   */
  async analyze() {
    console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} SOLANA TOKEN ANALYZER ${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Token: ${this.tokenAddress}${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Analysis started: ${format.dateTime(new Date())}${fancyColors.RESET}`);
    console.log("");
    
    // Get token metadata
    await this.getTokenMetadata();
    
    // Get prices from multiple sources
    await this.getPrices();
    
    // Get holder information
    await this.getHolderInfo();
    
    // Generate market making suggestions
    this.generateMarketMakingSuggestions();
    
    // Collect samples
    await this.collectSamples();
    
    // Print summary
    this.printSummary();
    
    // Save analysis if configured
    if (this.config.OUTPUT.SAVE_TO_FILE) {
      await this.saveAnalysis();
    }
  }
  
  /**
   * Get token metadata from Solscan
   */
  async getTokenMetadata() {
    console.log(`${fancyColors.BLUE}Fetching token metadata...${fancyColors.RESET}`);
    
    try {
      // Try Solscan first
      const solscanResponse = await axios.get(`${this.config.APIS.SOLSCAN}/token/meta`, {
        params: { tokenAddress: this.tokenAddress }
      });
      
      if (solscanResponse.data) {
        // Basic token data
        this.data.metadata = {
          address: this.tokenAddress,
          name: solscanResponse.data.name || solscanResponse.data.tokenName || 'Unknown',
          symbol: solscanResponse.data.symbol || solscanResponse.data.tokenSymbol || 'Unknown',
          decimals: solscanResponse.data.decimals || 
                   (solscanResponse.data.tokenAmount ? solscanResponse.data.tokenAmount.decimals : 9),
          logoURI: solscanResponse.data.icon || null,
          source: 'Solscan'
        };
        
        // Token supply data
        if (solscanResponse.data.tokenAmount) {
          this.data.supply = {
            total: solscanResponse.data.tokenAmount.amount,
            decimals: solscanResponse.data.tokenAmount.decimals,
            uiAmount: solscanResponse.data.tokenAmount.uiAmount,
            burned: solscanResponse.data.burnedTotal || 0,
            circulatingUI: solscanResponse.data.tokenAmount.uiAmount - (solscanResponse.data.burnedTotal || 0),
            source: 'Solscan'
          };
        }
        
        console.log(`${fancyColors.GREEN}Token name: ${this.data.metadata.name}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Token symbol: ${this.data.metadata.symbol}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Token decimals: ${this.data.metadata.decimals}${fancyColors.RESET}`);
        
        if (this.data.supply) {
          console.log(`${fancyColors.GREEN}Total supply: ${format.supply(this.data.supply.total, this.data.supply.decimals)}${fancyColors.RESET}`);
        }
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting metadata from Solscan: ${error.message}${fancyColors.RESET}`);
      
      // Try alternate sources if Solscan fails
      try {
        // Minimal fallback to make sure we have something
        this.data.metadata = {
          address: this.tokenAddress,
          name: 'Unknown',
          symbol: 'Unknown',
          decimals: 9,
          source: 'Default'
        };
        
        console.log(`${fancyColors.YELLOW}Using default metadata values${fancyColors.RESET}`);
      } catch (fallbackError) {
        console.log(`${fancyColors.RED}Error in fallback metadata: ${fallbackError.message}${fancyColors.RESET}`);
      }
    }
  }
  
  /**
   * Get token prices from multiple sources
   */
  async getPrices() {
    console.log(`${fancyColors.BLUE}Fetching token prices from multiple sources...${fancyColors.RESET}`);
    
    // Try Birdeye
    try {
      const birdeyeResponse = await axios.get(`${this.config.APIS.BIRDEYE}/public/price`, {
        params: { address: this.tokenAddress }
      });
      
      if (birdeyeResponse.data && birdeyeResponse.data.data && birdeyeResponse.data.data.value) {
        this.data.prices.birdeye = {
          price: birdeyeResponse.data.data.value,
          lastUpdated: new Date(),
          source: 'Birdeye'
        };
        
        console.log(`${fancyColors.GREEN}Birdeye price: ${format.price(this.data.prices.birdeye.price)}${fancyColors.RESET}`);
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting price from Birdeye: ${error.message}${fancyColors.RESET}`);
    }
    
    // Try DexScreener
    try {
      const dexscreenerResponse = await axios.get(`${this.config.APIS.DEXSCREENER}/${this.tokenAddress}`);
      
      if (dexscreenerResponse.data && dexscreenerResponse.data.pairs && dexscreenerResponse.data.pairs.length > 0) {
        // Find the pair with highest liquidity
        const sortedPairs = [...dexscreenerResponse.data.pairs].sort((a, b) => {
          return (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0);
        });
        
        const bestPair = sortedPairs[0];
        
        this.data.prices.dexscreener = {
          price: bestPair.priceUsd,
          priceChange24h: bestPair.priceChange?.h24,
          volume24h: bestPair.volume?.h24,
          liquidity: bestPair.liquidity?.usd,
          exchange: bestPair.dexId,
          pair: bestPair.pairAddress,
          lastUpdated: new Date(),
          source: 'DexScreener'
        };
        
        console.log(`${fancyColors.GREEN}DexScreener price: ${format.price(this.data.prices.dexscreener.price)}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}24h change: ${format.percentage(this.data.prices.dexscreener.priceChange24h)}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Liquidity: $${format.amount(this.data.prices.dexscreener.liquidity)}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Exchange: ${this.data.prices.dexscreener.exchange}${fancyColors.RESET}`);
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting price from DexScreener: ${error.message}${fancyColors.RESET}`);
    }
    
    // Try Jupiter
    try {
      const jupiterResponse = await axios.get(`${this.config.APIS.JUPITER}${'/price'}`, {
        params: { ids: this.tokenAddress }
      });
      
      if (jupiterResponse.data && jupiterResponse.data.data && jupiterResponse.data.data[this.tokenAddress]) {
        this.data.prices.jupiter = {
          price: jupiterResponse.data.data[this.tokenAddress].price,
          lastUpdated: new Date(),
          source: 'Jupiter'
        };
        
        console.log(`${fancyColors.GREEN}Jupiter price: ${format.price(this.data.prices.jupiter.price)}${fancyColors.RESET}`);
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting price from Jupiter: ${error.message}${fancyColors.RESET}`);
    }
    
    // Use the best price available
    const bestPrice = this.getBestPrice();
    if (bestPrice) {
      console.log(`${fancyColors.GREEN}Best price (${bestPrice.source}): ${format.price(bestPrice.price)}${fancyColors.RESET}`);
      this.data.currentPrice = bestPrice.price;
    } else {
      console.log(`${fancyColors.YELLOW}No price data available.${fancyColors.RESET}`);
    }
  }
  
  /**
   * Get the best price from available sources
   */
  getBestPrice() {
    // Prefer DexScreener (most detailed), then Birdeye, then Jupiter
    if (this.data.prices.dexscreener && this.data.prices.dexscreener.price) {
      return { 
        price: this.data.prices.dexscreener.price, 
        source: 'DexScreener' 
      };
    }
    
    if (this.data.prices.birdeye && this.data.prices.birdeye.price) {
      return { 
        price: this.data.prices.birdeye.price, 
        source: 'Birdeye' 
      };
    }
    
    if (this.data.prices.jupiter && this.data.prices.jupiter.price) {
      return { 
        price: this.data.prices.jupiter.price, 
        source: 'Jupiter' 
      };
    }
    
    return null;
  }
  
  /**
   * Get holder information
   */
  async getHolderInfo() {
    console.log(`${fancyColors.BLUE}Fetching holder information...${fancyColors.RESET}`);
    
    try {
      const holdersResponse = await axios.get(`${this.config.APIS.SOLSCAN}/token/holders`, {
        params: {
          tokenAddress: this.tokenAddress,
          limit: 10,
          offset: 0
        }
      });
      
      if (holdersResponse.data && holdersResponse.data.data) {
        this.data.holders = {
          count: holdersResponse.data.total || holdersResponse.data.data.length,
          top10: holdersResponse.data.data.map(holder => ({
            address: holder.owner,
            amount: holder.amount,
            amountUI: holder.uiAmount || holder.amount / Math.pow(10, this.data.metadata.decimals),
            percentage: holder.percentage || 0
          }))
        };
        
        console.log(`${fancyColors.GREEN}Holder count: ${this.data.holders.count}${fancyColors.RESET}`);
        
        // Calculate concentration
        if (this.data.holders.top10.length > 0) {
          const top10Concentration = this.data.holders.top10.reduce((sum, holder) => sum + holder.percentage, 0);
          console.log(`${fancyColors.GREEN}Top 10 holders concentration: ${format.percentage(top10Concentration/100)}${fancyColors.RESET}`);
          this.data.holders.top10Concentration = top10Concentration/100;
        }
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting holder information: ${error.message}${fancyColors.RESET}`);
    }
  }
  
  /**
   * Generate market making suggestions
   */
  generateMarketMakingSuggestions() {
    console.log(`${fancyColors.BLUE}Generating market making suggestions...${fancyColors.RESET}`);
    
    // Default suggestions
    const suggestions = {
      spread: this.config.ANALYSIS.MARKET_MAKING.SPREAD_DEFAULT,
      orderSizes: {
        min: this.config.ANALYSIS.MARKET_MAKING.MIN_ORDER_SIZE_USDC,
        max: this.config.ANALYSIS.MARKET_MAKING.MAX_ORDER_SIZE_USDC,
        recommended: this.config.ANALYSIS.MARKET_MAKING.MIN_ORDER_SIZE_USDC * 5
      },
      refreshInterval: 60, // seconds
      notes: []
    };
    
    // Adjust based on price
    if (this.data.currentPrice) {
      // For very low priced tokens, use wider spreads
      if (this.data.currentPrice < 0.00001) {
        suggestions.spread = 0.05; // 5%
        suggestions.notes.push("Token has a very low price, using wider spreads to compensate for price volatility");
      } else if (this.data.currentPrice < 0.0001) {
        suggestions.spread = 0.04; // 4%
        suggestions.notes.push("Token has a low price, using slightly wider spreads");
      } else if (this.data.currentPrice > 1) {
        suggestions.spread = 0.02; // 2%
        suggestions.notes.push("Token has a higher price, tighter spreads are possible");
      }
      
      // Adjust order sizes based on price
      // For higher priced tokens, use smaller orders
      if (this.data.currentPrice > 1) {
        suggestions.orderSizes.recommended = 50;
        suggestions.orderSizes.max = 500;
      } else if (this.data.currentPrice < 0.00001) {
        suggestions.orderSizes.recommended = 100;
        suggestions.orderSizes.max = 1000;
      }
    }
    
    // Adjust based on liquidity if available
    if (this.data.prices.dexscreener && this.data.prices.dexscreener.liquidity) {
      const liquidity = this.data.prices.dexscreener.liquidity;
      
      // For low liquidity tokens, use smaller orders and wider spreads
      if (liquidity < 10000) {
        suggestions.spread = Math.max(suggestions.spread, 0.05);
        suggestions.orderSizes.recommended = Math.min(suggestions.orderSizes.recommended, 50);
        suggestions.orderSizes.max = Math.min(suggestions.orderSizes.max, 200);
        suggestions.notes.push("Token has very low liquidity, using smaller orders and wider spreads");
      } else if (liquidity < 50000) {
        suggestions.spread = Math.max(suggestions.spread, 0.04);
        suggestions.orderSizes.recommended = Math.min(suggestions.orderSizes.recommended, 100);
        suggestions.orderSizes.max = Math.min(suggestions.orderSizes.max, 500);
        suggestions.notes.push("Token has low liquidity, adjusting order sizes accordingly");
      } else if (liquidity > 1000000) {
        suggestions.spread = Math.min(suggestions.spread, 0.01);
        suggestions.orderSizes.recommended = 200;
        suggestions.orderSizes.max = 2000;
        suggestions.notes.push("Token has high liquidity, tighter spreads and larger orders are possible");
      }
      
      // Calculate what percentage of liquidity the recommended order size represents
      const liquidityImpact = (suggestions.orderSizes.recommended / liquidity) * 100;
      suggestions.liquidityImpact = liquidityImpact;
      
      if (liquidityImpact > 5) {
        suggestions.orderSizes.recommended = Math.min(suggestions.orderSizes.recommended, liquidity * 0.05);
        suggestions.notes.push(`Reduced recommended order size to 5% of available liquidity`);
      }
    }
    
    // Adjust based on holder concentration if available
    if (this.data.holders && this.data.holders.top10Concentration) {
      if (this.data.holders.top10Concentration > 0.8) {
        suggestions.notes.push("WARNING: Token has extremely high holder concentration (>80% in top 10), high manipulation risk");
        suggestions.spread = Math.max(suggestions.spread, 0.08);
      } else if (this.data.holders.top10Concentration > 0.6) {
        suggestions.notes.push("CAUTION: Token has high holder concentration (>60% in top 10), increased manipulation risk");
        suggestions.spread = Math.max(suggestions.spread, 0.05);
      }
    }
    
    // Add some specific suggestions for market making
    suggestions.marketMakingStrategy = [
      `Place buy orders at ${format.percentage(suggestions.spread)} below current price`,
      `Place sell orders at ${format.percentage(suggestions.spread)} above current price`,
      `Use order sizes between ${suggestions.orderSizes.min} and ${suggestions.orderSizes.recommended} USDC`,
      `Refresh orders approximately every ${suggestions.refreshInterval} seconds`,
      `Monitor price movements and adjust strategy accordingly`
    ];
    
    // Store the suggestions
    this.data.marketMaking.suggested = suggestions;
    
    // Print some basic suggestions
    console.log(`${fancyColors.GREEN}Suggested spread: ${format.percentage(suggestions.spread)}${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Suggested order size: ${suggestions.orderSizes.recommended} USDC${fancyColors.RESET}`);
    
    if (suggestions.notes.length > 0) {
      console.log(`${fancyColors.YELLOW}Notes:${fancyColors.RESET}`);
      suggestions.notes.forEach(note => {
        console.log(`${fancyColors.YELLOW}- ${note}${fancyColors.RESET}`);
      });
    }
  }
  
  /**
   * Collect price samples over time
   */
  async collectSamples() {
    if (this.config.ANALYSIS.SAMPLES <= 1) {
      return; // No need to collect samples
    }
    
    console.log(`${fancyColors.BLUE}Collecting ${this.config.ANALYSIS.SAMPLES} price samples...${fancyColors.RESET}`);
    
    // Add the current price as the first sample
    const currentPrice = this.getBestPrice();
    if (currentPrice) {
      this.data.samples.push({
        timestamp: new Date(),
        price: currentPrice.price,
        source: currentPrice.source
      });
    }
    
    // Collect the remaining samples with delays
    let samplesCollected = 1;
    
    while (samplesCollected < this.config.ANALYSIS.SAMPLES) {
      // Wait for the interval
      await new Promise(resolve => setTimeout(resolve, this.config.ANALYSIS.INTERVAL_MS));
      
      // Get prices again
      await this.getPrices();
      
      // Add sample
      const price = this.getBestPrice();
      if (price) {
        this.data.samples.push({
          timestamp: new Date(),
          price: price.price,
          source: price.source
        });
        
        console.log(`${fancyColors.GREEN}Sample ${samplesCollected + 1}/${this.config.ANALYSIS.SAMPLES}: ${format.price(price.price)} (${price.source})${fancyColors.RESET}`);
        samplesCollected++;
      }
    }
    
    // Calculate price volatility if we have enough samples
    if (this.data.samples.length > 1) {
      const prices = this.data.samples.map(sample => parseFloat(sample.price));
      const avgPrice = prices.reduce((sum, price) => sum + price, 0) / prices.length;
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const volatility = (maxPrice - minPrice) / avgPrice;
      
      this.data.volatility = {
        value: volatility,
        min: minPrice,
        max: maxPrice,
        avg: avgPrice
      };
      
      console.log(`${fancyColors.GREEN}Price volatility: ${format.percentage(volatility)}${fancyColors.RESET}`);
      
      // Adjust market making suggestions based on volatility
      if (volatility > 0.05) {
        this.data.marketMaking.suggested.spread = Math.max(this.data.marketMaking.suggested.spread, volatility * 2);
        this.data.marketMaking.suggested.notes.push(`Increased spread due to high volatility (${format.percentage(volatility)})`);
        
        console.log(`${fancyColors.YELLOW}Adjusted spread to ${format.percentage(this.data.marketMaking.suggested.spread)} due to volatility${fancyColors.RESET}`);
      }
    }
  }
  
  /**
   * Print analysis summary
   */
  printSummary() {
    console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} TOKEN ANALYSIS SUMMARY ${fancyColors.RESET}`);
    
    // Token info
    console.log(`\n${fancyColors.YELLOW}--- TOKEN INFORMATION ---${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Address: ${this.tokenAddress}${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Name: ${this.data.metadata?.name || 'Unknown'}${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Symbol: ${this.data.metadata?.symbol || 'Unknown'}${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Decimals: ${this.data.metadata?.decimals || 'Unknown'}${fancyColors.RESET}`);
    
    if (this.data.supply) {
      console.log(`${fancyColors.GREEN}Total Supply: ${format.supply(this.data.supply.total, this.data.supply.decimals)}${fancyColors.RESET}`);
      
      if (this.data.supply.burned && this.data.supply.burned > 0) {
        console.log(`${fancyColors.GREEN}Burned: ${format.supply(this.data.supply.burned, this.data.supply.decimals)}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Circulating: ${format.supply(this.data.supply.total - this.data.supply.burned, this.data.supply.decimals)}${fancyColors.RESET}`);
      }
    }
    
    if (this.data.holders) {
      console.log(`${fancyColors.GREEN}Holders: ${this.data.holders.count}${fancyColors.RESET}`);
      
      if (this.data.holders.top10Concentration) {
        console.log(`${fancyColors.GREEN}Top 10 Concentration: ${format.percentage(this.data.holders.top10Concentration)}${fancyColors.RESET}`);
      }
    }
    
    // Price information
    console.log(`\n${fancyColors.YELLOW}--- PRICE INFORMATION ---${fancyColors.RESET}`);
    const bestPrice = this.getBestPrice();
    console.log(`${fancyColors.GREEN}Current Price: ${bestPrice ? format.price(bestPrice.price) : 'Unknown'} (${bestPrice ? bestPrice.source : 'N/A'})${fancyColors.RESET}`);
    
    if (this.data.prices.dexscreener) {
      console.log(`${fancyColors.GREEN}24h Change: ${format.percentage(this.data.prices.dexscreener.priceChange24h)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}24h Volume: $${format.amount(this.data.prices.dexscreener.volume24h)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Liquidity: $${format.amount(this.data.prices.dexscreener.liquidity)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Exchange: ${this.data.prices.dexscreener.exchange}${fancyColors.RESET}`);
    }
    
    if (this.data.volatility) {
      console.log(`${fancyColors.GREEN}Short-term Volatility: ${format.percentage(this.data.volatility.value)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Min/Max/Avg Price: ${format.price(this.data.volatility.min)} / ${format.price(this.data.volatility.max)} / ${format.price(this.data.volatility.avg)}${fancyColors.RESET}`);
    }
    
    // Market making recommendations
    console.log(`\n${fancyColors.YELLOW}--- MARKET MAKING RECOMMENDATIONS ---${fancyColors.RESET}`);
    
    if (this.data.marketMaking.suggested) {
      const sugg = this.data.marketMaking.suggested;
      
      console.log(`${fancyColors.GREEN}Spread: ${format.percentage(sugg.spread)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Order Sizes: ${sugg.orderSizes.min} - ${sugg.orderSizes.recommended} USDC (max: ${sugg.orderSizes.max} USDC)${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Refresh Interval: ${sugg.refreshInterval} seconds${fancyColors.RESET}`);
      
      if (sugg.liquidityImpact) {
        console.log(`${fancyColors.GREEN}Liquidity Impact: ${sugg.liquidityImpact.toFixed(2)}% of pool${fancyColors.RESET}`);
      }
      
      console.log(`\n${fancyColors.YELLOW}Strategy:${fancyColors.RESET}`);
      sugg.marketMakingStrategy.forEach(step => {
        console.log(`${fancyColors.GREEN}- ${step}${fancyColors.RESET}`);
      });
      
      if (sugg.notes.length > 0) {
        console.log(`\n${fancyColors.YELLOW}Notes:${fancyColors.RESET}`);
        sugg.notes.forEach(note => {
          console.log(`${fancyColors.YELLOW}- ${note}${fancyColors.RESET}`);
        });
      }
    } else {
      console.log(`${fancyColors.YELLOW}Unable to generate market making recommendations due to insufficient data.${fancyColors.RESET}`);
    }
    
    // Simple market making code example
    console.log(`\n${fancyColors.YELLOW}--- SAMPLE MARKET MAKING CODE ---${fancyColors.RESET}`);
    
    const spread = this.data.marketMaking.suggested?.spread || 0.03;
    const orderSize = this.data.marketMaking.suggested?.orderSizes.recommended || 50;
    const refreshInterval = this.data.marketMaking.suggested?.refreshInterval || 60;
    const bestPriceValue = bestPrice?.price || 0.00001;
    
    console.log(`${fancyColors.CYAN}
// Simple market making logic
async function runMarketMaker() {
  // Current token price from analysis: ${format.price(bestPriceValue)}
  const currentPrice = ${bestPriceValue};
  
  // Configure your market making parameters
  const config = {
    spread: ${spread}, // ${format.percentage(spread)} spread
    orderSizeUsdc: ${orderSize}, // ${orderSize} USDC per order
    refreshInterval: ${refreshInterval} // ${refreshInterval} seconds
  };
  
  // Calculate buy and sell prices
  const buyPrice = currentPrice * (1 - config.spread);
  const sellPrice = currentPrice * (1 + config.spread);
  
  console.log(\`Setting buy order at \${buyPrice}\`);
  console.log(\`Setting sell order at \${sellPrice}\`);
  
  // Calculate tokens to buy/sell
  const tokensToBuy = config.orderSizeUsdc / buyPrice;
  const tokensToSell = config.orderSizeUsdc / currentPrice;
  
  // Place buy order
  // await placeOrder('buy', tokensToBuy, buyPrice);
  
  // Place sell order
  // await placeOrder('sell', tokensToSell, sellPrice);
  
  // Schedule refresh
  setTimeout(runMarketMaker, config.refreshInterval * 1000);
}

// Start the market maker
runMarketMaker();
${fancyColors.RESET}`);
    
    // Final notes
    console.log(`\n${fancyColors.BG_GREEN}${fancyColors.BLACK} ANALYSIS COMPLETE ${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Analysis completed: ${format.dateTime(new Date())}${fancyColors.RESET}`);
  }
  
  /**
   * Save analysis results to file
   */
  async saveAnalysis() {
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.config.OUTPUT.OUTPUT_DIR, { recursive: true });
      
      // Create timestamp for filename
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `${this.config.OUTPUT.OUTPUT_DIR}/${this.data.metadata?.symbol || 'token'}_${timestamp}.json`;
      
      // Save data
      await fs.writeFile(filename, JSON.stringify(this.data, null, 2));
      
      console.log(`${fancyColors.GREEN}Analysis saved to ${filename}${fancyColors.RESET}`);
      return filename;
    } catch (error) {
      console.log(`${fancyColors.RED}Error saving analysis: ${error.message}${fancyColors.RESET}`);
      return null;
    }
  }
}

// Run the analyzer
(async () => {
  const analyzer = new SolanaTokenAnalyzer(TOKEN_ADDRESS, CONFIG);
  await analyzer.analyze();
})();

// Handle graceful exit
process.on('SIGINT', () => {
  console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} Solana Token Analyzer Stopped ${fancyColors.RESET}`);
  process.exit(0);
});