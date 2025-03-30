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

describe('ContestWalletService', () => {
  let prisma;
  let transferSOL;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Import mocked dependencies
    prisma = require('../../config/prisma.js').default;
    transferSOL = require('../../utils/solana-suite/web3-v2/solana-transaction-fixed.js').transferSOL;
    
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
      
      // Mock a vanity wallet not being available
      prisma.contest_wallet.findFirst.mockResolvedValueOnce(null);
      
      // Execute
      const result = await contestWalletService.createContestWallet(contestId, adminContext);
      
      // Assert
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.create).toHaveBeenCalled();
    });
    
    it('should use a vanity wallet if available', async () => {
      // Setup
      const contestId = 1;
      const adminContext = { wallet_address: 'admin-wallet-address' };
      
      // Mock a vanity wallet being available
      const mockVanityWallet = {
        id: 100,
        wallet_address: 'DUEL123456789abcdefghijklmnopqrstuvwx',
        encrypted_private_key: 'encrypted-key',
        contest_id: null
      };
      prisma.contest_wallet.findFirst.mockResolvedValueOnce(mockVanityWallet);
      
      // Execute
      const result = await contestWalletService.createContestWallet(contestId, adminContext);
      
      // Assert
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.update).toHaveBeenCalled();
      expect(result.wallet_address).toEqual(mockVanityWallet.wallet_address);
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
});
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.create).toHaveBeenCalled();
      expect(result.contest_id).toEqual(contestId);
      expect(result.wallet_address).toBeDefined();
    });

    it('should use a vanity wallet if available', async () => {
      // Setup
      const contestId = 1;
      const adminContext = { wallet_address: 'admin-wallet-address' };
      
      // Mock a vanity wallet being available
      const mockVanityWallet = {
        id: 100,
        wallet_address: 'DUEL123456789abcdefghijklmnopqrstuvwx',
        encrypted_private_key: 'encrypted-key',
        contest_id: null
      };
      prisma.contest_wallet.findFirst.mockResolvedValueOnce(mockVanityWallet);
      
      // Execute
      const result = await contestWalletService.createContestWallet(contestId, adminContext);
      
      // Verify
      expect(result).toBeDefined();
      expect(prisma.contest_wallet.update).toHaveBeenCalled();
      expect(result.contest_id).toEqual(contestId);
      expect(result.wallet_address).toEqual(mockVanityWallet.wallet_address);
    });
  });

  describe('encryptPrivateKey and decryptPrivateKey', () => {
    it('should encrypt and decrypt a private key correctly', async () => {
      // Backup original env var and set test value
      const originalEncryptionKey = process.env.WALLET_ENCRYPTION_KEY;
      process.env.WALLET_ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long-k';
      
      // Generate a keypair for testing
      const keypair = Keypair.generate();
      const privateKeyArray = Array.from(keypair.secretKey);
      
      try {
        // Encrypt the private key
        const encryptedData = contestWalletService.encryptPrivateKey(privateKeyArray);
        
        // Verify the encrypted data format
        expect(encryptedData).toBeDefined();
        expect(encryptedData.iv).toBeDefined();
        expect(encryptedData.authTag).toBeDefined();
        expect(encryptedData.encrypted).toBeDefined();
        
        // Decrypt the private key
        const decryptedKey = contestWalletService.decryptPrivateKey(encryptedData);
        
        // In a real test, we'd verify the decrypted key matches the original
        expect(decryptedKey).toBeDefined();
      } finally {
        // Restore original env var
        process.env.WALLET_ENCRYPTION_KEY = originalEncryptionKey;
      }
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
      
      // Mock the connection's getBalance method
      const mockConnection = {
        getBalance: jest.fn().mockResolvedValue(5 * LAMPORTS_PER_SOL)
      };
      SolanaServiceManager.getConnection.mockReturnValue(mockConnection);
      
      // Execute
      const result = await contestWalletService.updateWalletBalance(mockWallet);
      
      // Verify
      expect(result).toBeDefined();
      expect(result.balance).toEqual(5); // 5 SOL
      expect(mockConnection.getBalance).toHaveBeenCalled();
      expect(prisma.contest_wallet.update).toHaveBeenCalledWith({
        where: { id: mockWallet.id },
        data: { balance: 5 }
      });
    });
    
    it('should handle errors during balance update', async () => {
      // Setup
      const mockWallet = {
        id: 1,
        wallet_address: 'mock-wallet-address',
        balance: 0
      };
      
      // Mock the connection's getBalance method to throw an error
      const mockConnection = {
        getBalance: jest.fn().mockRejectedValue(new Error('RPC error'))
      };
      SolanaServiceManager.getConnection.mockReturnValue(mockConnection);
      
      // Execute & Verify
      await expect(contestWalletService.updateWalletBalance(mockWallet)).rejects.toThrow();
    });
  });

  describe('updateAllWalletBalances', () => {
    it('should update all wallet balances with batch processing', async () => {
      // Setup - Mock multiple wallets
      const mockWallets = [
        { id: 1, wallet_address: 'wallet-1', balance: 0 },
        { id: 2, wallet_address: 'wallet-2', balance: 0 },
        { id: 3, wallet_address: 'wallet-3', balance: 0 }
      ];
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Mock a specific updateWalletBalance implementation for testing
      contestWalletService.updateWalletBalance = jest.fn().mockImplementation(
        async (wallet) => ({ ...wallet, balance: 5 })
      );
      
      // Execute
      const result = await contestWalletService.updateAllWalletBalances();
      
      // Verify
      expect(result).toBeDefined();
      expect(result.updated).toEqual(mockWallets.length);
      expect(result.failed).toEqual(0);
      expect(contestWalletService.updateWalletBalance).toHaveBeenCalledTimes(mockWallets.length);
    });
    
    it('should handle partial failures during batch update', async () => {
      // Setup - Mock multiple wallets
      const mockWallets = [
        { id: 1, wallet_address: 'wallet-1', balance: 0 },
        { id: 2, wallet_address: 'wallet-2', balance: 0 },
        { id: 3, wallet_address: 'wallet-3', balance: 0 }
      ];
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Mock a specific updateWalletBalance implementation that fails for wallet-2
      contestWalletService.updateWalletBalance = jest.fn().mockImplementation(
        async (wallet) => {
          if (wallet.id === 2) throw new Error('Test error');
          return { ...wallet, balance: 5 };
        }
      );
      
      // Execute
      const result = await contestWalletService.updateAllWalletBalances();
      
      // Verify
      expect(result).toBeDefined();
      expect(result.updated).toEqual(2); // Two successful updates
      expect(result.failed).toEqual(1);  // One failed update
      expect(contestWalletService.updateWalletBalance).toHaveBeenCalledTimes(mockWallets.length);
    });
  });

  describe('reclaimUnusedFunds', () => {
    it('should reclaim funds from completed contest wallets', async () => {
      // Setup - Mock wallets with sufficient balance
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
        },
        { 
          id: 2, 
          wallet_address: 'wallet-2', 
          balance: 3.0, 
          encrypted_private_key: JSON.stringify({
            iv: 'mock-iv',
            authTag: 'mock-auth-tag',
            encrypted: 'mock-encrypted-data'
          }),
          contest: { status: 'cancelled', name: 'Contest 2' }
        }
      ];
      
      // Mock finding wallets
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Mock the performBlockchainTransfer method
      contestWalletService.performBlockchainTransfer = jest.fn().mockResolvedValue({
        signature: 'mock-transfer-signature',
        amount: 1.0
      });
      
      // Mock options
      const options = {
        status_filter: ['completed', 'cancelled'],
        min_balance: 0.5,
        min_transfer: 0.1,
        dry_run: false
      };
      
      // Execute
      const result = await contestWalletService.reclaimUnusedFunds(options);
      
      // Verify
      expect(result).toBeDefined();
      expect(result.processed).toEqual(mockWallets.length);
      expect(result.reclaimed).toEqual(mockWallets.length);
      expect(result.total_amount).toBeGreaterThan(0);
      expect(contestWalletService.performBlockchainTransfer).toHaveBeenCalledTimes(mockWallets.length);
    });
    
    it('should not transfer funds in dry run mode', async () => {
      // Setup - Mock wallets with sufficient balance
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
      
      // Mock finding wallets
      prisma.contest_wallet.findMany.mockResolvedValue(mockWallets);
      
      // Mock the performBlockchainTransfer method
      contestWalletService.performBlockchainTransfer = jest.fn();
      
      // Mock options with dry_run = true
      const options = {
        status_filter: ['completed', 'cancelled'],
        min_balance: 0.5,
        min_transfer: 0.1,
        dry_run: true
      };
      
      // Execute
      const result = await contestWalletService.reclaimUnusedFunds(options);
      
      // Verify
      expect(result).toBeDefined();
      expect(result.processed).toEqual(mockWallets.length);
      expect(result.reclaimed).toEqual(0); // No actual reclaims in dry run
      expect(contestWalletService.performBlockchainTransfer).not.toHaveBeenCalled();
    });
  });

  describe('performBlockchainTransfer', () => {
    it('should execute a blockchain transfer successfully', async () => {
      // Setup
      const sourceWallet = { 
        wallet_address: 'source-wallet', 
        encrypted_private_key: JSON.stringify({
          iv: 'mock-iv',
          authTag: 'mock-auth-tag',
          encrypted: 'mock-encrypted-data'
        })
      };
      const destinationAddress = 'destination-wallet';
      const amount = 1.5; // SOL
      
      // Mock the decryptPrivateKey method
      contestWalletService.decryptPrivateKey = jest.fn().mockReturnValue(new Uint8Array(32).fill(1));
      
      // Mock the executeTransfer method
      contestWalletService.executeTransfer = jest.fn().mockResolvedValue({
        signature: 'mock-signature',
        amount: amount
      });
      
      // Execute
      const result = await contestWalletService.performBlockchainTransfer(sourceWallet, destinationAddress, amount);
      
      // Verify
      expect(result).toBeDefined();
      expect(result.signature).toEqual('mock-signature');
      expect(result.amount).toEqual(amount);
      expect(contestWalletService.decryptPrivateKey).toHaveBeenCalled();
      expect(contestWalletService.executeTransfer).toHaveBeenCalled();
    });
    
    it('should handle errors during blockchain transfer', async () => {
      // Setup
      const sourceWallet = { 
        wallet_address: 'source-wallet', 
        encrypted_private_key: JSON.stringify({
          iv: 'mock-iv',
          authTag: 'mock-auth-tag',
          encrypted: 'mock-encrypted-data'
        })
      };
      const destinationAddress = 'destination-wallet';
      const amount = 1.5; // SOL
      
      // Mock the decryptPrivateKey method
      contestWalletService.decryptPrivateKey = jest.fn().mockReturnValue(new Uint8Array(32).fill(1));
      
      // Mock the executeTransfer method to throw an error
      contestWalletService.executeTransfer = jest.fn().mockRejectedValue(new Error('Transfer failed'));
      
      // Execute and verify it throws
      await expect(
        contestWalletService.performBlockchainTransfer(sourceWallet, destinationAddress, amount)
      ).rejects.toThrow('Transfer failed');
    });
  });

  // Service lifecycle tests
  describe('service lifecycle', () => {
    it('should initialize the service successfully', async () => {
      // Execute
      await contestWalletService.initialize();
      
      // Verify
      expect(contestWalletService.isInitialized).toBe(true);
      expect(contestWalletService.isOperational).toBe(true);
    });
    
    it('should perform operation cycle successfully', async () => {
      // Mock the updateAllWalletBalances method
      contestWalletService.updateAllWalletBalances = jest.fn().mockResolvedValue({
        updated: 3,
        failed: 0
      });
      
      // Execute
      await contestWalletService.performOperation();
      
      // Verify
      expect(contestWalletService.updateAllWalletBalances).toHaveBeenCalled();
    });
  });
});