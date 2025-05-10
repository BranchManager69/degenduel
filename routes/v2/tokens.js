// /routes/v2/tokens.js

import { Router } from 'express';
import { logApi } from '../../utils/logger-suite/logger.js';
import prisma from '../../config/prisma.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import rateLimit from 'express-rate-limit';
import AdminLogger from '../../utils/admin-logger.js';
import { solanaEngine } from '../../services/solana-engine/index.js';
import { ServiceError } from '../../utils/service-suite/service-error.js';
import { LAMPORTS_PER_SOL } from '@solana/web3.js'; // Temporarily for LAMPORTS_PER_SOL if not defined elsewhere as V2 yet
import bs58 from 'bs58';
import { Decimal } from 'decimal.js';
// Consider defining LAMPORTS_PER_SOL_V2 = 1_000_000_000 locally or importing a shared V2 constant.
const LAMPORTS_PER_SOL_V2 = 1_000_000_000;

const router = Router();

/**
 * @swagger
 * tags:
 *   name: V2 Tokens
 *   description: V2 token endpoints using contract addresses
 */

/**
 * @swagger
 * /api/v2/tokens/addresses:
 *   get:
 *     summary: Get all token addresses
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Set to 'true' to get only active tokens
 *     responses:
 *       200:
 *         description: Array of token contract addresses
 */
router.get('/addresses', async (req, res) => {
  const { active } = req.query;
  
  try {
    logApi.info('Fetching token addresses', { active });
    
    const addresses = await prisma.tokens.findMany({
      where: active === 'true' ? { is_active: true } : {},
      select: {
        contract_address: true
      }
    });

    res.json(addresses.map(token => token.contract_address));
  } catch (error) {
    logApi.error('Failed to fetch token addresses', { error });
    res.status(500).json({ error: 'Failed to fetch token addresses' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/by-address/{contractAddress}:
 *   get:
 *     summary: Get token by address
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token information
 */
router.get('/by-address/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  
  try {
    logApi.info('Fetching token by address', { contractAddress });
    
    const token = await prisma.tokens.findUnique({
      where: { contract_address: contractAddress },
      select: {
        contract_address: true,
        name: true,
        symbol: true,
        price: true,
        market_cap: true,
        volume_24h: true
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({
      contractAddress: token.contract_address,
      name: token.name,
      symbol: token.symbol,
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString()
    });
  } catch (error) {
    logApi.error('Failed to fetch token', { error, contractAddress });
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/search:
 *   get:
 *     summary: Search tokens by name or symbol
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Array of matching tokens
 */
router.get('/search', async (req, res) => {
  const { q, limit = 10 } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    logApi.info('Searching tokens', { query: q, limit });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { symbol: { contains: q, mode: 'insensitive' } }
        ]
      },
      take: parseInt(limit),
      select: {
        contract_address: true,
        name: true,
        symbol: true,
        price: true,
        market_cap: true,
        volume_24h: true
      }
    });

    res.json(tokens.map(token => ({
      contractAddress: token.contract_address,
      name: token.name,
      symbol: token.symbol,
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString()
    })));
  } catch (error) {
    logApi.error('Failed to search tokens', { error, query: q });
    res.status(500).json({ error: 'Failed to search tokens' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/market-data/{contractAddress}:
 *   get:
 *     summary: Get token market data
 *     tags: [V2 Tokens]
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detailed market data for token
 */
router.get('/market-data/:contractAddress', async (req, res) => {
  const { contractAddress } = req.params;
  
  try {
    logApi.info('Fetching token market data', { contractAddress });
    
    const token = await prisma.tokens.findUnique({
      where: { contract_address: contractAddress },
      include: {
        token_market_data: true,
        token_liquidity: true,
        token_transactions: {
          where: {
            timestamp: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
            }
          }
        }
      }
    });

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    res.json({
      price: token.price?.toString(),
      marketCap: token.market_cap?.toString(),
      volume24h: token.volume_24h?.toString(),
      change24h: token.token_market_data?.price_change_24h?.toString(),
      liquidity: token.token_liquidity ? {
        usd: token.token_liquidity.usd_value?.toString(),
        base: token.token_liquidity.base_amount?.toString(),
        quote: token.token_liquidity.quote_amount?.toString()
      } : null,
      transactions24h: {
        buys: token.token_transactions.filter(tx => tx.type === 'BUY').length,
        sells: token.token_transactions.filter(tx => tx.type === 'SELL').length
      }
    });
  } catch (error) {
    logApi.error('Failed to fetch token market data', { error, contractAddress });
    res.status(500).json({ error: 'Failed to fetch token market data' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/images:
 *   post:
 *     summary: Get token images
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token image URLs
 */
router.post('/images', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token images', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      select: {
        contract_address: true,
        image_url: true,
        header_image: true,
        og_image: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {
        imageUrl: token.image_url,
        headerImage: token.header_image,
        openGraphImage: token.og_image
      };
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token images', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token images' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/liquidity:
 *   post:
 *     summary: Get token liquidity
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token liquidity information
 */
router.post('/liquidity', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token liquidity', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_liquidity: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      if (token.token_liquidity) {
        result[token.contract_address] = {
          usd: token.token_liquidity.usd_value?.toString(),
          base: token.token_liquidity.base_amount?.toString(),
          quote: token.token_liquidity.quote_amount?.toString()
        };
      }
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token liquidity', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token liquidity' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/websites:
 *   post:
 *     summary: Get token websites
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token website information
 */
router.post('/websites', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token websites', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_websites: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = token.token_websites.map(website => ({
        url: website.url,
        label: website.label
      }));
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token websites', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token websites' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/socials:
 *   post:
 *     summary: Get token social media
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token social media information
 */
router.post('/socials', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching token socials', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_socials: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {};
      token.token_socials.forEach(social => {
        result[token.contract_address][social.platform] = {
          url: social.url,
          count: social.follower_count
        };
      });
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch token socials', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch token socials' });
  }
});

/**
 * @swagger
 * /api/v2/tokens/prices/batch:
 *   post:
 *     summary: Get batch token prices
 *     tags: [V2 Tokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - addresses
 *             properties:
 *               addresses:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Token prices and 24h changes
 */
router.post('/prices/batch', async (req, res) => {
  const { addresses } = req.body;
  
  if (!addresses || !Array.isArray(addresses)) {
    return res.status(400).json({ error: 'Invalid addresses array' });
  }

  try {
    logApi.info('Fetching batch token prices', { addressCount: addresses.length });
    
    const tokens = await prisma.tokens.findMany({
      where: {
        contract_address: { in: addresses }
      },
      include: {
        token_market_data: true
      }
    });

    const result = {};
    tokens.forEach(token => {
      result[token.contract_address] = {
        price: token.price?.toString(),
        change24h: token.token_market_data?.price_change_24h?.toString()
      };
    });

    res.json(result);
  } catch (error) {
    logApi.error('Failed to fetch batch token prices', { error, addressCount: addresses.length });
    res.status(500).json({ error: 'Failed to fetch batch token prices' });
  }
});

// Get latest market data for all active tokens
router.get('/marketData/latest', async (req, res) => {
    try {
        const tokens = await prisma.tokens.findMany({
            where: { is_active: true },
            include: {
                token_prices: true
            }
        });

        const marketData = tokens.map(token => ({
            address: token.contract_address,
            symbol: token.symbol,
            name: token.name,
            price: token.token_prices?.price || 0,
            market_cap: token.market_cap || 0,
            change_24h: token.change_24h || 0,
            volume_24h: token.volume_24h || 0,
            last_updated: token.token_prices?.updated_at || null
        }));

        res.json({
            success: true,
            data: marketData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logApi.error('Failed to fetch market data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch market data' 
        });
    }
});

// Rate limiter: 10 requests per hour per IP
const whitelistLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many whitelist requests, please try again later' }
});

/**
 * @swagger
 * /api/v2/tokens/whitelist:
 *   post:
 *     summary: Add a token to the whitelist
 *     tags: [V2 Tokens]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractAddress
 *               - transactionSignature
 *             properties:
 *               contractAddress:
 *                 type: string
 *                 description: SPL token address
 *               transactionSignature:
 *                 type: string
 *                 description: Payment transaction signature
 *     responses:
 *       200:
 *         description: Token whitelisted successfully
 *       400:
 *         description: Invalid input or verification failed
 *       401:
 *         description: Not authenticated
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/whitelist', requireAuth, whitelistLimiter, async (req, res) => {
    const { contractAddress, transactionSignature } = req.body;
    const user = req.user;
    const logContext = {
        path: 'POST /api/v2/tokens/whitelist',
        contractAddress,
        signature: transactionSignature,
        userId: req.user?.id,
        wallet: req.user?.wallet_address
    };

    try {
        logApi.info('Token whitelist request received', logContext);

        // --- Step 1: Verify the token and get metadata (NEW LOGIC) --- 
        logApi.info('Verifying token metadata via solanaEngine...', { contractAddress });
        
        // Check Prisma first if we want to prevent re-whitelisting or handle updates differently
        const existingToken = await prisma.tokens.findUnique({
            where: { address: contractAddress } // Assuming 'address' is the field for contractAddress
        });

        if (existingToken && existingToken.is_active) { 
            // Or if any existingToken means it's already processed, adjust logic as needed.
            throw new ServiceError(400, 'Token already whitelisted and active.');
        }

        let fetchedMetadataArray;
        try {
            // solanaEngine.fetchTokenMetadata is expected to use heliusClient.getTokensMetadata
            fetchedMetadataArray = await solanaEngine.fetchTokenMetadata([contractAddress]);
        } catch (metaError) {
            logApi.error('Failed to fetch token metadata via solanaEngine', { contractAddress, error: metaError.message, stack: metaError.stack });
            throw new ServiceError(500, `Failed to fetch metadata for token ${contractAddress}: ${metaError.message}`);
        }

        if (!fetchedMetadataArray || fetchedMetadataArray.length === 0 || !fetchedMetadataArray[0]) {
            throw new ServiceError(404, `Token metadata not found on-chain for ${contractAddress}.`);
        }
        const onChainTokenInfo = fetchedMetadataArray[0]; 

        // Define validation constants (could be from a shared config)
        const REQUIRED_FIELDS_IN_METADATA = ['name', 'symbol']; // URI might be optional depending on strictness
        const MAX_SYMBOL_LENGTH = 10;
        const MAX_NAME_LENGTH = 50;

        // Accessing Helius-like metadata structure (adjust if solanaEngine.fetchTokenMetadata returns different structure)
        const metadataFromHelius = onChainTokenInfo.content?.metadata;
        const jsonUriFromHelius = onChainTokenInfo.content?.json_uri;

        if (!metadataFromHelius) {
            throw new ServiceError(400, 'Metadata content not found in fetched token information.');
        }

        for (const field of REQUIRED_FIELDS_IN_METADATA) {
            if (!metadataFromHelius[field]) {
                throw new ServiceError(400, `Missing required metadata field: ${field}`);
            }
        }
        
        const tokenSymbol = metadataFromHelius.symbol;
        const tokenName = metadataFromHelius.name;
        // const tokenUri = jsonUriFromHelius || metadataFromHelius.uri; // Prefer json_uri if available
        // For now, let's assume metadataFromHelius.uri is the one we need as per old service
        const tokenUri = metadataFromHelius.uri; 

        if (!tokenSymbol || tokenSymbol.length === 0 || tokenSymbol.length > MAX_SYMBOL_LENGTH) {
            throw new ServiceError(400, `Token symbol '${tokenSymbol}' is invalid or exceeds max length of ${MAX_SYMBOL_LENGTH}.`);
        }
        if (!tokenName || tokenName.length === 0 || tokenName.length > MAX_NAME_LENGTH) {
            throw new ServiceError(400, `Token name '${tokenName}' is invalid or exceeds max length of ${MAX_NAME_LENGTH}.`);
        }
        // URI validation can be added if it's strictly required
        if (!tokenUri) {
            logApi.warn('Token metadata URI is missing for', { contractAddress });
            // Depending on policy, this might be an error or just a warning.
            // throw new ServiceError(400, `Token metadata URI is missing.`);
        }

        const verifiedMetadata = {
            name: tokenName,
            symbol: tokenSymbol,
            uri: tokenUri
        };
        logApi.info('Token metadata verified successfully via solanaEngine', { contractAddress, metadata: verifiedMetadata });
        // --- End of Step 1 New Logic ---

        // --- Step 2: Verify the payment (NEW LOGIC) --- 
        logApi.info('Verifying payment transaction...', { signature: transactionSignature, userWallet: user.wallet_address });

        // Calculate required amount (logic moved from deprecated service)
        // These config values should come from your main application config
        const baseSubmissionCostLamports = config.token_whitelist?.submission?.base_submission_cost_lamports || (1 * LAMPORTS_PER_SOL_V2); 
        const superAdminCostLamports = config.token_whitelist?.submission?.super_admin_cost_lamports || (0.01 * LAMPORTS_PER_SOL_V2);
        const discountPerLevelPercent = config.token_whitelist?.submission?.discount_per_level_percent || 1;
        const treasuryWalletAddress = config.token_whitelist?.submission?.treasury_wallet_address || config.degenduel_treasury_wallet;

        if (!treasuryWalletAddress) {
            throw new ServiceError(500, 'Treasury wallet address for whitelist submission is not configured.');
        }

        let userLevel = 0;
        if (user && user.id) {
            const userStats = await prisma.user_stats.findUnique({ where: { user_id: user.id }, select: { level: true } });
            userLevel = userStats?.level || 0;
        }
        
        const costBeforeDiscount = (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') ? superAdminCostLamports : baseSubmissionCostLamports;
        const discountAmount = (discountPerLevelPercent / 100) * userLevel * costBeforeDiscount;
        const requiredAmountLamports = Math.max(0, Math.round(costBeforeDiscount - discountAmount));

        logApi.info('Calculated whitelist submission fee', { 
            userLevel, costBeforeDiscount, discountAmount, requiredAmountLamports, treasury: treasuryWalletAddress 
        });

        if (requiredAmountLamports <= 0 && !(user.role === 'SUPER_ADMIN' || user.role === 'ADMIN')) {
            logApi.info('Zero submission fee calculated for non-admin, payment verification skipped.', logContext);
            // If zero fee, payment verification might be skipped, or a different logic applied.
            // For now, assume payment is required if amount > 0.
        } else if (requiredAmountLamports > 0) {
            const txDetails = await solanaEngine.executeConnectionMethod(
                'getTransaction', 
                transactionSignature, 
                { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
            );

            if (!txDetails || !txDetails.transaction) {
                throw new ServiceError(400, `Payment transaction ${transactionSignature} not found or failed.`);
            }
            if (txDetails.meta?.err) {
                throw new ServiceError(400, `Payment transaction ${transactionSignature} failed on-chain: ${JSON.stringify(txDetails.meta.err)}`);
            }

            // TODO: VERY IMPORTANT - Parse txDetails.transaction.message.instructions to find the actual transfer
            // This involves checking for SystemProgram.transfer to treasuryWalletAddress from user.wallet_address for requiredAmountLamports.
            // Or, if SPL tokens are used for payment, checking for an SPL transfer.
            // This parsing is complex and specific to the transaction structure.
            // Helius parsed transaction API (if exposed via solanaEngine) would simplify this immensely.
            let paymentVerified = false;
            // Placeholder: Assume we need to find a system transfer.
            const systemProgramId = '11111111111111111111111111111111';
            const instructions = txDetails.transaction.message.instructions;
            const accountKeys = txDetails.transaction.message.staticAccountKeys.map(pk => pk.toString()); // Get addresses as strings

            for (const instruction of instructions) {
                const programId = accountKeys[instruction.programIdIndex];
                if (programId === systemProgramId) {
                    // SystemProgram.transfer instruction specific checks
                    // Accounts: 0 = source (signer), 1 = destination
                    // Data: 4 bytes instruction discriminator (2 for transfer), 8 bytes lamports (u64le)
                    if (instruction.data && instruction.accounts.length >= 2) {
                        const instructionDataBuffer = Buffer.from(bs58.decode(instruction.data)); // instruction.data is base58 string
                        if (instructionDataBuffer.length === 12) { // Discriminator (4) + Lamports (8)
                            const instructionDiscriminator = instructionDataBuffer.readUInt32LE(0);
                            if (instructionDiscriminator === 2) { // SystemProgram Transfer instruction index
                                const transferredLamports = instructionDataBuffer.readBigUInt64LE(4);
                                
                                const sourceAccountIndex = instruction.accounts[0];
                                const destinationAccountIndex = instruction.accounts[1];
                                const sourceAddressFromTx = accountKeys[sourceAccountIndex];
                                const destinationAddressFromTx = accountKeys[destinationAccountIndex];

                                logApi.debug('Found SystemProgram.transfer instruction', {
                                    source: sourceAddressFromTx,
                                    destination: destinationAddressFromTx,
                                    lamports: transferredLamports.toString(),
                                    requiredLamports: requiredAmountLamports.toString(),
                                    expectedSource: user.wallet_address,
                                    expectedDestination: treasuryWalletAddress
                                });

                                if (sourceAddressFromTx === user.wallet_address &&
                                    destinationAddressFromTx === treasuryWalletAddress &&
                                    transferredLamports === BigInt(requiredAmountLamports)) {
                                    paymentVerified = true;
                                    logApi.info('Payment transaction successfully verified (SystemProgram.transfer).', {
                                        signature: transactionSignature,
                                        amount: requiredAmountLamports
                                    });
                                    break; // Payment verified, exit loop
                                }
                            }
                        }
                    }
                }
            }

            if (!paymentVerified) {
                throw new ServiceError(400, 'Payment verification failed: Exact transfer to treasury not confirmed.');
            }
            logApi.info('Payment transaction successfully verified.', { signature: transactionSignature, amount: requiredAmountLamports });

            // Log the verified payment transaction to Prisma
            try {
                const treasuryBalanceBefore = await solanaEngine.executeConnectionMethod('getBalance', treasuryWalletAddress);
                // Assuming getBalance returns { value: lamports }
                const treasuryBalanceBeforeLamports = treasuryBalanceBefore.value || BigInt(0);

                await prisma.transactions.create({
                    data: {
                        wallet_address: user.wallet_address, // Sender of the fee
                        type: 'WHITELIST_FEE', // Specific type for this transaction
                        amount: new Decimal(requiredAmountLamports.toString()), // Store as Decimal
                        // Storing treasury balance changes might be excessive, focus on fee itself
                        // balance_before: new Decimal(treasuryBalanceBeforeLamports.toString()), 
                        // balance_after: new Decimal((treasuryBalanceBeforeLamports + BigInt(requiredAmountLamports)).toString()),
                        description: `Token whitelist submission fee for ${contractAddress}`,
                        status: 'completed',
                        blockchain_signature: transactionSignature,
                        completed_at: new Date(txDetails.blockTime * 1000), // Use blockTime from txDetails if available
                        created_at: new Date(),
                        metadata: {
                            contract_address_submitted: contractAddress,
                            paid_to_treasury: treasuryWalletAddress,
                            user_id: user.id,
                            user_level: userLevel, // Calculated earlier
                            calculated_fee_lamports: requiredAmountLamports.toString(),
                            raw_tx_details_meta: txDetails.meta // Store raw meta for audit if needed
                        }
                    }
                });
                logApi.info('Whitelist fee payment transaction logged to database.', { signature: transactionSignature });
            } catch (dbError) {
                logApi.error('Failed to log whitelist payment transaction to database', { signature: transactionSignature, error: dbError.message, stack: dbError.stack });
                // Decide if this is a critical failure that should halt the process
                // For now, let's proceed but log the error. Could throw a ServiceError here.
            }

            logApi.info('Payment verification passed.');
        }
        // ... (Prisma logging for transaction to be added here) ...

        // --- Step 3: Add token to our database (NEW LOGIC) ---
        logApi.info('Adding token to database...', { contractAddress, metadata: verifiedMetadata });

        let tokenInDb;
        const existingTokenRecord = await prisma.tokens.findUnique({
            where: { address: contractAddress }
        });

        if (existingTokenRecord) {
            // Token exists, update it (e.g., if metadata changed or it was inactive)
            logApi.info('Token already exists in DB, updating its record.', { contractAddress });
            tokenInDb = await prisma.tokens.update({
                where: { address: contractAddress },
                data: {
                    name: verifiedMetadata.name,
                    symbol: verifiedMetadata.symbol,
                    uri: verifiedMetadata.uri,
                    chain: 'solana', // Assuming Solana
                    is_active: true, // Or based on your approval flow
                    last_verified_at: new Date(),
                    // Potentially update other metadata fields if your schema supports them
                    // image_url: onChainTokenInfo.content?.files?.find(f => f.uri && f.mime?.startsWith('image'))?.uri || onChainTokenInfo.content?.metadata?.image || null,
                }
            });
        } else {
            // Token does not exist, create it
            logApi.info('Token does not exist in DB, creating new record.', { contractAddress });
            tokenInDb = await prisma.tokens.create({
                data: {
                    address: contractAddress,
                    name: verifiedMetadata.name,
                    symbol: verifiedMetadata.symbol,
                    uri: verifiedMetadata.uri,
                    chain: 'solana',
                    is_active: true, // Or based on your approval flow
                    created_at: new Date(),
                    updated_at: new Date(),
                    last_verified_at: new Date(),
                    // Potentially add other metadata fields
                    // image_url: onChainTokenInfo.content?.files?.find(f => f.uri && f.mime?.startsWith('image'))?.uri || onChainTokenInfo.content?.metadata?.image || null,
                }
            });
        }
        logApi.info('Token successfully added/updated in database.', { tokenId: tokenInDb.id, contractAddress });
        // --- End of Step 3 New Logic ---

        logApi.info('Token whitelist request fully processed successfully.', {
            ...logContext,
            tokenId: tokenInDb.id,
            metadata: verifiedMetadata
        });

        res.json({
            success: true,
            message: "Token whitelisted successfully.", // Updated message
            token: {
                address: tokenInDb.address,
                name: tokenInDb.name,
                symbol: tokenInDb.symbol,
                status: tokenInDb.is_active ? 'active' : 'pending_approval' // Reflect actual status
            }
        });
    } catch (error) {
        logApi.error('Token whitelist request failed:', {
            ...logContext,
            errorName: error.name,
            errorMessage: error.message,
            errorStack: error.stack?.substring(0, 500)
        });

        const status = error instanceof ServiceError ? error.statusCode : 500;
        const message = error.message || 'Internal server error';

        res.status(status).json({
            success: false,
            error: message
        });
    }
});

/**
 * @swagger
 * /api/v2/tokens/{contractAddress}:
 *   delete:
 *     summary: Remove a token from the whitelist (Admin only)
 *     tags: [V2 Tokens]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: contractAddress
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for token removal
 *     responses:
 *       200:
 *         description: Token removed successfully
 *       401:
 *         description: Not authenticated or not an admin
 *       404:
 *         description: Token not found
 *       500:
 *         description: Server error
 */
router.delete('/:contractAddress', requireAuth, requireAdmin, async (req, res) => {
    const { contractAddress } = req.params;
    const { reason } = req.body;

    if (!reason) {
        return res.status(400).json({
            success: false,
            error: 'Reason for removal is required'
        });
    }

    try {
        // Forward deletion request to market data API
        const response = await fetch(`https://data.degenduel.me/api/tokens/${contractAddress}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        // Log admin action regardless of market data API response
        await AdminLogger.logAction(
            req.user.id,
            'TOKEN_REMOVAL',
            {
                contract_address: contractAddress,
                reason: reason,
                market_data_response: result
            },
            {
                ip_address: req.ip,
                user_agent: req.headers['user-agent']
            }
        );

        // Forward the market data API response
        res.json(result);
    } catch (error) {
        logApi.error('Failed to remove token:', {
            contractAddress,
            adminId: req.user.id,
            error: error.message
        });

        res.status(500).json({
            success: false,
            error: 'Failed to remove token'
        });
    }
});

export default router;