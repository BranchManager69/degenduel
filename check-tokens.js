// check-tokens.js
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkTokens() {
  try {
    console.log('Checking tokens table...');
    
    // Count total tokens
    const totalTokens = await prisma.tokens.count();
    console.log('Total tokens:', totalTokens);
    
    // Count active tokens
    const activeTokens = await prisma.tokens.count({
      where: { is_active: true }
    });
    console.log('Active tokens:', activeTokens);
    
    // Count tokens with priority score >= 50 (regardless of active status)
    const highPriorityTokens = await prisma.tokens.count({
      where: {
        priority_score: { gte: 50 }
      }
    });
    console.log('Tokens with priority score >= 50:', highPriorityTokens);

    // Count tokens with pools (regardless of active status)
    const tokensWithPools = await prisma.tokens.count({
      where: {
        pools: { some: {} }
      }
    });
    console.log('Tokens with pools:', tokensWithPools);

    // Count high priority tokens with pools
    const highPriorityTokensWithPools = await prisma.tokens.count({
      where: {
        priority_score: { gte: 50 },
        pools: { some: {} }
      }
    });
    console.log('High priority tokens with pools:', highPriorityTokensWithPools);
    
    // Get token with pool data
    if (tokensWithPools > 0) {
      const tokenWithPool = await prisma.tokens.findFirst({
        where: {
          pools: { some: {} }
        },
        select: {
          id: true,
          address: true,
          symbol: true,
          priority_score: true,
          pools: {
            select: {
              address: true,
              dex: true,
              programId: true
            }
          }
        }
      });
      console.log('Token with pool:', JSON.stringify(tokenWithPool, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();