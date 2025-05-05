import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkTokens() {
  try {
    const totalTokens = await prisma.tokens.count();
    console.log(`Total tokens in database: ${totalTokens}`);
    
    const tokensWithDescription = await prisma.tokens.count({ 
      where: { description: { not: null } } 
    });
    console.log(`Tokens with descriptions: ${tokensWithDescription}`);
    
    // Get sample tokens with descriptions
    const tokenSample = await prisma.tokens.findMany({ 
      where: { description: { not: null } }, 
      take: 3,
      select: {
        symbol: true,
        description: true
      }
    });
    
    console.log('Sample tokens with descriptions:');
    for (const token of tokenSample) {
      const desc = token.description || '';
      console.log(`- ${token.symbol}: ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`);
    }
    
    const tokensWithTwitter = await prisma.tokens.count({ 
      where: { twitter_url: { not: null } } 
    });
    console.log(`\nTokens with Twitter URLs: ${tokensWithTwitter}`);
    
    const tokensWithWebsite = await prisma.tokens.count({ 
      where: { website_url: { not: null } } 
    });
    console.log(`Tokens with Website URLs: ${tokensWithWebsite}`);
    
    const tokensWithTelegram = await prisma.tokens.count({ 
      where: { telegram_url: { not: null } } 
    });
    console.log(`Tokens with Telegram URLs: ${tokensWithTelegram}`);
    
    const tokensWithDiscord = await prisma.tokens.count({ 
      where: { discord_url: { not: null } } 
    });
    console.log(`Tokens with Discord URLs: ${tokensWithDiscord}`);
    
    // Count tokens with tags
    const tokensWithTags = await prisma.tokens.count({ 
      where: { tags: { not: null } } 
    });
    console.log(`Tokens with tags: ${tokensWithTags}`);
    
    // Get a few tokens with the most data
    console.log("\nTokens with rich data:");
    const richTokens = await prisma.tokens.findMany({
      where: {
        AND: [
          { twitter_url: { not: null } },
          { website_url: { not: null } },
          { description: { not: null } }
        ]
      },
      select: {
        symbol: true,
        name: true,
        twitter_url: true,
        website_url: true,
        telegram_url: true,
        discord_url: true
      },
      take: 5
    });
    
    for (const token of richTokens) {
      console.log(`- ${token.symbol} (${token.name}):`);
      console.log(`  Twitter: ${token.twitter_url}`);
      console.log(`  Website: ${token.website_url}`);
      if (token.telegram_url) console.log(`  Telegram: ${token.telegram_url}`);
      if (token.discord_url) console.log(`  Discord: ${token.discord_url}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

checkTokens();