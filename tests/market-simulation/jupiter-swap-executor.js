// tests/market-simulation/jupiter-swap-executor.js

/**
 * Jupiter Swap Executor
 * 
 * A complete implementation of Jupiter Swap API integration.
 * This script demonstrates the entire process of:
 * 1. Getting quotes from Jupiter
 * 2. Constructing swap transactions
 * 3. Setting up transaction parameters
 * 4. Creating ready-to-sign transactions
 * 
 * IMPORTANT: This script stops short of actually signing and sending transactions
 * but provides all the setup needed to integrate with any wallet or signing mechanism.
 * 
 * Run with: node tests/market-simulation/jupiter-swap-executor.js [TOKEN_ADDRESS]
 */

import axios from 'axios';
import { fancyColors } from '../../utils/colors.js';

// Get token address from command line or use default
const TOKEN_ADDRESS = process.argv[2] || '3Ym712hHjQipiq3vyzSpnhd5ysBngi1M9phQSQjTpump';

// Configuration
const CONFIG = {
  // Jupiter API endpoints (using paid API with key)
  JUPITER_API: {
    BASE_URL: 'https://api.jup.ag',
    QUOTE: '/swap/v1/quote',
    SWAP_INSTRUCTIONS: '/swap/v1/swap-instructions',
    PRICE: '/swap/v1/price',
    API_KEY: '5c188838-1d59-4108-aaa3-4bc027cfd3d7'
  },
  
  // Standard tokens
  USDC_ADDRESS: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SOL_ADDRESS: 'So11111111111111111111111111111111111111112',
  
  // Transaction parameters
  TRANSACTION: {
    SLIPPAGE_BPS: 100, // 1% slippage
    USE_PRIORITY_FEE: true,
    PRIORITY_LEVEL: 'high',
    COMPUTE_LIMIT_MULTIPLIER: 1.3, // 30% buffer for compute units
    RETRY_COUNT: 3,
    CONFIRM_TIMEOUT: 60000 // 60 seconds
  },
  
  // Market making configuration
  MARKET_MAKING: {
    SPREAD: 0.03, // 3% spread
    BASE_ORDER_SIZE_USDC: 50, // 50 USDC per order
    REFRESH_INTERVAL: 60, // 60 seconds
    CANCEL_ON_REFRESH: true
  },
  
  // Demo mode (simulated wallet)
  DEMO: {
    WALLET_ADDRESS: '9JsmM5FnGYVszT7n1bWFGCJBPHJCkLdK172EYR7NuNmi', // Empty demo wallet
    SIMULATED_SOL_BALANCE: 1.5, // SOL
    SIMULATED_USDC_BALANCE: 500, // USDC
    SIMULATED_TOKEN_BALANCE: 10000000 // Custom token
  }
};

// Formatting helpers
const format = {
  address: (addr) => `${addr.slice(0, 4)}...${addr.slice(-4)}`,
  price: (price) => price ? `$${parseFloat(price).toFixed(8)}` : 'Unknown',
  amount: (amount) => amount ? parseFloat(parseFloat(amount).toFixed(6)).toLocaleString() : 'Unknown',
  percentage: (pct) => pct ? `${(pct * 100).toFixed(2)}%` : 'Unknown',
  timestamp: () => new Date().toISOString(),
  dateTime: (date) => new Date(date).toLocaleString()
};

/**
 * Jupiter Swap Executor Class
 */
class JupiterSwapExecutor {
  constructor(tokenAddress, config) {
    this.tokenAddress = tokenAddress;
    this.config = config;
    this.state = {
      walletAddress: config.DEMO.WALLET_ADDRESS,
      currentPrice: null,
      lastQuote: null,
      pendingTransactions: [],
      transactionHistory: [],
      marketMaking: {
        isActive: false,
        startTimestamp: null,
        nextRefresh: null,
        metrics: {
          buys: 0,
          sells: 0,
          volumeUsdc: 0
        }
      }
    };
  }
  
  /**
   * Initialize the executor
   */
  async initialize() {
    console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} JUPITER SWAP EXECUTOR ${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Target Token: ${this.tokenAddress}${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Wallet Address: ${this.state.walletAddress}${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}Initialized: ${format.dateTime(new Date())}${fancyColors.RESET}`);
    console.log("");
    
    // Get token information
    const tokenInfo = await this.getTokenInfo();
    if (!tokenInfo) {
      console.log(`${fancyColors.RED}Failed to get token information. Exiting.${fancyColors.RESET}`);
      return false;
    }
    
    // Display wallet information (simulated)
    this.displayWalletInfo();
    
    return true;
  }
  
  /**
   * Get token information from Jupiter
   */
  async getTokenInfo() {
    console.log(`${fancyColors.BLUE}Fetching token information...${fancyColors.RESET}`);
    
    try {
      // Try getting price from Jupiter price API
      const priceResponse = await axios.get(`${this.config.JUPITER_API.BASE_URL}${this.config.JUPITER_API.PRICE}`, {
        params: { ids: this.tokenAddress },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.JUPITER_API.API_KEY
        }
      });
      
      if (priceResponse.data && priceResponse.data.data && priceResponse.data.data[this.tokenAddress]) {
        const priceData = priceResponse.data.data[this.tokenAddress];
        this.state.currentPrice = priceData.price;
        this.state.tokenInfo = {
          address: this.tokenAddress,
          price: priceData.price,
          lastUpdated: new Date()
        };
        
        console.log(`${fancyColors.GREEN}Token price: ${format.price(this.state.currentPrice)}${fancyColors.RESET}`);
        return this.state.tokenInfo;
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting price from Jupiter API: ${error.message}${fancyColors.RESET}`);
    }
    
    // If price API failed, try getting a quote for price info
    try {
      console.log(`${fancyColors.YELLOW}Trying quote API for price information...${fancyColors.RESET}`);
      
      const quoteResponse = await axios.get(`${this.config.JUPITER_API.BASE_URL}${this.config.JUPITER_API.QUOTE}`, {
        params: {
          inputMint: this.config.USDC_ADDRESS,
          outputMint: this.tokenAddress,
          amount: 1000000, // 1 USDC (6 decimals)
          slippageBps: this.config.TRANSACTION.SLIPPAGE_BPS,
        },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.JUPITER_API.API_KEY
        }
      });
      
      if (quoteResponse.data && quoteResponse.data.outAmount) {
        // Calculate price from the quote (1 USDC / token amount)
        const tokenAmount = quoteResponse.data.outAmount / Math.pow(10, quoteResponse.data.outputDecimals);
        const price = 1 / tokenAmount;
        
        this.state.currentPrice = price;
        this.state.tokenInfo = {
          address: this.tokenAddress,
          price: price,
          lastUpdated: new Date(),
          decimals: quoteResponse.data.outputDecimals
        };
        
        console.log(`${fancyColors.GREEN}Token price (from quote): ${format.price(this.state.currentPrice)}${fancyColors.RESET}`);
        console.log(`${fancyColors.GREEN}Token decimals: ${this.state.tokenInfo.decimals}${fancyColors.RESET}`);
        return this.state.tokenInfo;
      }
    } catch (error) {
      console.log(`${fancyColors.YELLOW}Error getting quote from Jupiter API: ${error.message}${fancyColors.RESET}`);
    }
    
    // If all methods failed, use a fallback
    console.log(`${fancyColors.YELLOW}Using fallback token information${fancyColors.RESET}`);
    this.state.tokenInfo = {
      address: this.tokenAddress,
      price: 0.00001, // Fallback price
      decimals: 9, // Default decimals
      lastUpdated: new Date()
    };
    
    this.state.currentPrice = this.state.tokenInfo.price;
    console.log(`${fancyColors.YELLOW}Using fallback price: ${format.price(this.state.currentPrice)}${fancyColors.RESET}`);
    
    return this.state.tokenInfo;
  }
  
  /**
   * Display wallet information (simulated)
   */
  displayWalletInfo() {
    console.log(`${fancyColors.BLUE}Wallet Information (Simulated):${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Address: ${this.state.walletAddress}${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}SOL Balance: ${this.config.DEMO.SIMULATED_SOL_BALANCE} SOL${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}USDC Balance: ${this.config.DEMO.SIMULATED_USDC_BALANCE} USDC${fancyColors.RESET}`);
    console.log(`${fancyColors.GREEN}Token Balance: ${format.amount(this.config.DEMO.SIMULATED_TOKEN_BALANCE)} ${this.state.tokenInfo?.symbol || 'tokens'}${fancyColors.RESET}`);
    console.log('');
  }
  
  /**
   * Run the executor with interactive menu
   */
  async run() {
    // Display main menu
    this.displayMainMenu();
    
    // Set up basic keypress handling for the demo
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (key) => {
      const keypress = key.toString();
      
      if (keypress === '\u0003') {
        // Ctrl+C - exit
        console.log(`${fancyColors.BG_BLUE}${fancyColors.WHITE} JUPITER SWAP EXECUTOR STOPPED ${fancyColors.RESET}`);
        process.exit(0);
      } else if (keypress === '1') {
        // Get quote
        this.performGetQuote();
      } else if (keypress === '2') {
        // Create swap transaction
        this.performCreateSwapTransaction();
      } else if (keypress === '3') {
        // Start market making
        this.toggleMarketMaking();
      } else if (keypress === '4') {
        // Display token and wallet info
        this.refreshTokenAndWalletInfo();
      } else if (keypress === 'm') {
        // Return to main menu
        this.displayMainMenu();
      }
    });
  }
  
  /**
   * Display the main menu
   */
  displayMainMenu() {
    console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} MAIN MENU ${fancyColors.RESET}`);
    console.log(`${fancyColors.YELLOW}1.${fancyColors.RESET} Get Quote for Swap`);
    console.log(`${fancyColors.YELLOW}2.${fancyColors.RESET} Create Swap Transaction`);
    console.log(`${fancyColors.YELLOW}3.${fancyColors.RESET} ${this.state.marketMaking.isActive ? 'Stop' : 'Start'} Market Making`);
    console.log(`${fancyColors.YELLOW}4.${fancyColors.RESET} Refresh Token & Wallet Info`);
    console.log(`${fancyColors.YELLOW}Ctrl+C${fancyColors.RESET} Exit`);
    console.log('');
    console.log(`${fancyColors.GREEN}Enter your choice:${fancyColors.RESET}`);
  }
  
  /**
   * Refresh token and wallet information
   */
  async refreshTokenAndWalletInfo() {
    await this.getTokenInfo();
    this.displayWalletInfo();
    console.log(`${fancyColors.GREEN}Information refreshed.${fancyColors.RESET}`);
    setTimeout(() => this.displayMainMenu(), 1000);
  }
  
  /**
   * Get a quote from Jupiter API
   */
  async getQuote(inputMint, outputMint, amount, exactOut = false) {
    try {
      console.log(`${fancyColors.BLUE}Getting quote from Jupiter...${fancyColors.RESET}`);
      
      const params = {
        inputMint,
        outputMint,
        [exactOut ? 'outputAmount' : 'amount']: amount.toString(),
        slippageBps: this.config.TRANSACTION.SLIPPAGE_BPS,
      };
      
      if (this.config.TRANSACTION.USE_PRIORITY_FEE) {
        params.prioritizationFeeLamports = '10000'; // 0.00001 SOL
      }
      
      // Optionally adjust compute limit
      params.dynamicComputeUnitLimit = true;
      
      // Request quote
      const response = await axios.get(`${this.config.JUPITER_API.BASE_URL}${this.config.JUPITER_API.QUOTE}`, {
        params,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.JUPITER_API.API_KEY
        }
      });
      
      if (!response.data) {
        throw new Error('No data returned from Jupiter API');
      }
      
      // Store and return the quote
      this.state.lastQuote = response.data;
      
      // Properly format the quote amounts with decimals
      const inputDecimals = response.data.inputDecimals;
      const outputDecimals = response.data.outputDecimals;
      
      const formattedQuote = {
        ...response.data,
        inputAmount: parseFloat(response.data.inAmount) / Math.pow(10, inputDecimals),
        outputAmount: parseFloat(response.data.outAmount) / Math.pow(10, outputDecimals),
        otherAmountThreshold: parseFloat(response.data.otherAmountThreshold) / Math.pow(10, exactOut ? inputDecimals : outputDecimals),
        raw: response.data
      };
      
      return formattedQuote;
    } catch (error) {
      console.log(`${fancyColors.RED}Error getting quote: ${error.message}${fancyColors.RESET}`);
      if (error.response) {
        console.log(`${fancyColors.RED}API Response: ${JSON.stringify(error.response.data)}${fancyColors.RESET}`);
      }
      return null;
    }
  }
  
  /**
   * Create swap transaction instructions
   */
  async createSwapTransaction(quote, userPublicKey) {
    try {
      if (!quote) {
        throw new Error('Quote is required');
      }
      
      console.log(`${fancyColors.BLUE}Creating swap transaction...${fancyColors.RESET}`);
      
      // Set up transaction parameters
      const swapParams = {
        quoteResponse: quote.raw,
        userPublicKey,
        dynamicComputeUnitLimit: true,
        asLegacyTransaction: false, // Use versioned transactions
      };
      
      // Add Jito tip for faster processing (optional)
      if (this.config.TRANSACTION.USE_PRIORITY_FEE) {
        swapParams.prioritizationFeeLamports = '10000'; // 0.00001 SOL
      }
      
      // Request transaction data
      const response = await axios.post(`${this.config.JUPITER_API.BASE_URL}${this.config.JUPITER_API.SWAP_INSTRUCTIONS}`, swapParams, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.JUPITER_API.API_KEY
        }
      });
      
      if (!response.data || !response.data.swapTransaction) {
        throw new Error('No transaction data returned from Jupiter API');
      }
      
      return {
        swapTransaction: response.data.swapTransaction,
        lastValidBlockHeight: response.data.lastValidBlockHeight,
        quote: quote
      };
    } catch (error) {
      console.log(`${fancyColors.RED}Error creating transaction: ${error.message}${fancyColors.RESET}`);
      if (error.response) {
        console.log(`${fancyColors.RED}API Response: ${JSON.stringify(error.response.data)}${fancyColors.RESET}`);
      }
      return null;
    }
  }
  
  /**
   * Prepare swap transaction instructions for signing
   * NOTE: This just shows the JSON structure, not the actual signing and sending
   */
  prepareTransactionForSigning(transactionData) {
    // In a real application, you would:
    // 1. Deserialize the transaction from the base64 string
    // 2. Sign it with the wallet
    // 3. Serialize it back to base64
    // 4. Send it to the network
    
    return {
      base64Transaction: transactionData.swapTransaction,
      lastValidBlockHeight: transactionData.lastValidBlockHeight,
      // This would contain the deserialized transaction details in a real app
      deserializedTransaction: {
        version: 0,
        feePayer: this.state.walletAddress,
        instructions: [
          { programId: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB', data: '...' },
          // Other instructions...
        ],
      },
      // Steps needed to complete the transaction:
      requiredSteps: [
        '1. Deserialize the base64 transaction',
        '2. Have the wallet sign the transaction',
        '3. Serialize the signed transaction',
        '4. Send it to the Solana network',
        '5. Wait for confirmation'
      ]
    };
  }
  
  /**
   * Interactive method to get a quote
   */
  async performGetQuote() {
    console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} GET QUOTE ${fancyColors.RESET}`);
    
    // For demo purposes, hardcode a buy quote from USDC to token
    try {
      const inputAmount = 10 * 1000000; // 10 USDC with 6 decimals
      const quote = await this.getQuote(
        this.config.USDC_ADDRESS,
        this.tokenAddress,
        inputAmount,
        false
      );
      
      if (!quote) {
        throw new Error('Failed to get quote');
      }
      
      console.log(`${fancyColors.GREEN}Quote received:${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Input: ${quote.inputAmount.toFixed(2)} USDC${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Output: ${quote.outputAmount.toFixed(6)} tokens${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Price impact: ${format.percentage(quote.priceImpactPct)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Minimum output (with slippage): ${quote.otherAmountThreshold.toFixed(6)} tokens${fancyColors.RESET}`);
      
    } catch (error) {
      console.log(`${fancyColors.RED}Error: ${error.message}${fancyColors.RESET}`);
    }
    
    setTimeout(() => this.displayMainMenu(), 3000);
  }
  
  /**
   * Interactive method to create a swap transaction
   */
  async performCreateSwapTransaction() {
    console.log(`\n${fancyColors.BG_BLUE}${fancyColors.WHITE} CREATE SWAP TRANSACTION ${fancyColors.RESET}`);
    
    try {
      // Get a fresh quote
      const inputAmount = 10 * 1000000; // 10 USDC with 6 decimals
      const quote = await this.getQuote(
        this.config.USDC_ADDRESS,
        this.tokenAddress,
        inputAmount,
        false
      );
      
      if (!quote) {
        throw new Error('Failed to get quote');
      }
      
      // Create transaction
      const transaction = await this.createSwapTransaction(quote, this.state.walletAddress);
      
      if (!transaction) {
        throw new Error('Failed to create transaction');
      }
      
      // Prepare transaction for signing (this is just for demonstration)
      const preparedTransaction = this.prepareTransactionForSigning(transaction);
      
      console.log(`${fancyColors.GREEN}Transaction created successfully:${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Transaction size: ${transaction.swapTransaction.length} bytes${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Last valid block height: ${transaction.lastValidBlockHeight}${fancyColors.RESET}`);
      console.log('');
      console.log(`${fancyColors.YELLOW}To complete this transaction, you would:${fancyColors.RESET}`);
      preparedTransaction.requiredSteps.forEach((step, index) => {
        console.log(`${fancyColors.YELLOW}${index + 1}. ${step}${fancyColors.RESET}`);
      });
      
    } catch (error) {
      console.log(`${fancyColors.RED}Error: ${error.message}${fancyColors.RESET}`);
    }
    
    setTimeout(() => this.displayMainMenu(), 5000);
  }
  
  /**
   * Toggle market making mode
   */
  toggleMarketMaking() {
    if (this.state.marketMaking.isActive) {
      // Stop market making
      this.state.marketMaking.isActive = false;
      console.log(`${fancyColors.BG_RED}${fancyColors.WHITE} MARKET MAKING STOPPED ${fancyColors.RESET}`);
      
      // Display stats
      const duration = (Date.now() - this.state.marketMaking.startTimestamp) / 1000;
      console.log(`${fancyColors.YELLOW}Market making ran for ${Math.floor(duration / 60)} minutes ${Math.floor(duration % 60)} seconds${fancyColors.RESET}`);
      console.log(`${fancyColors.YELLOW}Buys: ${this.state.marketMaking.metrics.buys}${fancyColors.RESET}`);
      console.log(`${fancyColors.YELLOW}Sells: ${this.state.marketMaking.metrics.sells}${fancyColors.RESET}`);
      console.log(`${fancyColors.YELLOW}Volume: ${this.state.marketMaking.metrics.volumeUsdc} USDC${fancyColors.RESET}`);
      
      // Clear any pending timers
      if (this.marketMakingTimer) {
        clearTimeout(this.marketMakingTimer);
        this.marketMakingTimer = null;
      }
    } else {
      // Start market making
      this.state.marketMaking.isActive = true;
      this.state.marketMaking.startTimestamp = Date.now();
      this.state.marketMaking.metrics = {
        buys: 0,
        sells: 0,
        volumeUsdc: 0
      };
      
      console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} MARKET MAKING STARTED ${fancyColors.RESET}`);
      
      // Display market making configuration
      console.log(`${fancyColors.YELLOW}Spread: ${format.percentage(this.config.MARKET_MAKING.SPREAD)}${fancyColors.RESET}`);
      console.log(`${fancyColors.YELLOW}Order size: ${this.config.MARKET_MAKING.BASE_ORDER_SIZE_USDC} USDC${fancyColors.RESET}`);
      console.log(`${fancyColors.YELLOW}Refresh interval: ${this.config.MARKET_MAKING.REFRESH_INTERVAL} seconds${fancyColors.RESET}`);
      
      // Start the market making loop
      this.performMarketMaking();
    }
    
    setTimeout(() => this.displayMainMenu(), 3000);
  }
  
  /**
   * Perform market making operations
   */
  async performMarketMaking() {
    if (!this.state.marketMaking.isActive) {
      return;
    }
    
    try {
      // Refresh token price
      await this.getTokenInfo();
      
      // Calculate buy and sell prices based on spread
      const currentPrice = this.state.currentPrice;
      const buyPrice = currentPrice * (1 - this.config.MARKET_MAKING.SPREAD);
      const sellPrice = currentPrice * (1 + this.config.MARKET_MAKING.SPREAD);
      
      console.log(`${fancyColors.BLUE}Market Making Cycle:${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Current price: ${format.price(currentPrice)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Buy price: ${format.price(buyPrice)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Sell price: ${format.price(sellPrice)}${fancyColors.RESET}`);
      
      // Calculate token amounts
      const orderSizeUsdc = this.config.MARKET_MAKING.BASE_ORDER_SIZE_USDC;
      const tokensToBuy = orderSizeUsdc / buyPrice;
      const tokensToSell = orderSizeUsdc / currentPrice;
      
      console.log(`${fancyColors.GREEN}Buy order: ${format.amount(tokensToBuy)} tokens @ ${format.price(buyPrice)}${fancyColors.RESET}`);
      console.log(`${fancyColors.GREEN}Sell order: ${format.amount(tokensToSell)} tokens @ ${format.price(sellPrice)}${fancyColors.RESET}`);
      
      // In a real implementation, here you would:
      // 1. Cancel any existing orders
      // 2. Get quotes for buy and sell
      // 3. Create transactions for both
      // 4. Sign and send the transactions
      
      // Simulate some random market activity
      if (Math.random() > 0.5) {
        this.state.marketMaking.metrics.buys++;
        this.state.marketMaking.metrics.volumeUsdc += orderSizeUsdc;
        console.log(`${fancyColors.BG_GREEN}${fancyColors.BLACK} BUY ORDER FILLED ${fancyColors.RESET}`);
      }
      
      if (Math.random() > 0.5) {
        this.state.marketMaking.metrics.sells++;
        this.state.marketMaking.metrics.volumeUsdc += orderSizeUsdc;
        console.log(`${fancyColors.BG_RED}${fancyColors.BLACK} SELL ORDER FILLED ${fancyColors.RESET}`);
      }
      
      // Display cumulative stats
      console.log(`${fancyColors.YELLOW}Stats - Buys: ${this.state.marketMaking.metrics.buys}, Sells: ${this.state.marketMaking.metrics.sells}, Volume: ${this.state.marketMaking.metrics.volumeUsdc} USDC${fancyColors.RESET}`);
      
      // Schedule next cycle
      console.log(`${fancyColors.BLUE}Next refresh in ${this.config.MARKET_MAKING.REFRESH_INTERVAL} seconds...${fancyColors.RESET}`);
      
      this.marketMakingTimer = setTimeout(() => this.performMarketMaking(), this.config.MARKET_MAKING.REFRESH_INTERVAL * 1000);
    } catch (error) {
      console.log(`${fancyColors.RED}Market making error: ${error.message}${fancyColors.RESET}`);
      
      // Still continue with next cycle despite errors
      this.marketMakingTimer = setTimeout(() => this.performMarketMaking(), this.config.MARKET_MAKING.REFRESH_INTERVAL * 1000);
    }
  }
}

// Run the executor
(async () => {
  const executor = new JupiterSwapExecutor(TOKEN_ADDRESS, CONFIG);
  if (await executor.initialize()) {
    await executor.run();
  }
})();

// Note: This script is a demonstration of the Jupiter API integration.
// It creates ready-to-sign transactions but does not actually sign or send them.