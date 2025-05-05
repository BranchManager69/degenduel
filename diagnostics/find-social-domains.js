// diagnostics/find-social-domains.js

// Run with:
// node diagnostics/find-social-domains.js

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function findAllDomains() {
  // Get all descriptions that might contain URLs
  const tokens = await prisma.tokens.findMany({
    where: { 
      description: { 
        not: null,
        contains: '.'  // Simple filter for possible URLs
      } 
    },
    select: { description: true }
  });
  
  console.log(`Analyzing ${tokens.length} token descriptions for URLs...`);
  
  // Extract all URLs from descriptions
  const urlRegex = /https?:\/\/(?:www\.)?([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,})(?:\/[^\s]*)?/gi;
  const domains = {};
  
  for (const token of tokens) {
    if (!token.description) continue;
    
    const matches = token.description.match(urlRegex);
    if (!matches) continue;
    
    for (const url of matches) {
      try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        domains[domain] = (domains[domain] || 0) + 1;
      } catch (e) {
        // Invalid URL, skip
      }
    }
  }
  
  // Sort by frequency and print
  const sortedDomains = Object.entries(domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);  // Top 50 domains
  
  console.log('\nTop domains in token descriptions:');
  for (const [domain, count] of sortedDomains) {
    console.log(`${domain}: ${count}`);
  }
  
  await prisma.$disconnect();
}

findAllDomains().catch(e => {
  console.error(e);
  process.exit(1);
});