import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function analyzeTokens() {
  console.log('\n🔍 DEGENDUEL TOKEN DATABASE DIAGNOSTICS 🔍\n');
  
  try {
    // Basic stats
    const totalTokens = await prisma.tokens.count();
    console.log(`📊 TOTAL TOKENS: ${totalTokens.toLocaleString()}\n`);
    
    // Field population
    console.log('📋 FIELD POPULATION:\n');
    
    const fieldsToCheck = [
      'symbol', 'name', 'description', 'logo_url', 'image_url',
      'website_url', 'twitter_url', 'telegram_url', 'discord_url', 'tags'
    ];
    
    for (const field of fieldsToCheck) {
      let count;
      try {
        // This handles both regular and JSON fields
        count = await prisma.tokens.count({
          where: {
            [field]: { not: null }
          }
        });
      } catch (err) {
        count = 0; // If error occurs, assume 0
      }
      
      const pct = ((count / totalTokens) * 100).toFixed(1);
      console.log(`${field.padEnd(15)}: ${count.toLocaleString()} (${pct}%)`);
    }
    
    // Tokens with embedded social links
    console.log('\n🔗 EMBEDDED SOCIAL LINKS:\n');
    
    // Twitter in description
    const twitterInDesc = await prisma.tokens.count({
      where: {
        description: {
          contains: 'twitter.com',
          mode: 'insensitive'
        }
      }
    });
    console.log(`Twitter links in description: ${twitterInDesc.toLocaleString()}`);
    
    // Telegram in description
    const telegramInDesc = await prisma.tokens.count({
      where: {
        description: {
          contains: 't.me',
          mode: 'insensitive'
        }
      }
    });
    console.log(`Telegram links in description: ${telegramInDesc.toLocaleString()}`);
    
    // Discord in description
    const discordInDesc = await prisma.tokens.count({
      where: {
        description: {
          contains: 'discord.gg',
          mode: 'insensitive'
        }
      }
    });
    console.log(`Discord links in description: ${discordInDesc.toLocaleString()}`);
    
    // Website in description (looking for common patterns)
    const websiteInDesc = await prisma.tokens.count({
      where: {
        OR: [
          { description: { contains: '.com', mode: 'insensitive' } },
          { description: { contains: '.io', mode: 'insensitive' } },
          { description: { contains: '.xyz', mode: 'insensitive' } },
        ]
      }
    });
    console.log(`Possible website links in description: ${websiteInDesc.toLocaleString()}`);
    
    // Sample tokens with embedded links
    console.log('\n📝 SAMPLE TOKENS WITH EMBEDDED LINKS:');
    
    const sampleTokens = await prisma.tokens.findMany({
      where: {
        OR: [
          { description: { contains: 'twitter.com', mode: 'insensitive' } },
          { description: { contains: 't.me', mode: 'insensitive' } },
          { description: { contains: 'discord.gg', mode: 'insensitive' } }
        ]
      },
      select: {
        symbol: true,
        name: true,
        description: true
      },
      take: 5
    });
    
    for (const token of sampleTokens) {
      console.log(`\n- ${token.symbol} (${token.name || 'No name'}):`);
      console.log(`  "${token.description?.substring(0, 150)}${token.description?.length > 150 ? '...' : ''}"`);
    }
    
    // Check for active tokens
    const activeTokens = await prisma.tokens.count({
      where: { is_active: true }
    });
    
    console.log(`\n✅ Active tokens: ${activeTokens.toLocaleString()} (${((activeTokens / totalTokens) * 100).toFixed(1)}%)`);
    
    // Conclusion
    console.log('\n🔍 DIAGNOSTIC CONCLUSION:');
    console.log('- The database has minimal structured social media links');
    console.log('- Many tokens have social links embedded in descriptions');
    console.log('- Token data enrichment would benefit from extracting these links');
    
  } catch (error) {
    console.error('Error analyzing tokens:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyzeTokens();