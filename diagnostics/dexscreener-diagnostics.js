#!/usr/bin/env node
/**
 * DexScreener Data Diagnostics
 * 
 * Analyzes tokens enriched by DexScreener API in the database.
 * Focuses on social links stored in token_socials table vs. main token fields.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Set up command line interface
const args = process.argv.slice(2);
const command = args[0] || 'all';

/**
 * Main diagnostic function
 */
async function runDiagnostics() {
  console.log('\n🔍 DEXSCREENER DATA DIAGNOSTICS 🔍\n');
  
  try {
    switch (command) {
      case 'basic':
        await runBasicStats();
        break;
        
      case 'social':
        await runSocialAnalysis();
        break;
        
      case 'all':
      default:
        console.log('=== RUNNING COMPLETE DEXSCREENER ANALYSIS ===\n');
        await runBasicStats();
        console.log('\n');
        await runSocialAnalysis();
        console.log('\n=== ANALYSIS COMPLETE ===');
        break;
    }
  } catch (error) {
    console.error('Error running diagnostics:', error);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Run basic DexScreener token stats
 */
async function runBasicStats() {
  console.log('📊 DEXSCREENER INTEGRATION STATS\n');
  
  // Count total tokens with prices (DexScreener provides price data)
  const totalTokens = await prisma.tokens.count();
  const tokensWithPrices = await prisma.token_prices.count();
  
  console.log(`Total tokens in database: ${totalTokens.toLocaleString()}`);
  console.log(`Tokens with price data: ${tokensWithPrices.toLocaleString()} (${((tokensWithPrices / totalTokens) * 100).toFixed(1)}%)`);
  
  // Check for tokens with recent price updates
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  const recentPriceUpdates = await prisma.token_prices.count({
    where: {
      updated_at: { gte: oneDayAgo }
    }
  });
  
  console.log(`Price updates in the last 24 hours: ${recentPriceUpdates.toLocaleString()}`);
  
  // Sample most active tokens with price data
  console.log('\nMost recent price updates:');
  const recentTokens = await prisma.tokens.findMany({
    where: {
      token_prices: {
        updated_at: { gte: oneDayAgo }
      }
    },
    select: {
      symbol: true,
      name: true,
      token_prices: {
        select: {
          price: true,
          updated_at: true
        }
      }
    },
    orderBy: {
      token_prices: {
        updated_at: 'desc'
      }
    },
    take: 5
  });
  
  for (const token of recentTokens) {
    console.log(`- ${token.symbol} (${token.name || 'Unknown'}): $${parseFloat(token.token_prices?.price || '0').toFixed(6)} - Updated: ${token.token_prices?.updated_at.toISOString()}`);
  }
}

/**
 * Analyze social data from DexScreener
 */
async function runSocialAnalysis() {
  console.log('🔗 DEXSCREENER SOCIAL DATA ANALYSIS\n');
  
  // Count tokens with social links in token_socials table
  const tokensWithSocialLinks = await prisma.token_socials.groupBy({
    by: ['token_id'],
    _count: {
      _all: true
    }
  });
  
  const uniqueTokensWithSocials = tokensWithSocialLinks.length;
  
  // Count total tokens
  const totalTokens = await prisma.tokens.count();
  
  console.log(`Tokens with social links in token_socials table: ${uniqueTokensWithSocials.toLocaleString()} (${((uniqueTokensWithSocials / totalTokens) * 100).toFixed(1)}%)`);
  
  // Social link types distribution
  console.log('\nSocial link types distribution:');
  const socialLinkTypes = await prisma.token_socials.groupBy({
    by: ['type'],
    _count: {
      token_id: true
    },
    orderBy: {
      _count: {
        token_id: 'desc'
      }
    }
  });
  
  for (const type of socialLinkTypes) {
    console.log(`- ${type.type.padEnd(10)}: ${type._count.token_id.toLocaleString()} tokens`);
  }
  
  // Social link details
  console.log('\nSocial links by type:');
  
  // Twitter links
  const twitterLinks = await prisma.token_socials.count({
    where: { type: 'twitter' }
  });
  console.log(`- Twitter links: ${twitterLinks.toLocaleString()} tokens`);
  
  // Website links
  const websiteLinks = await prisma.token_socials.count({
    where: { type: 'website' }
  });
  console.log(`- Website links: ${websiteLinks.toLocaleString()} tokens`);
  
  // Website links in dedicated table
  const websitesInTable = await prisma.token_websites.count();
  console.log(`- Website links in token_websites table: ${websitesInTable.toLocaleString()} tokens`);
  
  // Telegram links
  const telegramLinks = await prisma.token_socials.count({
    where: { type: 'telegram' }
  });
  console.log(`- Telegram links: ${telegramLinks.toLocaleString()} tokens`);
  
  // Discord links
  const discordLinks = await prisma.token_socials.count({
    where: { type: 'discord' }
  });
  console.log(`- Discord links: ${discordLinks.toLocaleString()} tokens`);
  
  // Sample tokens with social data
  console.log('\nSample tokens with social links:');
  const tokensWithSocials = await prisma.tokens.findMany({
    where: {
      token_socials: {
        some: {}
      }
    },
    select: {
      symbol: true,
      name: true,
      token_socials: {
        select: {
          type: true,
          url: true
        }
      },
      token_websites: {
        select: {
          label: true,
          url: true
        }
      }
    },
    take: 5
  });
  
  for (const token of tokensWithSocials) {
    console.log(`\n- ${token.symbol} (${token.name || 'Unknown'}):`);
    
    // Show token_socials
    console.log(`  Social links:`);
    if (token.token_socials && token.token_socials.length > 0) {
      for (const social of token.token_socials) {
        console.log(`    ${social.type}: ${social.url}`);
      }
    } else {
      console.log(`    None`);
    }
    
    // Show token_websites
    console.log(`  Websites:`);
    if (token.token_websites && token.token_websites.length > 0) {
      for (const website of token.token_websites) {
        console.log(`    ${website.label || 'Unknown'}: ${website.url}`);
      }
    } else {
      console.log(`    None`);
    }
  }
}

// Show help if requested
if (command === 'help') {
  console.log(`
DexScreener Data Diagnostics

USAGE:
  node dexscreener-diagnostics.js [command]

COMMANDS:
  basic    Basic stats on DexScreener integration
  social   Analyze social data issues between tables
  all      Run all diagnostics (default)
  help     Show this help message
  `);
} else {
  // Run the diagnostics
  runDiagnostics();
}