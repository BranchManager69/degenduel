import { prisma } from './config/prisma.js';

console.log('Checking recent token updates...\n');

// Get most recently updated tokens
const recentUpdates = await prisma.token_prices.findMany({
  where: {
    updated_at: {
      gte: new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
    }
  },
  include: {
    token: {
      select: {
        address: true,
        symbol: true,
        is_active: true
      }
    }
  },
  orderBy: {
    updated_at: 'desc'
  },
  take: 20
});

console.log(`Found ${recentUpdates.length} tokens updated in last 10 minutes:`);
recentUpdates.forEach((update, i) => {
  const token = update.token;
  console.log(`${i+1}. ${token.symbol || 'Unknown'} (${token.address.slice(0,8)}...) - $${update.price} - Active: ${token.is_active} - ${update.updated_at.toLocaleTimeString()}`);
});

// Check for tokens that were recently marked inactive
const recentlyInactive = await prisma.tokens.findMany({
  where: {
    is_active: false,
    updated_at: {
      gte: new Date(Date.now() - 10 * 60 * 1000) // Last 10 minutes
    }
  },
  select: {
    address: true,
    symbol: true,
    updated_at: true
  },
  orderBy: {
    updated_at: 'desc'
  },
  take: 10
});

console.log(`\nTokens marked inactive in last 10 minutes: ${recentlyInactive.length}`);
recentlyInactive.forEach((token, i) => {
  console.log(`${i+1}. ${token.symbol || 'Unknown'} (${token.address.slice(0,8)}...) - Deactivated: ${token.updated_at.toLocaleTimeString()}`);
});

process.exit(0); 