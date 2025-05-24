import { prisma } from './config/prisma.js';

async function estimateActiveTokens() {
  console.log('🔍 Analyzing tokens with TokenActivationService criteria...\n');

  try {
    // Current state
    const currentActive = await prisma.tokens.count({ where: { is_active: true } });
    const totalTokens = await prisma.tokens.count();
    const manuallyActivated = await prisma.tokens.count({ where: { manually_activated: true } });
    const withPriceData = await prisma.tokens.count({
      where: { token_prices: { isNot: null } }
    });

    // Tier 1: New tokens (last 3 days) - $50k MC + $50k Vol
    const tier1 = await prisma.tokens.count({
      where: {
        first_seen_on_jupiter_at: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
        token_prices: {
          market_cap: { gte: 50000 },
          volume_24h: { gte: 50000 }
        }
      }
    });

    // Tier 2: Recent tokens (3-72 days) - $100k MC + $50k Vol  
    const tier2 = await prisma.tokens.count({
      where: {
        first_seen_on_jupiter_at: {
          lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          gte: new Date(Date.now() - 72 * 24 * 60 * 60 * 1000)
        },
        token_prices: {
          market_cap: { gte: 100000 },
          volume_24h: { gte: 50000 }
        }
      }
    });

    // Tier 3: Established tokens (>72 days) - $250k MC + $50k Vol
    const tier3 = await prisma.tokens.count({
      where: {
        first_seen_on_jupiter_at: { lt: new Date(Date.now() - 72 * 24 * 60 * 60 * 1000) },
        token_prices: {
          market_cap: { gte: 250000 },
          volume_24h: { gte: 50000 }
        }
      }
    });

    // Total estimated active (all criteria combined)
    const estimatedActive = await prisma.tokens.count({
      where: {
        OR: [
          { manually_activated: true },
          {
            AND: [
              { first_seen_on_jupiter_at: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
              { token_prices: { market_cap: { gte: 50000 }, volume_24h: { gte: 50000 } } }
            ]
          },
          {
            AND: [
              { first_seen_on_jupiter_at: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
              { first_seen_on_jupiter_at: { gte: new Date(Date.now() - 72 * 24 * 60 * 60 * 1000) } },
              { token_prices: { market_cap: { gte: 100000 }, volume_24h: { gte: 50000 } } }
            ]
          },
          {
            AND: [
              { first_seen_on_jupiter_at: { lt: new Date(Date.now() - 72 * 24 * 60 * 60 * 1000) } },
              { token_prices: { market_cap: { gte: 250000 }, volume_24h: { gte: 50000 } } }
            ]
          }
        ]
      }
    });

    // Display results
    console.log('📊 Current Database State:');
    console.log(`├─ Current Active Tokens: ${currentActive.toLocaleString()}`);
    console.log(`├─ Total Tokens: ${totalTokens.toLocaleString()}`);
    console.log(`├─ Manually Activated: ${manuallyActivated.toLocaleString()}`);
    console.log(`└─ Tokens with Price Data: ${withPriceData.toLocaleString()}\n`);

    console.log('🎯 TokenActivationService Criteria Analysis:');
    console.log(`├─ Tier 1 Eligible (New 3d, $50k MC+Vol): ${tier1.toLocaleString()}`);
    console.log(`├─ Tier 2 Eligible (Recent, $100k MC+$50k Vol): ${tier2.toLocaleString()}`);
    console.log(`├─ Tier 3 Eligible (Established, $250k MC+$50k Vol): ${tier3.toLocaleString()}`);
    console.log(`└─ Manual Override: ${manuallyActivated.toLocaleString()}\n`);

    console.log('🚀 ESTIMATED RESULT AFTER RESET:');
    console.log(`📈 Estimated Active Tokens: ${estimatedActive.toLocaleString()}`);
    console.log(`📊 Percentage of Total: ${((estimatedActive / totalTokens) * 100).toFixed(2)}%`);
    console.log(`📉 Change from Current: ${estimatedActive - currentActive > 0 ? '+' : ''}${(estimatedActive - currentActive).toLocaleString()}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

estimateActiveTokens(); 