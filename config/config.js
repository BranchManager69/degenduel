// config/config.js

/**
 * 2025-03-25: Good!
 */

import dotenv from 'dotenv';
dotenv.config();

// Helpful DegenDuel API endpoints
const LOBBY_API = process.env.LOBBY_API; // future
const REFLECTIONS_API = process.env.REFLECTIONS_API; // future
const DD_SERV_API = process.env.DD_SERV_API; // deprecating
const DATA_API = process.env.DATA_API; // deprecating
const GAME_API = process.env.GAME_API; // deprecating
// Fallback API in case data service is unavailable
const LOCAL_FALLBACK_API = null; // (DISABLED to avoid circular dependency issue during startup)
////const LOCAL_PORT = process.env.PORT || process.env.API_PORT || 3004;

// Solana RPCs
// -- Default RPC URL:
const RPC_URL = process.env.SOLANA_RPC_ENDPOINT;
// -- All Helius URLs:
const RPC_URL_MAINNET_HTTP = process.env.SOLANA_MAINNET_HTTP || '';
const RPC_URL_MAINNET_WSS = process.env.SOLANA_MAINNET_WSS || '';
const RPC_URL_DEVNET_HTTP = process.env.SOLANA_DEVNET_HTTP || '';
const RPC_URL_DEVNET_WSS = process.env.SOLANA_DEVNET_WSS || '';

// Throw error if no RPC URL is configured
if (!RPC_URL) {
  throw new Error('RPC_URL must be set (use of public Solana RPC endpoints has been intentionally disabled)');
}

// Master config object
const config = {
  // RPC URLs:
  rpc_urls: {
    primary: RPC_URL,
    mainnet_http: RPC_URL_MAINNET_HTTP,
    mainnet_wss: RPC_URL_MAINNET_WSS,
    devnet_http: RPC_URL_DEVNET_HTTP,
    devnet_wss: RPC_URL_DEVNET_WSS,
  },
  // Secure middleware config:
  secure_middleware: {
    branch_manager_header_token: process.env.BRANCH_MANAGER_ACCESS_SECRET,
    branch_manager_login_secret: process.env.BRANCH_MANAGER_LOGIN_SECRET,
    branch_manager_ip_address: process.env.BRANCH_MANAGER_IP_ADDRESS,
  },
  // Some master wallet stuff:
  master_wallet: {
    treasury_address: process.env.DD_MASTER_WALLET, // new
    address: process.env.DD_MASTER_WALLET, // TODO: deprecate
  },
  // Internal transaction types:
  transaction_types: {
    PRIZE_PAYOUT: 'PRIZE_PAYOUT',
    CONTEST_WALLET_RAKE: 'CONTEST_WALLET_RAKE',
    CONTEST_ENTRY: 'CONTEST_ENTRY',
    TOKEN_PURCHASE: 'TOKEN_PURCHASE',
    TOKEN_SALE: 'TOKEN_SALE',
    WITHDRAWAL: 'WITHDRAWAL',
    DEPOSIT: 'DEPOSIT'
  },
  // Internal transaction statuses:
  transaction_statuses: {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled'
  },
  // DegenDuel server port:
  port:
    process.env.PORT || process.env.API_PORT || 3004,
  // JWT secret:
  jwt: {
    secret: process.env.JWT_SECRET
  },
  // DD API URLs:
  api_urls: {
    dd_serv: DD_SERV_API,
    data: DATA_API,
    game: GAME_API,
    lobby: LOBBY_API,
    reflections: REFLECTIONS_API,
    fallback: LOCAL_FALLBACK_API,
  },
  
  // Solana timeout settings:
  solana_timeouts: {

    // RPC initial connection timeout:
    rpc_initial_connection_timeout:
      process.env.SOLANA_RPC_INITIAL_CONNECTION_TIMEOUT || 45, // seconds
    // RPC reconnection timeout:
    rpc_reconnection_timeout:
      process.env.SOLANA_RPC_RECONNECTION_TIMEOUT || 45, // seconds
    // RPC transaction confirmation timeout:
    rpc_transaction_confirmation_timeout:
      process.env.SOLANA_RPC_TRANSACTION_CONFIRMATION_TIMEOUT || 120, // seconds
    // RPC rate limit retry delay:
    rpc_rate_limit_retry_delay:
      process.env.SOLANA_RPC_RATE_LIMIT_RETRY_DELAY || 15, // seconds
    // RPC rate limit retry backoff factor:
    rpc_rate_limit_retry_backoff_factor:
      process.env.SOLANA_RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR || 2, // factor
    // RPC rate limit max delay:
    rpc_rate_limit_max_delay:
      process.env.SOLANA_RPC_RATE_LIMIT_MAX_DELAY || 30, // seconds
    // RPC batch size for wallet operations:
    rpc_wallet_batch_size:
      process.env.SOLANA_RPC_WALLET_BATCH_SIZE || 10, // number of wallets per batch
  
  },

  // Service interval settings:
  service_intervals: {
    
    /* CONTEST WALLET SERVICE */

    // Contest wallet check cycle interval:
    contest_wallet_check_cycle_interval:
      process.env.CONTEST_WALLET_CHECK_CYCLE_INTERVAL || 60, // seconds
    // Contest wallet seconds between transactions during funds reclaim/recovery:
    contest_wallet_seconds_between_transactions_during_recovery:
      process.env.CONTEST_WALLET_SECONDS_BETWEEN_TRANSACTIONS_DURING_RECOVERY || 2, // seconds
    
    /* CONTEST EVALUATION SERVICE */

    // Contest evaluation check interval:
    contest_evaluation_check_interval:
      process.env.CONTEST_EVALUATION_CHECK_INTERVAL || 30, // seconds
    // Auto-cancel underparticipated contests window:
    contest_evaluation_auto_cancel_window_days:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_DAYS || 0, // days
    contest_evaluation_auto_cancel_window_hours:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_HOURS || 0, // hours
    contest_evaluation_auto_cancel_window_minutes:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_MINUTES || 0, // minutes
    contest_evaluation_auto_cancel_window_seconds:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_SECONDS || 59, // seconds
    // Contest evaluation retry delay:
    contest_evaluation_retry_delay:
      process.env.CONTEST_EVALUATION_RETRY_DELAY || 5, // seconds
    // Contest evaluation circuit breaker reset timeout:
    contest_evaluation_circuit_breaker_reset_timeout:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_RESET_TIMEOUT || 120, // seconds
    // Contest evaluation circuit breaker min healthy period:
    contest_evaluation_circuit_breaker_min_healthy_period:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_MIN_HEALTHY_PERIOD || 180, // seconds
    // Contest evaluation circuit breaker backoff initial delay:
    contest_evaluation_circuit_breaker_backoff_initial_delay:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_BACKOFF_INITIAL_DELAY || 1000, // milliseconds
    // Contest evaluation circuit breaker backoff max delay:
    contest_evaluation_circuit_breaker_backoff_max_delay:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_BACKOFF_MAX_DELAY || 30000, // milliseconds
  },

  // Service threshold settings:
  service_thresholds: {
    
    /* CONTEST WALLET SERVICE */

    // Contest wallet minimum balance for reclaim:
    contest_wallet_min_balance_for_reclaim:
      process.env.CONTEST_WALLET_MIN_BALANCE_FOR_RECLAIM || 0.001, // SOL
    // Contest wallet minimum amount to transfer:
    contest_wallet_min_amount_to_transfer:
      process.env.CONTEST_WALLET_MIN_AMOUNT_TO_TRANSFER || 0.0005, // SOL
    // Contest wallet minimum amount to leave in each wallet during recovery:
    contest_wallet_min_amount_to_leave_in_each_wallet_during_recovery:
      process.env.CONTEST_WALLET_MIN_AMOUNT_TO_LEAVE_IN_EACH_WALLET_DURING_RECOVERY || 0.0001, // SOL
    // Contest wallet acceptable loss amount per wallet during recovery:
    contest_wallet_acceptable_loss_amount_per_wallet_during_recovery:
      process.env.CONTEST_WALLET_ACCEPTABLE_LOSS_AMOUNT_PER_WALLET_DURING_RECOVERY || 0.0001, // SOL
    // Contest wallet test recovery amount per wallet:
    contest_wallet_test_recovery_amount_per_wallet:
      process.env.CONTEST_WALLET_TEST_RECOVERY_AMOUNT_PER_WALLET || 0.00420690, // SOL
    
    /* CONTEST EVALUATION SERVICE */

    // Contest evaluation max retries:
    contest_evaluation_max_retries:
      process.env.CONTEST_EVALUATION_MAX_RETRIES || 3, // max retries for contest evaluation
    // Contest evaluation circuit breaker backoff factor:
    contest_evaluation_circuit_breaker_backoff_factor:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_BACKOFF_FACTOR || 2, // exponential backoff factor
    // Contest evaluation circuit breaker failure threshold:
    contest_evaluation_circuit_breaker_failure_threshold:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_FAILURE_THRESHOLD || 10, // number of service failures before circuit breaker trips
    // Contest evaluation max parallel evaluations:
    contest_evaluation_max_parallel_evaluations:
      process.env.CONTEST_EVALUATION_MAX_PARALLEL_EVALUATIONS || 5, // max concurrent contest evaluations
    // Contest evaluation min prize amount:
    contest_evaluation_min_prize_amount:
      process.env.CONTEST_EVALUATION_MIN_PRIZE_AMOUNT || 0.001, // SOL - min amount to distribute as prize
  
  },
  // Logtail config:
  logtail: {
    token: process.env.LOGTAIL_TOKEN,
    endpoint: process.env.LOGTAIL_ENDPOINT,
    source: process.env.LOGTAIL_SOURCE,
    log_dir: process.env.LOG_DIR,
    silent_mode: process.env.SILENT_MODE === 'true' || false,
    console_log_level: process.env.CONSOLE_LOG_LEVEL || 'info',
    file_log_level: process.env.FILE_LOG_LEVEL || 'info',
  },
  // Logging settings:
  logging: {
    verbose: process.env.VERBOSE_LOGGING === 'true' || false,
    request_logging: process.env.REQUEST_LOGGING === 'true' || true,
  },
  // DegenDuel treasury wallet:
  degenduel_treasury_wallet:
    process.env.TREASURY_WALLET_ADDRESS,
  // Token submission cost:
  token_submission_cost:
    process.env.TOKEN_SUBMISSION_COST,
  // Token submission discount percentage per level:
  token_submission_discount_percentage_per_level:
    process.env.TOKEN_SUBMISSION_DISCOUNT_PERCENTAGE_PER_LEVEL,
  // Helper function to get environment:
  getEnvironment: (origin) => {
    // First check if we're explicitly in development mode based on NODE_ENV
    if (process.env.NODE_ENV === 'development') {
      return 'development';
    }
    // Otherwise check origin, but still respect NODE_ENV if it exists
    if (!origin) {
      return process.env.NODE_ENV || 'production'; // Default to production if NODE_ENV not set
    }
    return origin.includes('localhost') || origin.includes('127.0.0.1') ? 'development' : 'production';
  },
  // Device authentication settings:
  device_auth_enabled: 
    process.env.DEVICE_AUTH_ENABLED === 'true' || false,
  device_auth: {
    max_devices_per_user: parseInt(process.env.MAX_DEVICES_PER_USER || '10'),
    auto_authorize_first_device: process.env.AUTO_AUTHORIZE_FIRST_DEVICE === 'true' || true
  },
  // Debug modes:
  debug_modes: {
    secure_middleware: process.env.SECURE_MIDDLEWARE_DEBUG_MODE || 'false',
    auth: process.env.DD_API_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.DD_API_DEBUG_MODE || 'false',
  },
  debug_mode: 
    process.env.DD_API_DEBUG_MODE || 'false',
};

// Validate Solana config
export const validateSolanaConfig = () => {
    const required = {
        WALLET_ENCRYPTION_KEY: process.env.WALLET_ENCRYPTION_KEY,
        SOLANA_MAINNET_HTTP: process.env.SOLANA_MAINNET_HTTP,
        SOLANA_MAINNET_WSS: process.env.SOLANA_MAINNET_WSS,
    };

    // Check for missing required config:
    const missing = Object.entries(required)
        .filter(([key, value]) => !value)
        .map(([key]) => key);

    // Throw error if missing required config:
    if (missing.length > 0) {
        throw new Error(`Missing required Solana configuration: ${missing.join(', ')}`);
    }

    // Validate WALLET_ENCRYPTION_KEY format
    if (!/^[a-f0-9]{64}$/i.test(process.env.WALLET_ENCRYPTION_KEY)) {
        throw new Error('WALLET_ENCRYPTION_KEY must be a 64-character hex string');
    }
};

// Export config
export { config };
export default config;