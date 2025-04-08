// Test script to verify TTL values from environment variables
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Calculate default values
const defaultTTLs = {
  tokenMetadataTTL: 60 * 60 * 24, // 24 hours
  tokenPriceTTL: 60 * 60,        // 1 hour
  walletDataTTL: 60 * 5          // 5 minutes
};

// Reading from environment variables following the same logic
const envTTLs = {
  tokenMetadataTTL: parseInt(process.env.TOKEN_METADATA_TTL || '0') || defaultTTLs.tokenMetadataTTL,
  tokenPriceTTL: parseInt(process.env.TOKEN_PRICE_TTL || '0') || defaultTTLs.tokenPriceTTL,
  walletDataTTL: parseInt(process.env.WALLET_DATA_TTL || '0') || defaultTTLs.walletDataTTL
};

console.log('Environment variables:');
console.log('TOKEN_METADATA_TTL:', process.env.TOKEN_METADATA_TTL);
console.log('TOKEN_PRICE_TTL:', process.env.TOKEN_PRICE_TTL);
console.log('WALLET_DATA_TTL:', process.env.WALLET_DATA_TTL);
console.log('\nDefault TTL values:');
console.log('tokenMetadataTTL:', defaultTTLs.tokenMetadataTTL, 'seconds');
console.log('tokenPriceTTL:', defaultTTLs.tokenPriceTTL, 'seconds');
console.log('walletDataTTL:', defaultTTLs.walletDataTTL, 'seconds');
console.log('\nCalculated TTL values:');
console.log('tokenMetadataTTL:', envTTLs.tokenMetadataTTL, 'seconds');
console.log('tokenPriceTTL:', envTTLs.tokenPriceTTL, 'seconds');
console.log('walletDataTTL:', envTTLs.walletDataTTL, 'seconds'); 