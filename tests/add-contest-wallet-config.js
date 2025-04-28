// tests/add-contest-wallet-config.js
// A safe way to add the contest wallet config without running full seed

import { PrismaClient } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import VanityApiClient from '../services/vanity-wallet/vanity-api-client.js';

// Create a custom ID generator
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

async function addContestWalletConfig() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🔄 Checking for existing Contest Wallet configuration...');
    
    // Check if config already exists
    const existingConfig = await prisma.config_contest_wallet.findFirst();
    
    if (existingConfig) {
      console.log('✅ Contest Wallet configuration already exists:');
      console.log(JSON.stringify(existingConfig, null, 2));
      console.log('✅ Vanity wallets enabled:', existingConfig.enable_vanity_wallets);
    } else {
      console.log('🌱 Creating Contest Wallet configuration in a transaction...');
      
      // Use transaction for safety
      await prisma.$transaction(async (tx) => {
        // Create default configuration
        const newConfig = await tx.config_contest_wallet.create({
          data: {
            id: nanoid(),
            // Core Configuration
            check_interval_ms: 60000, // 1 minute
            
            // Reclaim Settings
            min_balance_to_reclaim: 0.05,
            min_amount_to_transfer: 0.01,
            reclaim_contest_statuses: ["completed", "cancelled"],
            
            // Vanity Wallet Settings
            vanity_wallet_paths: {
              "DUEL": "/home/websites/degenduel/addresses/keypairs/public/_DUEL",
              "DEGEN": "/home/websites/degenduel/addresses/keypairs/public/_DEGEN"
            },
            
            // Wallet Encryption
            encryption_algorithm: "aes-256-gcm",
            
            // Circuit Breaker
            failure_threshold: 5,
            reset_timeout_ms: 60000,
            min_healthy_period_ms: 120000,
            
            // Backoff Settings
            initial_delay_ms: 1000,
            max_delay_ms: 30000,
            backoff_factor: 2,
            
            // Admin Features
            enable_vanity_wallets: true,
            
            // Metadata
            updated_by: 'admin_fix',
          }
        });
        
        console.log('✅ Created new config with ID:', newConfig.id);
        console.log('✅ Vanity wallets enabled:', newConfig.enable_vanity_wallets);
      });
      
      console.log('✅ Transaction completed successfully!');
    }
    
    // Let's check the number of available vanity wallets
    const availableWallets = await prisma.vanity_wallet_pool.findMany({
      where: {
        status: 'completed',
        is_used: false
      },
      select: {
        id: true,
        pattern: true,
        wallet_address: true,
        created_at: true
      }
    });
    
    console.log(`ℹ️ Available vanity wallets (${availableWallets.length}):`);
    console.table(availableWallets);
    
    // Let's test if we can actually get a vanity wallet
    console.log('\n🔍 Testing vanity wallet retrieval...');
    console.log('Trying to get a DUEL wallet:');
    try {
      const duelWallet = await VanityApiClient.getAvailableVanityWallet('DUEL');
      if (duelWallet) {
        console.log(`✅ Successfully retrieved DUEL wallet: ${duelWallet.wallet_address}`);
        console.log(`Private key length: ${duelWallet.private_key?.length || 'NULL'}`);
        
        // Try to parse the private key (this is what fails in the service)
        try {
          const privateKeyParsed = JSON.parse(duelWallet.private_key);
          console.log(`✅ Successfully parsed private key (length: ${JSON.stringify(privateKeyParsed).length})`);
        } catch (parseError) {
          console.error(`❌ ERROR parsing private key: ${parseError.message}`);
          console.log('Private key raw value (first 20 chars):', duelWallet.private_key?.substring(0, 20) || 'NULL');
        }
      } else {
        console.log('❌ No DUEL wallet found');
      }
    } catch (error) {
      console.error(`❌ Error getting DUEL wallet: ${error.message}`);
      console.error(error.stack);
    }
    
  } catch (error) {
    console.error('❌ Error creating Contest Wallet configuration:', error);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run immediately
addContestWalletConfig()
  .then(() => console.log('Script completed.'))
  .catch(console.error);