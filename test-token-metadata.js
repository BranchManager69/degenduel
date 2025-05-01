// test-token-metadata.js
import { PublicKey } from '@solana/web3.js';
import { solanaEngine } from './services/solana-engine/index.js';

async function testTokenMetadata() {
  try {
    // Initialize solanaEngine if needed
    if (solanaEngine.init && !solanaEngine.initialized) {
      console.log('Initializing Solana Engine...');
      await solanaEngine.init();
    }
    
    const mintPublicKey = new PublicKey('38PgzpJYu2HkiYvV8qePFakB8tuobPdGm2FFEn7Dpump');
    console.log('Testing token metadata retrieval for:', mintPublicKey.toString());
    
    // Method 1: Get basic token supply info (includes decimals)
    console.log('\n=== METHOD 1: Token Supply Info ===');
    try {
      const tokenInfo = await solanaEngine.executeConnectionMethod('getTokenSupply', mintPublicKey);
      console.log('Token supply info:', JSON.stringify(tokenInfo, null, 2));
      console.log('Decimals:', tokenInfo?.value?.decimals);
    } catch (error) {
      console.error('Error getting token supply:', error.message);
    }
    
    // Method 2: Check if getTokenMetadata exists
    console.log('\n=== METHOD 2: Metaplex Token Metadata ===');
    if (typeof solanaEngine.getTokenMetadata === 'function') {
      try {
        console.log('Testing Metaplex metadata retrieval...');
        const metadata = await solanaEngine.getTokenMetadata(mintPublicKey);
        console.log('Metaplex metadata:', JSON.stringify(metadata, null, 2));
      } catch (error) {
        console.error('Error getting Metaplex metadata:', error.message);
      }
    } else {
      console.log('solanaEngine.getTokenMetadata method not available');
      
      // Check if we can find this function elsewhere
      console.log('Checking other possible locations for token metadata functions...');
      
      // Check if there's a token utils module
      try {
        const tokenUtils = await import('./services/solana-engine/token-utils.js').catch(() => null);
        if (tokenUtils && tokenUtils.getTokenMetadata) {
          const metadata = await tokenUtils.getTokenMetadata(mintPublicKey);
          console.log('Token utils metadata:', JSON.stringify(metadata, null, 2));
        } else {
          console.log('No token-utils module found or no getTokenMetadata function');
        }
      } catch (error) {
        console.error('Error importing token utils:', error.message);
      }
    }
    
    // Method 3: Try SPL Token Registry
    console.log('\n=== METHOD 3: SPL Token Registry ===');
    try {
      const tokenAccounts = await solanaEngine.executeConnectionMethod(
        'getTokenAccountsByOwner',
        new PublicKey('8FMz9knPQ54v2mVwGkAfP8UNsJA4qNySGQqdeDcV2AKX'), // Random public key
        { mint: mintPublicKey },
        { encoding: 'jsonParsed' }
      );
      
      if (tokenAccounts.value && tokenAccounts.value.length > 0) {
        const accountInfo = tokenAccounts.value[0].account.data.parsed.info;
        console.log('Token info from account data:', JSON.stringify(accountInfo, null, 2));
        console.log('Decimals from account data:', accountInfo.tokenAmount?.decimals);
      } else {
        console.log('No token accounts found for testing');
      }
    } catch (error) {
      console.error('Error getting token accounts:', error.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testTokenMetadata().then(() => {
  console.log('Test complete');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});