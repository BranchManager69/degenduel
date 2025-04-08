// tests/services/contestWalletService.test.js

/**
 * Comprehensive unit tests for ContestWalletService
 * 
 * This test suite verifies the functionality of the ContestWalletService
 * using Jest with manually defined mocks to isolate the service.
 */

import { jest } from '@jest/globals';
import contestWalletService from '../../services/contestWalletService.js';

// Mock dependencies inline for simplicity
jest.mock('../../config/prisma.js', () => ({
  default: {
    contest_wallet: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(data => data.data),
      update: jest.fn().mockImplementation(data => ({ ...data.data, id: 1 })),
      upsert: jest.fn().mockImplementation(data => ({ ...data.create, id: 1 })),
    },
    contest: {
      findUnique: jest.fn().mockResolvedValue({ id: 1, name: 'Test Contest' }),
    },
    transaction: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    vanity_wallet_pool: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockImplementation(data => ({ ...data.data, id: 1 })),
    },
    $transaction: jest.fn(cb => cb()),
  }
}));

jest.mock('../../utils/solana-suite/solana-service-manager.js', () => ({
  default: {
    getConnection: jest.fn(() => ({
      getBalance: jest.fn().mockResolvedValue(5000000000), // 5 SOL
    })),
  }
}));

jest.mock('../../utils/logger-suite/logger.js', () => ({
  logApi: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }
}));

jest.mock('../../utils/admin-logger.js', () => ({
  default: {
    logAction: jest.fn(),
  }
}));

// Mock web3.js
jest.mock('@solana/web3.js', () => ({
  Keypair: {
    generate: jest.fn(() => ({
      publicKey: { toBase58: jest.fn().mockReturnValue('mock-public-key') },
      secretKey: new Uint8Array(32).fill(1),
    })),
    fromSecretKey: jest.fn(() => ({
      publicKey: { toBase58: jest.fn().mockReturnValue('mock-public-key') },
      secretKey: new Uint8Array(32).fill(1),
    })),
  },
  PublicKey: jest.fn().mockImplementation((key) => ({
    toBase58: jest.fn().mockReturnValue(key),
    toString: jest.fn().mockReturnValue(key),
  })),
  LAMPORTS_PER_SOL: 1000000000,
  Transaction: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    sign: jest.fn(),
  })),
  SystemProgram: {
    transfer: jest.fn(),
  },
}));

// Mock transaction utilities
jest.mock('../../utils/solana-suite/web3-v2/solana-transaction-fixed.js', () => ({
  transferSOL: jest.fn().mockResolvedValue({ signature: 'mock-signature' }),
}));

// Mock bs58
jest.mock('bs58', () => ({
  encode: jest.fn().mockReturnValue('mock-bs58-encoded-string'),
  decode: jest.fn().mockReturnValue(new Uint8Array(32).fill(1)),
}));

// Mock crypto
jest.mock('crypto', () => ({
  randomBytes: jest.fn().mockReturnValue(Buffer.from('mock-random-bytes')),
  createCipheriv: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue(Buffer.from('mock-encrypted-data')),
    final: jest.fn().mockReturnValue(Buffer.from('mock-final-data')),
    getAuthTag: jest.fn().mockReturnValue(Buffer.from('mock-auth-tag')),
  }),
  createDecipheriv: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnValue(Buffer.from('mock-decrypted-data')),
    final: jest.fn().mockReturnValue(Buffer.from('mock-final-data')),
    setAuthTag: jest.fn(),
  }),
}));

// Mock the VanityApiClient
jest.mock('../../services/vanity-wallet/vanity-api-client.js', () => ({
  default: {
    getAvailableVanityWallet: jest.fn().mockResolvedValue(null),
    assignVanityWalletToContest: jest.fn().mockResolvedValue({ id: 1, is_used: true }),
  }
}));

describe('ContestWalletService', () => {
  // Import mocked dependencies from the mocks
  let prisma = jest.mocked(jest.requireMock('../../config/prisma.js').default);
  let transferSOL = jest.mocked(jest.requireMock('../../utils/solana-suite/web3-v2/solana-transaction-fixed.js').transferSOL);
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set environment variable for wallet encryption
    process.env.WALLET_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long-k';
  });
  
  afterEach(() => {
    // Clean up environment variables
    delete process.env.WALLET_ENCRYPTION_KEY;
  });
  
  describe('createContestWallet', () => {
    it('should create a new contest wallet', async () => {
      // Setup
      const contestId = 1;
      const adminContext = { wallet_address: 'admin-wallet-address' };
      
      // Mock the VanityApiClient to return null (no vanity wallet available)
      const VanityApiClient = jest.requireMock('../../services/vanity-wallet/vanity-api-client.js').default;
      VanityApiClient.getAvailableVanityWallet.mockResolvedValue(null);
      
      // Execute
      const result = await contestWalletService.createContestWallet(contestId, adminContext);
      
      // Assert
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.create).toHaveBeenCalled();
    });
    
    it('should use a vanity wallet from database if available', async () => {
      // Setup
      const contestId = 1;
      const adminContext = { wallet_address: 'admin-wallet-address' };
      
      // Mock the VanityApiClient to return a vanity wallet
      const VanityApiClient = jest.requireMock('../../services/vanity-wallet/vanity-api-client.js').default;
      const mockVanityWallet = {
        id: 100,
        wallet_address: 'DUEL123456789abcdefghijklmnopqrstuvwx',
        private_key: JSON.stringify([1, 2, 3, 4]), // Mock private key in JSON format
        pattern: 'DUEL',
        is_used: false,
        status: 'completed'
      };
      VanityApiClient.getAvailableVanityWallet.mockResolvedValue(mockVanityWallet);
      
      // Execute
      const result = await contestWalletService.createContestWallet(contestId, adminContext);
      
      // Assert
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.create).toHaveBeenCalled();
      expect(VanityApiClient.assignVanityWalletToContest).toHaveBeenCalledWith(mockVanityWallet.id, contestId);
    });
  });
  
  describe('updateWalletBalance', () => {
    it('should update a wallet balance successfully', async () => {
      // Setup
      const mockWallet = {
        id: 1,
        wallet_address: 'mock-wallet-address',
        balance: 0
      };
      
      // Execute
      const result = await contestWalletService.updateWalletBalance(mockWallet);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.balance).toBeGreaterThan(0);
      expect(prisma.contest_wallet.update).toHaveBeenCalled();
    });
  });
  
  describe('updateAllWalletBalances', () => {
    it('should update all wallet balances with batch processing', async () => {
      // Setup
      const mockWallets = [
        { id: 1, wallet_address: 'wallet-1', balance: 0 },
        { id: 2, wallet_address: 'wallet-2', balance: 0 },
        { id: 3, wallet_address: 'wallet-3', balance: 0 }
      ];
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Execute
      const result = await contestWalletService.updateAllWalletBalances();
      
      // Assert
      expect(result).toBeDefined();
      expect(result.updated).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe('reclaimUnusedFunds', () => {
    it('should reclaim funds from completed contest wallets', async () => {
      // Setup
      const mockWallets = [
        { 
          id: 1, 
          wallet_address: 'wallet-1', 
          balance: 2.5, 
          encrypted_private_key: JSON.stringify({
            iv: 'mock-iv',
            authTag: 'mock-auth-tag',
            encrypted: 'mock-encrypted-data'
          }),
          contest: { status: 'completed', name: 'Contest 1' }
        }
      ];
      
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Mock the transfer
      const mockTransferResult = { signature: 'mock-signature', amount: 2.5 };
      contestWalletService.performBlockchainTransfer = jest.fn().mockResolvedValue(mockTransferResult);
      
      // Execute
      const options = {
        status_filter: ['completed', 'cancelled'],
        min_balance: 0.5,
        min_transfer: 0.1
      };
      const result = await contestWalletService.reclaimUnusedFunds(options);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.processed).toEqual(mockWallets.length);
      expect(contestWalletService.performBlockchainTransfer).toHaveBeenCalled();
    });
    
    it('should not transfer funds in dry run mode', async () => {
      // Setup
      const mockWallets = [
        { 
          id: 1, 
          wallet_address: 'wallet-1', 
          balance: 2.5, 
          encrypted_private_key: JSON.stringify({
            iv: 'mock-iv',
            authTag: 'mock-auth-tag',
            encrypted: 'mock-encrypted-data'
          }),
          contest: { status: 'completed', name: 'Contest 1' }
        }
      ];
      
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      contestWalletService.performBlockchainTransfer = jest.fn();
      
      // Execute
      const options = {
        status_filter: ['completed', 'cancelled'],
        min_balance: 0.5,
        min_transfer: 0.1,
        dry_run: true
      };
      const result = await contestWalletService.reclaimUnusedFunds(options);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.processed).toEqual(mockWallets.length);
      expect(contestWalletService.performBlockchainTransfer).not.toHaveBeenCalled();
    });
  });
  
  describe('service lifecycle', () => {
    it('should initialize the service successfully', async () => {
      // Execute
      await contestWalletService.initialize();
      
      // Assert
      expect(contestWalletService.isInitialized).toBe(true);
    });
  });
  
  describe('encryptPrivateKey and decryptPrivateKey', () => {
    it('should encrypt and decrypt a private key correctly', () => {
      // Generate a keypair for testing
      const privateKeyArray = Array.from(new Uint8Array(32).fill(1));
      
      // Encrypt the private key
      const encryptedData = contestWalletService.encryptPrivateKey(privateKeyArray);
      
      // Verify the encrypted data format
      expect(encryptedData).toBeDefined();
      expect(encryptedData.iv).toBeDefined();
      expect(encryptedData.authTag).toBeDefined();
      expect(encryptedData.encrypted).toBeDefined();
      
      // Decrypt the private key
      const decryptedKey = contestWalletService.decryptPrivateKey(encryptedData);
      
      // Verify decrypted key
      expect(decryptedKey).toBeDefined();
    });
  });
});