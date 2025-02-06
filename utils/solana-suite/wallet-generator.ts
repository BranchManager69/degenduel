// /utils/solana-suite/wallet-generator.ts

import { Keypair } from '@solana/web3.js';
import { PrismaClient, Prisma } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface WalletInfo {
  publicKey: string;
  secretKey: string;
}

interface StoredWallet {
  identifier: string;
  wallet_address: string;
  private_key: string;
}

export class WalletGenerator {
  private static walletCache: Map<string, WalletInfo> = new Map();

  // Encrypt a private key using the wallet encryption key from env
  private static encryptPrivateKey(privateKey: string): string {
    if (!process.env.WALLET_ENCRYPTION_KEY) {
      throw new Error('WALLET_ENCRYPTION_KEY environment variable is not set');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      Buffer.from(process.env.WALLET_ENCRYPTION_KEY, 'hex'),
      iv
    );

    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(privateKey)),
      cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    return JSON.stringify({
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    });
  }

  static async initialize() {
    // Load existing wallets from database into cache
    const existingWallets = await prisma.$queryRaw<StoredWallet[]>`
      SELECT identifier, wallet_address, private_key 
      FROM seed_wallets
    `;
    
    existingWallets.forEach(wallet => {
      this.walletCache.set(wallet.identifier, {
        publicKey: wallet.wallet_address,
        secretKey: wallet.private_key
      });
    });
  }

  static async generateWallet(identifier: string): Promise<WalletInfo> {
    // Check if wallet already exists in cache
    const existingWallet = this.walletCache.get(identifier);
    if (existingWallet) {
      return existingWallet;
    }

    // Check if wallet exists in database but not in cache
    const existingDbWallet = await prisma.$queryRaw<StoredWallet[]>`
      SELECT identifier, wallet_address, private_key 
      FROM seed_wallets 
      WHERE identifier = ${identifier}
      LIMIT 1
    `;

    if (existingDbWallet.length > 0) {
      const walletInfo = {
        publicKey: existingDbWallet[0].wallet_address,
        secretKey: existingDbWallet[0].private_key
      };
      this.walletCache.set(identifier, walletInfo);
      return walletInfo;
    }

    // Generate new wallet
    const keypair = Keypair.generate();
    const walletInfo: WalletInfo = {
      publicKey: keypair.publicKey.toString(),
      secretKey: Buffer.from(keypair.secretKey).toString('base64')
    };

    // Save to database with encrypted private key
    await prisma.$executeRaw`
      INSERT INTO seed_wallets (identifier, wallet_address, private_key, purpose)
      VALUES (
        ${identifier},
        ${walletInfo.publicKey},
        ${this.encryptPrivateKey(walletInfo.secretKey)},
        ${'Seed wallet for ' + identifier}
      )
    `;

    // Save to cache
    this.walletCache.set(identifier, walletInfo);

    return walletInfo;
  }

  static async getWallet(identifier: string): Promise<WalletInfo | undefined> {
    // Check cache first
    const cachedWallet = this.walletCache.get(identifier);
    if (cachedWallet) {
      return cachedWallet;
    }

    // Check database
    const dbWallet = await prisma.$queryRaw<StoredWallet[]>`
      SELECT identifier, wallet_address, private_key 
      FROM seed_wallets 
      WHERE identifier = ${identifier}
      LIMIT 1
    `;

    if (dbWallet.length > 0) {
      const walletInfo = {
        publicKey: dbWallet[0].wallet_address,
        secretKey: dbWallet[0].private_key
      };
      this.walletCache.set(identifier, walletInfo);
      return walletInfo;
    }

    return undefined;
  }
}

// Initialize wallet cache when module is loaded
WalletGenerator.initialize(); 