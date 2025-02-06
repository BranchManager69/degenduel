import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

interface WalletInfo {
  publicKey: string;
  secretKey: string;
}

export class WalletGenerator {
  private static walletCache: Map<string, WalletInfo> = new Map();
  private static readonly WALLET_CACHE_FILE = path.join(process.cwd(), 'prisma/seeds/data/generated-wallets.json');

  static initialize() {
    // Create data directory if it doesn't exist
    const dataDir = path.join(process.cwd(), 'prisma/seeds/data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing wallet cache if it exists
    if (fs.existsSync(this.WALLET_CACHE_FILE)) {
      const cacheData = JSON.parse(fs.readFileSync(this.WALLET_CACHE_FILE, 'utf8'));
      Object.entries(cacheData).forEach(([key, value]) => {
        this.walletCache.set(key, value as WalletInfo);
      });
    }
  }

  static generateWallet(identifier: string): WalletInfo {
    // Check if wallet already exists in cache
    const existingWallet = this.walletCache.get(identifier);
    if (existingWallet) {
      return existingWallet;
    }

    // Generate new wallet
    const keypair = Keypair.generate();
    const walletInfo: WalletInfo = {
      publicKey: keypair.publicKey.toString(),
      secretKey: Buffer.from(keypair.secretKey).toString('base64')
    };

    // Save to cache
    this.walletCache.set(identifier, walletInfo);
    this.saveCache();

    return walletInfo;
  }

  static getWallet(identifier: string): WalletInfo | undefined {
    return this.walletCache.get(identifier);
  }

  private static saveCache() {
    const cacheData = Object.fromEntries(this.walletCache.entries());
    fs.writeFileSync(this.WALLET_CACHE_FILE, JSON.stringify(cacheData, null, 2));
  }
}

// Initialize wallet cache when module is loaded
WalletGenerator.initialize(); 