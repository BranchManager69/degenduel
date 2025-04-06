import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constants
const CONFIG_DIR = path.join(os.homedir(), '.ddcli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const WALLETS_DIR = path.join(os.homedir(), '.config', 'solana', 'id.json');
const ADDRESSES_ROOT_DIR = path.join('/home/websites/degenduel', 'addresses');
const KEYPAIRS_DIR = path.join(ADDRESSES_ROOT_DIR, 'keypairs');
const PRIVATE_WALLETS_DIR = path.join(KEYPAIRS_DIR, 'private');
const PUBLIC_WALLETS_DIR = path.join(KEYPAIRS_DIR, 'public');

// Function to load API keys from environment
function getApiKeyFromEnv(key) {
  // Check several possible environment variable names
  const possibleEnvVars = [
    `${key.toUpperCase()}_API_KEY`,
    `SOLANA_${key.toUpperCase()}_API_KEY`,
    `${key.toUpperCase()}_KEY`
  ];
  
  for (const envVar of possibleEnvVars) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }
  
  return null;
}

// Get API keys from environment
const heliusApiKey = getApiKeyFromEnv('helius');
const quiknodeApiKey = getApiKeyFromEnv('quiknode');

// Default RPC configurations - grouped by quality and type
const DEFAULT_RPC_CONFIGS = {
  // === PREMIUM HIGH-PERFORMANCE ENDPOINTS ===
  
  // Branch private RPC endpoints - Low latency, high performance
  'BranchRPC - HTTP': 'http://162.249.175.2:8898/',
  'BranchRPC - WS': 'ws://162.249.175.2:8900',
  'BranchRPC - gRPC': 'http://162.249.175.2:10000/',
  
  // Public endpoints (always available)
  'Public - Solana Mainnet': 'https://api.mainnet-beta.solana.com',
  'Public - Solana Mainnet WS': 'wss://api.mainnet-beta.solana.com',
  'Devnet - Solana HTTP': 'https://api.devnet.solana.com',
  'Devnet - Solana WS': 'wss://api.devnet.solana.com'
};

// Add API key-based endpoints only if keys are available
if (heliusApiKey) {
  // Helius Premium RPC endpoints - High throughput
  DEFAULT_RPC_CONFIGS['Helius - Staked HTTP'] = `https://staked.helius-rpc.com?api-key=${heliusApiKey}`;
  DEFAULT_RPC_CONFIGS['Helius - Eclipse HTTP'] = 'https://eclipse.helius-rpc.com/'; // No API key needed
  DEFAULT_RPC_CONFIGS['Helius - Geyser WS'] = `wss://atlas-mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  DEFAULT_RPC_CONFIGS['Helius - Standard HTTP'] = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  DEFAULT_RPC_CONFIGS['Helius - Standard WS'] = `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
}

if (quiknodeApiKey) {
  // QuikNode dedicated endpoints
  DEFAULT_RPC_CONFIGS['QuikNode - HTTP'] = `https://still-neat-log.solana-mainnet.quiknode.pro/${quiknodeApiKey}/`;
  DEFAULT_RPC_CONFIGS['QuikNode - WS'] = `wss://still-neat-log.solana-mainnet.quiknode.pro/${quiknodeApiKey}/`;
}

// Default config
const DEFAULT_CONFIG = {
  rpcEndpoints: DEFAULT_RPC_CONFIGS,
  activeRpc: 'BranchRPC - HTTP',
  activeWallet: null,
  wallets: {},
  settings: {
    defaultTimeout: 30000,
    transactionConfirmationLevel: 'confirmed',
    maxRetries: 3,
    debug: false
  },
  history: []
};

/**
 * Ensure the config directory exists
 */
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load the configuration from disk
 * @returns {Object} The loaded configuration
 */
function loadConfig() {
  ensureConfigDir();
  
  if (!fs.existsSync(CONFIG_FILE)) {
    // Create default config file if it doesn't exist
    saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
  
  try {
    const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(configData);
    
    // Merge with default config to ensure all fields exist
    return {
      ...DEFAULT_CONFIG,
      ...config,
      // Always make sure we have all the default RPC endpoints
      rpcEndpoints: {
        ...DEFAULT_RPC_CONFIGS,
        ...(config.rpcEndpoints || {})
      }
    };
  } catch (error) {
    console.error(`Error loading config: ${error.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save the configuration to disk
 * @param {Object} config The configuration to save
 */
function saveConfig(config) {
  ensureConfigDir();
  
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error(`Error saving config: ${error.message}`);
  }
}

/**
 * Categorize wallet based on its path
 * @param {string} walletPath The full path to the wallet
 * @returns {string} The wallet category ('private', 'public', or 'other')
 */
function categorizeWallet(walletPath) {
  if (walletPath.includes('/keypairs/private/')) {
    return 'private';
  } else if (walletPath.includes('/keypairs/public/')) {
    return 'public';
  } else {
    return 'other';
  }
}

/**
 * Scan for Solana wallets
 * @returns {Object} Dictionary of wallet name to wallet info
 */
function scanWallets() {
  const walletsMap = {
    private: {},
    public: {},
    other: {}
  };
  
  // Check standard Solana CLI location
  if (fs.existsSync(WALLETS_DIR)) {
    walletsMap.other['Default Solana CLI'] = {
      path: WALLETS_DIR,
      category: 'other'
    };
  }
  
  // Private wallets - these are the focus
  if (fs.existsSync(PRIVATE_WALLETS_DIR)) {
    scanWalletsRecursive(PRIVATE_WALLETS_DIR, walletsMap.private, 'private', 'private');
  }
  
  // Public wallets - read-only, treasury wallets
  if (fs.existsSync(PUBLIC_WALLETS_DIR)) {
    scanWalletsRecursive(PUBLIC_WALLETS_DIR, walletsMap.public, 'public', 'public');
  }
  
  // Combine all wallets into a flat map with their category info
  const wallets = {};
  
  // Add private wallets first (priority)
  Object.entries(walletsMap.private).forEach(([name, info]) => {
    wallets[`[PRIVATE] ${name}`] = info;
  });
  
  // Then public wallets
  Object.entries(walletsMap.public).forEach(([name, info]) => {
    wallets[`[PUBLIC] ${name}`] = info;
  });
  
  // Then other wallets
  Object.entries(walletsMap.other).forEach(([name, info]) => {
    wallets[`[OTHER] ${name}`] = info;
  });
  
  return wallets;
}

/**
 * Recursively scan a directory for wallet files
 * @param {string} dir Directory to scan
 * @param {Object} wallets Dictionary to populate with wallet paths
 * @param {string} prefix Path prefix for display
 * @param {string} category Wallet category (private, public, other)
 */
function scanWalletsRecursive(dir, wallets, prefix = '', category = 'other') {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const newPrefix = entry.name;
        scanWalletsRecursive(fullPath, wallets, newPrefix, category);
      } else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.key'))) {
        try {
          // Check if it's a valid keypair JSON file
          const content = fs.readFileSync(fullPath, 'utf8');
          const data = JSON.parse(content);
          
          // Simple validation - just check if it looks like a keypair
          if (Array.isArray(data) && data.length > 32) {
            const displayName = prefix 
              ? `${prefix}/${entry.name.replace(/\.(json|key)$/, '')}`
              : entry.name.replace(/\.(json|key)$/, '');
            
            // Store both path and category
            wallets[displayName] = {
              path: fullPath,
              category
            };
          }
        } catch (err) {
          // Not a valid JSON file or not a keypair, skip it
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning wallets in ${dir}: ${error.message}`);
  }
}

/**
 * Get the active RPC endpoint URL
 * @param {Object} config The configuration object
 * @returns {string} The active RPC endpoint URL
 */
function getActiveRpcUrl(config) {
  const activeRpcName = config.activeRpc || 'BranchRPC - HTTP';
  return config.rpcEndpoints[activeRpcName] || DEFAULT_RPC_CONFIGS['BranchRPC - HTTP'];
}

/**
 * Get the active wallet path
 * @param {Object} config The configuration object
 * @returns {string|null} The active wallet path or null if none is set
 */
function getActiveWalletPath(config) {
  if (!config.activeWallet || !config.wallets[config.activeWallet]) {
    return null;
  }
  
  // Check if wallet is stored in the new format (with path and category)
  const wallet = config.wallets[config.activeWallet];
  if (typeof wallet === 'object' && wallet.path) {
    return wallet.path;
  }
  
  // Backward compatibility for old format
  return wallet;
}

/**
 * Get the active wallet category
 * @param {Object} config The configuration object
 * @returns {string|null} The active wallet category or null if none is set
 */
function getActiveWalletCategory(config) {
  if (!config.activeWallet || !config.wallets[config.activeWallet]) {
    return null;
  }
  
  // Check if wallet is stored in the new format (with path and category)
  const wallet = config.wallets[config.activeWallet];
  if (typeof wallet === 'object' && wallet.category) {
    return wallet.category;
  }
  
  // Default category for backward compatibility
  return categorizeWallet(typeof wallet === 'string' ? wallet : '');
}

/**
 * Add a custom RPC endpoint
 * @param {Object} config The configuration object
 * @param {string} name Name for the RPC endpoint
 * @param {string} url URL of the RPC endpoint
 * @returns {Object} Updated configuration
 */
function addRpcEndpoint(config, name, url) {
  const updatedConfig = { ...config };
  
  updatedConfig.rpcEndpoints = {
    ...updatedConfig.rpcEndpoints,
    [name]: url
  };
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Remove a custom RPC endpoint
 * @param {Object} config The configuration object
 * @param {string} name Name of the RPC endpoint to remove
 * @returns {Object} Updated configuration
 */
function removeRpcEndpoint(config, name) {
  // Don't allow removing default endpoints
  if (DEFAULT_RPC_CONFIGS[name]) {
    return config;
  }
  
  const updatedConfig = { ...config };
  
  // Create a new object without the specified endpoint
  updatedConfig.rpcEndpoints = { ...updatedConfig.rpcEndpoints };
  delete updatedConfig.rpcEndpoints[name];
  
  // If the active RPC was removed, set to default
  if (updatedConfig.activeRpc === name) {
    updatedConfig.activeRpc = 'BranchRPC - HTTP';
  }
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Set the active RPC endpoint
 * @param {Object} config The configuration object
 * @param {string} name Name of the RPC endpoint to set as active
 * @returns {Object} Updated configuration
 */
function setActiveRpc(config, name) {
  if (!config.rpcEndpoints[name]) {
    return config;
  }
  
  const updatedConfig = {
    ...config,
    activeRpc: name
  };
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Set the active wallet
 * @param {Object} config The configuration object
 * @param {string} name Name of the wallet to set as active
 * @returns {Object} Updated configuration
 */
function setActiveWallet(config, name) {
  if (!config.wallets[name]) {
    return config;
  }
  
  const updatedConfig = {
    ...config,
    activeWallet: name
  };
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Update the wallet list
 * @param {Object} config The configuration object
 * @returns {Object} Updated configuration with fresh wallet list
 */
function refreshWallets(config) {
  const wallets = scanWallets();
  
  const updatedConfig = {
    ...config,
    wallets
  };
  
  // If active wallet is no longer valid, reset it
  if (updatedConfig.activeWallet && !wallets[updatedConfig.activeWallet]) {
    updatedConfig.activeWallet = Object.keys(wallets)[0] || null;
  }
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

/**
 * Update a general setting
 * @param {Object} config The configuration object
 * @param {string} key Setting key
 * @param {any} value Setting value
 * @returns {Object} Updated configuration
 */
function updateSetting(config, key, value) {
  const updatedConfig = {
    ...config,
    settings: {
      ...config.settings,
      [key]: value
    }
  };
  
  saveConfig(updatedConfig);
  return updatedConfig;
}

// Export the API
export default {
  loadConfig,
  saveConfig,
  scanWallets,
  getActiveRpcUrl,
  getActiveWalletPath,
  getActiveWalletCategory,
  categorizeWallet,
  addRpcEndpoint,
  removeRpcEndpoint,
  setActiveRpc,
  setActiveWallet,
  refreshWallets,
  updateSetting
};