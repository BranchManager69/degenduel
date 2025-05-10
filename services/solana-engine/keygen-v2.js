// keygen-v2.js
import { generateKeyPair } from '@solana/keys';
import { getAddressFromPublicKey } from '@solana/addresses';
import { webcrypto } from 'node:crypto'; // Import for polyfill

// Ensure globalThis.crypto.subtle is available
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  if (typeof webcrypto !== 'undefined' && typeof webcrypto.subtle !== 'undefined') {
    globalThis.crypto = webcrypto;
    console.log("Polyfilled globalThis.crypto with node:crypto.webcrypto");
  } else {
    console.error("Error: webcrypto.subtle is not available. Cannot proceed.");
    process.exit(1);
  }
}

async function generateMultipleV2Keys(count = 10) {
  console.log(`Generating ${count} new Solana keypairs using @solana/keys (v2)...\n`);

  console.log("IMPORTANT NOTE:");
  console.log("This script generates functional v2 keypairs. The private keys are held as");
  console.log("non-extractable CryptoKey objects within Node.js due to Web Crypto API");
  console.log("limitations on exporting Ed25519 private keys in 'raw' (seed) format.");
  console.log("Therefore, the 32-byte private key seed array for file storage cannot be displayed.");
  console.log("These keys are usable for in-application signing with v2 libraries.\n");

  for (let i = 0; i < count; i++) {
    console.log(`--- Keypair ${i + 1} ---`);
    
    const keyPairObject = await generateKeyPair(); 

    if (!keyPairObject || !keyPairObject.publicKey || typeof keyPairObject.publicKey.type === 'undefined') {
        console.error("Error: generateKeyPair() did not return a valid publicKey CryptoKey.");
        console.error("Received keyPairObject:", keyPairObject);
        console.log("---------------------\n");
        continue;
    }

    try {
      const publicKeyAddress = await getAddressFromPublicKey(keyPairObject.publicKey); 
      console.log(`Public Key (Address): ${publicKeyAddress}`);
    } catch (addressError) {
      console.error("Error deriving address from public key:", addressError);
      console.error("Public CryptoKey object passed to getAddressFromPublicKey:", keyPairObject.publicKey);
    }
    
    console.log("---------------------\n");
  }
}

generateMultipleV2Keys().catch(err => {
  console.error("\nError in key generation script:");
  console.error(err);
});