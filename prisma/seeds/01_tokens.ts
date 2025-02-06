import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { TOKEN_BUCKET_THRESHOLDS, TOKEN_VALIDATION } from '../../config/constants.js';

const prisma = new PrismaClient();

// Token data interface
interface TokenData {
  contractAddress: string;
  symbol: string;
  name: string;
  marketCap: string | null;
  price: string | null;
  volume24h: string | null;
  change_h24: number | null;
  liquidity_usd: number | null;
  imageUrl?: string;
  socials?: {
    twitter?: string;
    telegram?: string;
    discord?: string;
  };
  websites?: string[];
  description?: string;
}

// Validation functions
function validateUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsedUrl = new URL(url);
    if (!TOKEN_VALIDATION.URLS.ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
      console.warn(`Invalid protocol for URL: ${url}`);
      return null;
    }
    if (url.length > TOKEN_VALIDATION.URLS.MAX_LENGTH) {
      console.warn(`URL too long: ${url}`);
      return null;
    }
    return url;
  } catch {
    console.warn(`Invalid URL: ${url}`);
    return null;
  }
}

function validateDescription(desc: string | undefined): string | null {
  if (!desc) return null;
  const trimmed = desc.trim();
  return trimmed.length > TOKEN_VALIDATION.DESCRIPTION.MAX_LENGTH 
    ? trimmed.substring(0, TOKEN_VALIDATION.DESCRIPTION.MAX_LENGTH - 3) + '...' 
    : trimmed;
}

function validateSymbol(symbol: string): string {
  if (!TOKEN_VALIDATION.SYMBOL.PATTERN.test(symbol)) {
    console.warn(`Invalid symbol format: ${symbol}`);
    // Convert to uppercase and remove invalid characters
    symbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  return symbol.substring(0, TOKEN_VALIDATION.SYMBOL.MAX_LENGTH);
}

function validateName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > TOKEN_VALIDATION.NAME.MAX_LENGTH 
    ? trimmed.substring(0, TOKEN_VALIDATION.NAME.MAX_LENGTH) 
    : trimmed;
}

function validateAddress(address: string): string {
  if (!TOKEN_VALIDATION.ADDRESS.SOLANA_PATTERN.test(address)) {
    console.warn(`Invalid Solana address format: ${address}`);
  }
  return address;
}

async function fetchTokenData(): Promise<TokenData[]> {
  try {
    const response = await fetch('https://degenduel.me/api/dd-serv/tokens/list?detail=full');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch token data:', error);
    throw error;
  }
}

export async function seedTokens() {
  console.log('Seeding tokens and buckets...');

  // Fetch real token data
  const tokenData = await fetchTokenData();

  // Create token buckets first
  const buckets = await Promise.all([
    prisma.token_buckets.create({
      data: {
        name: 'Large Cap',
        description: 'Top market cap tokens (>$1B)',
        bucket_code: 'LARGE_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'Mid Cap',
        description: 'Medium market cap tokens ($100M-$1B)',
        bucket_code: 'MID_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'Small Cap',
        description: 'Small market cap tokens (<$100M)',
        bucket_code: 'SMALL_CAP'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'High Volume',
        description: 'High 24h trading volume tokens',
        bucket_code: 'HIGH_VOLUME'
      }
    }),
    prisma.token_buckets.create({
      data: {
        name: 'High Liquidity',
        description: 'Tokens with high liquidity',
        bucket_code: 'HIGH_LIQUIDITY'
      }
    })
  ]);

  // Helper function to determine bucket assignments using centralized thresholds
  function getBucketIds(token: TokenData) {
    const bucketIds = [];
    const marketCap = Number(token.marketCap) || 0;
    const volume24h = Number(token.volume24h) || 0;
    const liquidityUsd = Number(token.liquidity_usd) || 0;

    // Market cap buckets
    if (marketCap >= TOKEN_BUCKET_THRESHOLDS.MARKET_CAP.LARGE_CAP) bucketIds.push(buckets[0].id);
    else if (marketCap >= TOKEN_BUCKET_THRESHOLDS.MARKET_CAP.MID_CAP) bucketIds.push(buckets[1].id);
    else bucketIds.push(buckets[2].id);

    // Volume bucket
    if (volume24h >= TOKEN_BUCKET_THRESHOLDS.VOLUME.HIGH_VOLUME) bucketIds.push(buckets[3].id);

    // Liquidity bucket
    if (liquidityUsd >= TOKEN_BUCKET_THRESHOLDS.LIQUIDITY.HIGH_LIQUIDITY) bucketIds.push(buckets[4].id);

    return bucketIds;
  }

  // Create tokens with real data
  const tokens = await Promise.all(tokenData.map(async (token) => {
    const bucketIds = getBucketIds(token);
    
    return prisma.tokens.create({
      data: {
        address: validateAddress(token.contractAddress),
        symbol: validateSymbol(token.symbol),
        name: validateName(token.name),
        decimals: 9, // Default for Solana tokens
        is_active: true,
        market_cap: token.marketCap ? new Decimal(token.marketCap) : null,
        change_24h: token.change_h24 ? new Decimal(token.change_h24 * 100) : null,
        volume_24h: token.volume24h ? new Decimal(token.volume24h) : null,
        image_url: validateUrl(token.imageUrl),
        description: validateDescription(token.description),
        twitter_url: validateUrl(token.socials?.twitter),
        telegram_url: validateUrl(token.socials?.telegram),
        discord_url: validateUrl(token.socials?.discord),
        website_url: validateUrl(token.websites?.[0]),
        token_bucket_memberships: {
          create: bucketIds.map(bucketId => ({
            bucket_id: bucketId
          }))
        },
        token_prices: {
          create: {
            price: new Decimal(token.price || '0')
          }
        }
      }
    });
  }));

  console.log(`Seeded ${buckets.length} token buckets`);
  console.log(`Seeded ${tokens.length} tokens`);
  
  return { buckets, tokens };
}

// Check if this module is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedTokens()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} 
