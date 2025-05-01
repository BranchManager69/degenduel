/**
 * @file Example token price publisher
 * @description Shows how to publish token price updates
 */

import prisma from '../../../config/prisma.js';
import realtime from '../index.js';
import { TOKEN_CHANNELS } from '../channels.js';

/**
 * Update a token price and publish the event
 * @param {number} tokenId - Token ID
 * @param {string} tokenAddress - Token address 
 * @param {number|string} newPrice - New token price
 * @param {string} source - Source of price update
 */
export async function updateTokenPrice(tokenId, tokenAddress, newPrice, source = 'jupiter') {
  try {
    // Get current price for comparison
    const currentToken = await prisma.tokens.findUnique({
      where: { id: tokenId },
      select: {
        token_prices: {
          select: {
            price: true
          }
        }
      }
    });
    
    const oldPrice = currentToken?.token_prices?.price || 0;
    
    // Calculate percent change
    const changePercent = oldPrice > 0 
      ? ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice)) * 100
      : 0;
    
    // Update price in database using transaction
    await prisma.$transaction([
      // Update tokens table with last price change timestamp
      prisma.tokens.update({
        where: { id: tokenId },
        data: { 
          last_price_change: new Date()
        }
      }),
      
      // Update or create price record
      prisma.token_prices.upsert({
        where: { token_id: tokenId },
        create: {
          token_id: tokenId,
          price: newPrice,
          updated_at: new Date()
        },
        update: {
          price: newPrice, 
          updated_at: new Date()
        }
      }),
      
      // Add to price history
      prisma.token_price_history.create({
        data: {
          token_id: tokenId,
          price: newPrice,
          source: source,
          timestamp: new Date()
        }
      })
    ]);
    
    // Only publish if price actually changed
    if (String(newPrice) !== String(oldPrice)) {
      // Publish event
      await realtime.publish(TOKEN_CHANNELS.PRICE, {
        id: tokenId,
        address: tokenAddress,
        price: newPrice,
        previousPrice: oldPrice,
        changePercent: parseFloat(changePercent.toFixed(2)),
        timestamp: Date.now(),
        source
      });
    }
    
    return {
      success: true,
      oldPrice,
      newPrice,
      changePercent
    };
  } catch (err) {
    console.error('Error updating token price:', err);
    throw err;
  }
}