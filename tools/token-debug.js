// Debug token data issues
import prisma from '../config/prisma.js';

async function debugTokens() {
  try {
    // Get top 10 tokens with prices
    console.log("Fetching tokens with prices...");
    const tokensWithPrice = await prisma.tokens.findMany({
      where: {
        token_prices: {
          price: { not: null }
        }
      },
      include: {
        token_prices: true
      },
      orderBy: [
        { token_prices: { price: 'desc' } }
      ],
      take: 10
    });
    
    console.log(`Found ${tokensWithPrice.length} tokens with prices`);
    
    // Display them
    tokensWithPrice.forEach(token => {
      console.log(`Symbol: ${token.symbol}, Price: ${token.token_prices?.price}, Address: ${token.address}`);
    });

    // Get top tokens by market cap
    console.log("\nFetching tokens by market cap...");
    const topByMarketCap = await prisma.tokens.findMany({
      include: {
        token_prices: true
      },
      orderBy: [
        { token_prices: { market_cap: 'desc' } }
      ],
      take: 10
    });
    
    console.log(`Found ${topByMarketCap.length} tokens sorted by market cap`);
    
    // Display them
    topByMarketCap.forEach(token => {
      console.log(`Symbol: ${token.symbol}, Market Cap: ${token.token_prices?.market_cap}, Price: ${token.token_prices?.price}`);
    });
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

debugTokens();