/**
 * Fix token_price_history source values
 * This script standardizes all price history source values to "jupiter_api"
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTokenHistorySources() {
  console.log("🔧 Starting database fix for token_price_history sources");
  
  // Get counts before changes
  const beforeCounts = await prisma.$queryRaw`
    SELECT source, COUNT(*) as count FROM token_price_history GROUP BY source ORDER BY count DESC
  `;
  
  console.log("Current source values in database:");
  console.table(beforeCounts);
  
  // Fix jupiter_api_initial
  console.log("\n🔄 Updating 'jupiter_api_initial' to 'jupiter_api'...");
  const initialFixed = await prisma.$executeRaw`
    UPDATE token_price_history SET source = 'jupiter_api' WHERE source = 'jupiter_api_initial'
  `;
  console.log(`✅ Updated ${initialFixed} records from 'jupiter_api_initial' to 'jupiter_api'`);
  
  // Fix initial_sync
  console.log("\n🔄 Updating 'initial_sync' to 'jupiter_api'...");
  const syncFixed = await prisma.$executeRaw`
    UPDATE token_price_history SET source = 'jupiter_api' WHERE source = 'initial_sync'
  `;
  console.log(`✅ Updated ${syncFixed} records from 'initial_sync' to 'jupiter_api'`);
  
  // Get counts after changes
  const afterCounts = await prisma.$queryRaw`
    SELECT source, COUNT(*) as count FROM token_price_history GROUP BY source ORDER BY count DESC
  `;
  
  console.log("\nFinal source values in database:");
  console.table(afterCounts);
  
  console.log("\n✅ Database fix completed successfully!");
}

fixTokenHistorySources()
  .catch(e => {
    console.error("❌ Error fixing token history sources:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });