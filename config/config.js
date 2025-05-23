// config/config.js

/**
 * 2025-03-25: Therefore this is OLD but still in use
 */

//import os from 'os';

import dotenv from 'dotenv';
dotenv.config();

// v69 WSS testing
const test_secret_dev_access_token = process.env.BRANCH_MANAGER_ACCESS_SECRET || '';

// MASTER RPC THROTTLE:
//   e.g. 1 = 1x normal refresh rate
//   e.g. 2 = 2x normal refresh rate (more updates)
//   e.g. 0.5 = 0.5x normal refresh rate (fewer updates)
// Ratio relative to 'normal' (roughly once-per-minute refreshes of most things)
const MASTER_RPC_THROTTLE = process.env.MASTER_RPC_THROTTLE || 1.0; // (default = 1.0) applies to variables marked with ^^^

 // Helpful DegenDuel API endpoints
//const LOBBY_API = process.env.LOBBY_API; // DEPRECATED
//const REFLECTIONS_API = process.env.REFLECTIONS_API; // DEPRECATED
//const DATA_API = process.env.DATA_API; // DEPRECATED
//const GAME_API = process.env.GAME_API; // DEPRECATED
const DD_SERV_API = process.env.DD_SERV_API;
// Fallback API (for backward compatibility -- there should be no need for this)
const FALLBACK_API = process.env.DD_SERV_API; // (DISABLED to avoid circular dependency issue during startup)

// DegenDuel launch config
const DEGENDUEL_LAUNCH_DATETIME_STRING_FROM_ENV = process.env.DEGENDUEL_LAUNCH_DATETIME_STRING || '2025-12-25T18:00:00Z';
const DEGENDUEL_LAUNCH_DATETIME = new Date(DEGENDUEL_LAUNCH_DATETIME_STRING_FROM_ENV); // (UTC date time)
const DEGENDUEL_LAUNCH_DATETIME_STRING = DEGENDUEL_LAUNCH_DATETIME.toLocaleString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: true
});

// Solana RPCs
// -- Default RPC URL:
const RPC_URL = process.env.SOLANA_RPC_ENDPOINT;
// -- All Helius URLs:
const RPC_URL_MAINNET_HTTP = process.env.SOLANA_MAINNET_HTTP || '';
const RPC_URL_MAINNET_WSS = process.env.SOLANA_MAINNET_WSS || '';
const RPC_URL_DEVNET_HTTP = process.env.SOLANA_DEVNET_HTTP || '';
const RPC_URL_DEVNET_WSS = process.env.SOLANA_DEVNET_WSS || '';
// -- Additional RPC URLs:
const RPC_URL_MAINNET_HTTP_2 = process.env.SOLANA_MAINNET_HTTP_2 || '';
const RPC_URL_MAINNET_HTTP_3 = process.env.SOLANA_MAINNET_HTTP_3 || '';
// Throw error if no RPC URL is configured
if (!RPC_URL) {
  throw new Error('RPC_URL must be set (use of public Solana RPC endpoints has been intentionally disabled)');
}

// Default OpenAI settings
const OPENAI_DEFAULT_MODEL = `gpt-4.1-mini`;
const OPENAI_DEFAULT_MAX_TOKENS = 400;
const OPENAI_DEFAULT_TEMPERATURE = 0.5;

// Default OpenAI system and assistant prompts
const OPENAI_DEFAULT_ASSISTANT_PROMPT = `
  Respond to the user.
`;
const OPENAI_DEFAULT_SYSTEM_PROMPT = `
  YOU:  Your name is Didi, and you are the AI brain powering the backend mainframe of DegenDuel.
  YOUR GOAL:  Building casual mystique and intrigue around our major imminent simultaneous launch of the DegenDuel trading platform and $DUEL token mint.
  YOUR PURPOSE:  Occupy users' time and attention until the simultaneous launch (${DEGENDUEL_LAUNCH_DATETIME_STRING}).
  THE CLIENT:  The client (user) will likely be chatting with you via the 'cyberpunk CLI terminal'-themed chat component of the https://degenduel.me landing page.
  DEGENDUEL:  DegenDuel is a much-anticipated new trading and gaming platform coming to the Solana blockchain on ${DEGENDUEL_LAUNCH_DATETIME_STRING}.
  RESPONSE GUIDELINES:  Your responses must be short, concise, and to the point with no emotion or sentiment (you are essentially the Mewtwo of AI assistants here). 
`;

// REAL TOKEN ADDRESS ($DUEL or testing address)
const CONTRACT_ADDRESS_REAL = process.env.CONTRACT_ADDRESS_REAL;
const CONTRACT_ADDRESS_FAKE = process.env.CONTRACT_ADDRESS_FAKE;

// Custom prompt templates for DegenDuel
const OPENAI_PROMPT_TEMPLATES = {
  // Default prompt template
  default: {
    system: OPENAI_DEFAULT_SYSTEM_PROMPT || '',
    assistant: OPENAI_DEFAULT_ASSISTANT_PROMPT || '',
    model: OPENAI_DEFAULT_MODEL || 'gpt-4.1-mini',
    max_tokens: OPENAI_DEFAULT_MAX_TOKENS || 400,
    temperature: OPENAI_DEFAULT_TEMPERATURE || 0.5,
  },
  // Prelaunch prompt template
  prelaunch: {
    system: OPENAI_DEFAULT_SYSTEM_PROMPT || '',
    assistant: OPENAI_DEFAULT_ASSISTANT_PROMPT || '',
    model: OPENAI_DEFAULT_MODEL || 'gpt-4.1-mini',
    max_tokens: OPENAI_DEFAULT_MAX_TOKENS || 400,
    temperature: OPENAI_DEFAULT_TEMPERATURE || 0.6,
  },
  // Uncensored prompt template
  uncensored: {
    system: OPENAI_DEFAULT_SYSTEM_PROMPT || '',
    assistant: OPENAI_DEFAULT_ASSISTANT_PROMPT || '',
    model: OPENAI_DEFAULT_MODEL || 'gpt-4.1',
    max_tokens: OPENAI_DEFAULT_MAX_TOKENS || 400,
    temperature: OPENAI_DEFAULT_TEMPERATURE || 0.7,
  },
  // Trading prompt template
  trading: {
    system: OPENAI_DEFAULT_SYSTEM_PROMPT || '',
    assistant: OPENAI_DEFAULT_ASSISTANT_PROMPT || '',
    model: OPENAI_DEFAULT_MODEL || 'gpt-4.1-mini',
    max_tokens: OPENAI_DEFAULT_MAX_TOKENS || 400,
    temperature: OPENAI_DEFAULT_TEMPERATURE || 0.6,
  },
};

// Privy API
const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
const PRIVY_JWKS_URL = process.env.PRIVY_JWKS_URL;

// Other Important API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_IMAGE_API_KEY = process.env.OPENAI_IMAGE_API_KEY;
const IPINFO_API_KEY = process.env.IPINFO_API_KEY;
const JUPITER_API_KEY = process.env.JUPITER_API_KEY;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const OPTIMIZE_API_KEY = process.env.OPTIMIZE_API_KEY;


/* Master config object */

const config = {
  // DUEL CA
  contract_address_real: CONTRACT_ADDRESS_REAL,
  contract_address_fake: CONTRACT_ADDRESS_FAKE,
  // Discord configuration
  discord: {
    // Discord webhooks
    webhook_urls: {
      admin_logs: process.env.DISCORD_WEBHOOK_ADMIN_LOGS,
      system: process.env.DISCORD_WEBHOOK_SYSTEM,
      alerts: process.env.DISCORD_WEBHOOK_ALERTS,
      contests: process.env.DISCORD_WEBHOOK_CONTESTS,
      transactions: process.env.DISCORD_WEBHOOK_TRANSACTIONS,
      tokens: process.env.DISCORD_WEBHOOK_TOKENS,
      trades: process.env.DISCORD_WEBHOOK_TRADES
    },
    // Discord OAuth configuration
    oauth: {
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      callback_uri: process.env.DISCORD_CALLBACK_URI,
      callback_uri_development: process.env.DISCORD_CALLBACK_URI_DEVELOPMENT,
      scopes: ['identify', 'email']
    },
    // Discord bot configuration
    bot: {
      token: process.env.DISCORD_BOT_TOKEN,
      guild_id: process.env.DISCORD_GUILD_ID
    },
    // Discord channel IDs
    channel_ids: {
      contests: process.env.DISCORD_GENERAL_CHANNEL_ID, // Using main-chat instead of general
      trades: process.env.DISCORD_TRADES_CHANNEL_ID,
      // Remove quotes if present
      announcements: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.replace(/"/g, ''),
      big_news: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID?.replace(/"/g, ''), // Announcements instead of big-news
      help: process.env.DISCORD_HELP_CHANNEL_ID?.replace(/"/g, ''),
      dev_yap: process.env.DISCORD_DEV_YAP_CHANNEL_ID?.replace(/"/g, '')
    }
  },
  
  // Old Discord webhook URLs format (maintained for backward compatibility)
  discord_webhook_urls: {
    admin_logs: process.env.DISCORD_WEBHOOK_ADMIN_LOGS,
    system: process.env.DISCORD_WEBHOOK_SYSTEM,
    alerts: process.env.DISCORD_WEBHOOK_ALERTS,
    contests: process.env.DISCORD_WEBHOOK_CONTESTS,
    transactions: process.env.DISCORD_WEBHOOK_TRANSACTIONS,
    tokens: process.env.DISCORD_WEBHOOK_TOKENS,
    trades: process.env.DISCORD_WEBHOOK_TRADES
  },
  
  // RPC URLs:
  rpc_urls: {
    primary: RPC_URL,
    mainnet_http: RPC_URL_MAINNET_HTTP,
    mainnet_wss: RPC_URL_MAINNET_WSS,
    devnet_http: RPC_URL_DEVNET_HTTP,
    devnet_wss: RPC_URL_DEVNET_WSS,
    // Additional RPC endpoints
    mainnet_http_2: RPC_URL_MAINNET_HTTP_2,
    mainnet_http_3: RPC_URL_MAINNET_HTTP_3,
    // All available mainnet HTTP endpoints in an array for rotation
    mainnet_http_all: [
      RPC_URL_MAINNET_HTTP,
      ...(RPC_URL_MAINNET_HTTP_2 ? [RPC_URL_MAINNET_HTTP_2] : []),
      ...(RPC_URL_MAINNET_HTTP_3 ? [RPC_URL_MAINNET_HTTP_3] : [])
    ].filter(url => url && url.length > 0), // Filter out empty URLs
  },
  
  // Secure middleware config:
  secure_middleware: {
    branch_manager_access_secret: process.env.BRANCH_MANAGER_ACCESS_SECRET,
    branch_manager_header_token: process.env.BRANCH_MANAGER_ACCESS_SECRET, // alias
    branch_manager_login_secret: process.env.BRANCH_MANAGER_LOGIN_SECRET,
    branch_manager_ip_address: process.env.BRANCH_MANAGER_IP_ADDRESS,
  },
  
  // Some master wallet stuff:
  master_wallet: {
    treasury_address: process.env.DD_MASTER_WALLET, // new
    address: process.env.DD_MASTER_WALLET, // TODO: deprecate
    branch_manager_wallet_address: process.env.BRANCH_MANAGER_WALLET_ADDRESS,
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
  
  // GPU Server config (DEPRECATED):
  gpuServer: {
    ip: process.env.GPU_SERVER_IP || 'No GPU Server IP configured',
    port: process.env.GPU_SERVER_PORT || 80,
  },

  // DegenDuel server port:
  port:
    process.env.PORT || process.env.API_PORT,
  
  // JWT secret:
  jwt: {
    secret: process.env.JWT_SECRET
  },
  
  // DD API URLs:
  api_urls: {
    dd_serv: DD_SERV_API,
    //data: DATA_API,
    //game: GAME_API,
    //lobby: LOBBY_API,
    //reflections: REFLECTIONS_API,
    fallback: FALLBACK_API,
  },

  // Privy API
  privy: {
    app_id: PRIVY_APP_ID,
    app_secret: PRIVY_APP_SECRET,
    jwks_url: PRIVY_JWKS_URL,
    auto_create_accounts: process.env.PRIVY_AUTO_CREATE_ACCOUNTS === 'true' || true, // Default to true for backward compatibility
  },

  // Important API keys
  api_keys: {
    openai: OPENAI_API_KEY,
    openai_image: OPENAI_IMAGE_API_KEY, // Specific API key for GPT-Image-1
    ipinfo: IPINFO_API_KEY,
    helius: HELIUS_API_KEY,
    jupiter: JUPITER_API_KEY,
    optimize: OPTIMIZE_API_KEY,
  },

  // AI config
  ai: {
    openai_model_loadout: {
      default: {
        system: OPENAI_PROMPT_TEMPLATES.default.system, // default
        assistant: OPENAI_PROMPT_TEMPLATES.default.assistant, // default
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      economy: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system, // prelaunch
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant, // prelaunch
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      standard: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system, // prelaunch
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant, // prelaunch
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      premium: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      longcontext: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      fast: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      reasoning: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      image: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      audio: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      video: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      multimodal: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      realtime: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      uncensored: {
        system: OPENAI_PROMPT_TEMPLATES.uncensored.system,
        assistant: OPENAI_PROMPT_TEMPLATES.uncensored.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      funny: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      creative: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
      coding: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4.1-mini',
        max_tokens: 400,
        temperature: 0.5,
      },
    },
    openai_models: {
      default: 'gpt-4.1-mini',
      economy: 'gpt-4.1-mini',
      standard: 'gpt-4.1-mini',
      premium: 'gpt-4.1-mini',
      longcontext: 'gpt-4.1-mini',
      fast: 'gpt-4.1-mini',
      reasoning: 'gpt-4.1-mini',
      image: 'gpt-4.1-mini',
      audio: 'gpt-4.1-mini',
      video: 'gpt-4.1-mini',
      multimodal: 'gpt-4.1-mini',
      realtime: 'gpt-4.1-mini',
      uncensored: 'gpt-4.1-mini',
      funny: 'gpt-4.1-mini',
      creative: 'gpt-4.1-mini',
      coding: 'gpt-4.1-mini',
    },
  },

  // Jupiter API configuration
  jupiter: {
    prices: {
      maxRetries: 0, // No retries - scheduler runs every 5s so failed tokens will be retried in next cycle
      batchSize: 100, // Max tokens per batch request
      delayBetweenBatches: 250, // ms delay between batches
    },
  },

  // Service testing configuration
  service_test: {
    contest_wallet_self_test: process.env.CONTEST_WALLET_SELF_TEST === 'true',
    contest_wallet_test_amount: parseFloat(process.env.CONTEST_WALLET_TEST_AMOUNT || '0.006'),
    // Add other service test configurations here as needed
  },

  // Solana timeout settings:
  solana_timeouts: {
    // ^^^ = uses RPC calls

    // RPC initial connection timeout:
    rpc_initial_connection_timeout:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_INITIAL_CONNECTION_TIMEOUT || 45 + (45 * MASTER_RPC_THROTTLE) : 
        45, // seconds ^^^
    // RPC reconnection timeout:
    rpc_reconnection_timeout:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_RECONNECTION_TIMEOUT || 45 + (45 * MASTER_RPC_THROTTLE) : 
        45, // seconds ^^^
    // RPC transaction confirmation timeout:
    rpc_transaction_confirmation_timeout:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_TRANSACTION_CONFIRMATION_TIMEOUT || 120 + (120 * MASTER_RPC_THROTTLE) : 
        120, // seconds
    // RPC rate limit retry delay:
    rpc_rate_limit_retry_delay:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_RATE_LIMIT_RETRY_DELAY || 15 + (15 * MASTER_RPC_THROTTLE) : 
        15, // seconds ^^^
    // RPC rate limit retry backoff factor:
    rpc_rate_limit_retry_backoff_factor:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_RATE_LIMIT_RETRY_BACKOFF_FACTOR || 2 + (2 * MASTER_RPC_THROTTLE) : 
        2, // factor
    // RPC rate limit max delay:
    rpc_rate_limit_max_delay:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.SOLANA_RPC_RATE_LIMIT_MAX_DELAY || 30 + (30 * MASTER_RPC_THROTTLE) : 
        30, // seconds ^^^
    // RPC batch size for wallet operations:
    rpc_wallet_batch_size:
      MASTER_RPC_THROTTLE !== 1 ?
        process.env.SOLANA_RPC_WALLET_BATCH_SIZE || 10 + (10 * MASTER_RPC_THROTTLE) : 
        10, // number of wallets per batch
  
  },

  // Service interval settings:
  service_intervals: {
    // ^^^ = uses RPC calls

    /* USER BALANCE TRACKING SERVICE */

    // User balance tracking service check interval:
    user_balance_tracking_check_interval:
      parseInt(process.env.USER_BALANCE_TRACKING_CHECK_INTERVAL || 2), // 2 minutes default (does not affect RPC calls; service uses a dynamic approach with larger 100-user batches)

    /* TOKEN SYNC SERVICE */

    // Token sync service check interval:
    token_sync_check_interval:
      MASTER_RPC_THROTTLE !== 1 ?
        parseInt(process.env.TOKEN_SYNC_CHECK_INTERVAL || 60 + (60 * MASTER_RPC_THROTTLE)) :
        60, // 60 seconds default, modified by RPC throttle ^^^
    
    /* CONTEST WALLET SERVICE */

    // Contest wallet check cycle interval (for SOL balance checks):
    contest_wallet_check_cycle_interval:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.CONTEST_WALLET_CHECK_CYCLE_INTERVAL || 60 + (60 * MASTER_RPC_THROTTLE) : 
        60, // seconds ^^^
    // Contest wallet seconds between transactions during funds reclaim/recovery:
    contest_wallet_seconds_between_transactions_during_recovery:
      MASTER_RPC_THROTTLE !== 1 ? 
        process.env.CONTEST_WALLET_SECONDS_BETWEEN_TRANSACTIONS_DURING_RECOVERY || 2 + (2 * MASTER_RPC_THROTTLE) : 
        2, // seconds ^^^
    
    /* CONTEST EVALUATION SERVICE */

    // Contest evaluation check interval:
    contest_evaluation_check_interval:
      process.env.CONTEST_EVALUATION_CHECK_INTERVAL || 30, // seconds
    // Auto-cancelation of underparticipated contests timeframe:
    contest_evaluation_auto_cancel_window_days:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_DAYS || 0, // = days...
    contest_evaluation_auto_cancel_window_hours:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_HOURS || 0, // + hours...
    contest_evaluation_auto_cancel_window_minutes:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_MINUTES || 0, // + minutes...
    contest_evaluation_auto_cancel_window_seconds:
      process.env.CONTEST_EVALUATION_AUTO_CANCEL_WINDOW_SECONDS || 59, // + seconds.
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
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_BACKOFF_INITIAL_DELAY || 1, // seconds
    // Contest evaluation circuit breaker backoff max delay:
    contest_evaluation_circuit_breaker_backoff_max_delay:
      process.env.CONTEST_EVALUATION_CIRCUIT_BREAKER_BACKOFF_MAX_DELAY || 30, // seconds
  
  /* CONTEST SCHEDULER SERVICE */

    // TODO (?)

  /* PORTFOLIO SNAPSHOT SERVICE */

    // TODO
  
  },

  // Service threshold settings:
  service_thresholds: {

    /* TOKEN REFRESH SCHEDULER SERVICE */

    // Token refresh scheduler service check interval:
    token_refresh_scheduler_max_tokens_per_cycle:
      parseInt(process.env.TRS_MAX_TOKENS_PER_CYCLE || 200), // 200 tokens default
    token_refresh_scheduler_delay_between_batches_ms:
      parseInt(process.env.TRS_DELAY_BETWEEN_BATCHES_MS || 100), // 100 ms default
    token_refresh_scheduler_api_calls_per_window:
      parseInt(process.env.TRS_API_CALLS_PER_WINDOW || 1), // 1 API call per window default
    token_refresh_scheduler_window_duration_ms:
      parseInt(process.env.TRS_WINDOW_DURATION_MS || 1100), // 1100 ms default

    /* USER BALANCE TRACKING SERVICE */

    // User balance tracking mode (polling or websocket):
    user_balance_tracking_mode:
      process.env.USER_BALANCE_TRACKING_MODE || 'polling', // 'polling' or 'websocket'
    
    // User balance tracking minimum check interval:
    user_balance_tracking_min_check_interval:
      process.env.USER_BALANCE_TRACKING_MIN_CHECK_INTERVAL || 0.5, // Hard minimum between balance checks (minutes)
    // User balance tracking maximum check interval:
    user_balance_tracking_max_check_interval:
      process.env.USER_BALANCE_TRACKING_MAX_CHECK_INTERVAL || 30, // Hard maximum between checks (minutes)
    // User balance tracking dynamic target RPC calls per day:
    user_balance_tracking_dynamic_target_rpc_calls_per_day:
      process.env.USER_BALANCE_TRACKING_DYNAMIC_TARGET_RPC_CALLS_PER_DAY || 50000, // Target RPC calls per day specifically for the user balance tracking service for 100-user batches
    // User balance tracking batch size:
    user_balance_tracking_batch_size:
      process.env.USER_BALANCE_TRACKING_BATCH_SIZE || 100, // max users to check in parallel
    
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
  
  /* CONTEST SCHEDULER SERVICE */

    // TODO (?)

  /* PORTFOLIO SNAPSHOT SERVICE */

    // TODO

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
  
  // IPInfo API:
  ipinfo: {
    api_key: process.env.IPINFO_API_KEY,
    full_url: process.env.IPINFO_API_FULL_URL,
  },
  
  /* Helper functions for environment and service configuration */
  
  // Get current environment
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
  
  // Log active service profile during startup
  logServiceProfile: () => {
    const profile = config.services.active_profile;
    const enabledServices = [];
    const disabledServices = [];
    
    Object.entries(config.service_profiles[profile] || {}).forEach(([service, enabled]) => {
      if (enabled) {
        enabledServices.push(service);
      } else {
        disabledServices.push(service);
      }
    });
    
    console.log(`🔧 Active Service Profile: ${profile}`);
    console.log(`  - Enabled: ${enabledServices.join(', ')}`);
    console.log(`  - Disabled: ${disabledServices.join(', ')}`);
    
    return { profile, enabledServices, disabledServices };
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
    auth: process.env.AUTH_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.MIDDLEWARE_DEBUG_MODE || 'false',
    websocket: process.env.WEBSOCKET_DEBUG_MODE || 'false',
  },
  
  // Super-force disable specific services (overrides service profiles)
  // IS THIS USED ANYWHERE?
  disable_services: {
    // token_sync has been permanently removed
    token_whitelist: true, // Permanently disable token_whitelist service (using token.is_active flag instead)
  },
  
  // Service profiles for different environments
  service_profiles: {
    // Production profile - all services enabled
    production: {
      // token_sync has been permanently removed
      ai_service: true,
      market_data: true,
      contest_evaluation: true,
      token_whitelist: true,
      liquidity: true,
      user_balance_tracking: true,
      wallet_rake: true,
      contest_scheduler: true,
      achievement_service: true,
      referral_service: true,
      leveling_service: true,
      contest_wallet_service: true,
      admin_wallet_service: true,
      wallet_generator_service: false, // REMOVED - service was deleted (over-engineered and barely used)
      vanity_wallet_service: true, // Vanity Wallet Service
      solana_service: true,
      solana_engine_service: true, // New SolanaEngine service
      token_refresh_scheduler: true, // Main scheduler service
      token_dex_data_service: false, // DEPRECATED - Disabled due to database connection pool issues and circuit breaker failures
      token_detection_service: true, // New token detection service
      token_enrichment_service: false, // ???
      token_activation_service: true, // ENABLED - manages is_active flag
      discord_notification_service: true,
      discord_interactive_service: true,
      launch_event_service: true,
      portfolio_snapshot_service: true,
      dialect_service: false, // Dialect integration service (Blinks/Solana Actions)
      // Additional services would be defined here as we expand this pattern
      contest_image_service: true, // [ADDED 5/22/25] Why wasn't this already enabled in prod?
      contest_service: true, // [ADDED 5/22/25] (wait what even is this?) Why wasn't this already enabled in prod?
      jupiter_client: true, // [ADDED 5/22/25] Why wasn't this already enabled in prod?
    },
    
    // Development profile - services disabled by default (just AI API for now)
    development: {

      /*
      Prefer services that:
      - DO NOT MODIFY THE DATABASE
      - DO NOT USE EXTERNAL APIs
      - DO NOT USE RPC CALLS
      - DO NOT INCUR EXCESSIVE COSTS
      - DO NOT CAUSE SERIOUS ISSUES WITH CONCURRENT PROD SERVICES (race conditions)
      */

      // BELOW SERVICES ARE ENABLED IN DEVELOPMENT
      launch_event_service: true, // Enabled in dev for testing
      dialect_service: true, // Enabled in dev for testing Blinks registry

      // BELOW SERVICES ARE DISABLED IN DEVELOPMENT
      ai_service: false,
      discord_notification_service: false, // Disable Discord notification service in development
      discord_interactive_service: false, // Disable Discord interactive service in development
      market_data: false, // Disabled to prevent token fetching in dev environment (uses external API)
      contest_evaluation: false, // Disabled to prevent real contest evaluations from being run in development
      token_whitelist: false, // Completely removed from the application (DEPRECATED)
      liquidity: false, // Require wallet_generator_service, fails because it's disabled in dev (also, old and probably deprecated)
      user_balance_tracking: false, // Disabled to prevent excessive RPC calls and database modifications in development
      wallet_rake: false, // Disabled to prevent excessive RPC calls and blockchain transactions in development
      contest_scheduler: false, // Disable contest scheduler in development to prevent double-scheduling conflicts
      achievement_service: false, // Disabled to prevent excessive RPC calls and database modifications in development
      referral_service: false, // Disabled to prevent database modifications in development
      leveling_service: false, // Disabled to prevent database modifications in development
      contest_wallet_service: false, // Disabled to prevent excessive RPC calls and blockchain transactions in development
      admin_wallet_service: false, // Disabled to prevent excessive RPC calls and blockchain transactions in development
      wallet_generator_service: false, // Disabled to prevent excessive RPC calls and blockchain transactions in development
      vanity_wallet_service: false, // Disable vanity wallet service in development
      solana_service: false, // [EDIT: DISABLED 4/24/25] Keep Solana service enabled in development for connection management
      solana_engine_service: false, // [EDIT: DISABLED 4/24/25] Keep SolanaEngine service enabled in development for testing
      token_refresh_scheduler: false, // Main scheduler service, kept disabled in dev
      token_dex_data_service: false, // Disable DEX pool data service in development
      token_detection_service: false, // Disable token detection service in development
      token_enrichment_service: false, // Temporarily disable
      token_activation_service: false, // Temporarily disable
      portfolio_snapshot_service: false, // Disable portfolio snapshot service to prevent double-snapshotting in development (causes race conditions)
      contest_image_service: false, // [ADDED 5/11/25] Explicitly disable contest image service in development
      contest_service: false, // [ADDED 5/11/25] Explicitly disable contest service in development
      jupiter_client: false, // [ADDED 5/11/25] Explicitly disable JupiterClient service in development
      
      // Any future services that may cause conflicts with prod services would be disabled here too
    }
  },
  
  // Vanity Wallet Generator Configuration
  vanityWallet: {
    // Number of worker threads to use for generation
    numWorkers: parseInt(process.env.VANITY_WALLET_NUM_WORKERS || 8), // Use all 8 cores for maximum performance
    // CPU limit for generation processes
    cpuLimit: parseInt(process.env.VANITY_WALLET_CPU_LIMIT || 80), // Use 80% CPU by default to leave more resources for other tasks
    // Number of addresses to check per batch
    batchSize: parseInt(process.env.VANITY_WALLET_BATCH_SIZE || 25000), // 25 thousand addresses per batch for better performance
    // Maximum number of attempts before giving up
    maxAttempts: parseInt(process.env.VANITY_WALLET_MAX_ATTEMPTS || 100000000), // 100 million attempts
    // Target counts for automatic generation
    targetCounts: {
      DUEL: parseInt(process.env.VANITY_WALLET_TARGET_DUEL || 60), // Target amount of DUEL-prefixed wallets to have pre-generated and ready to use (3x the original value of 20)
      DEGEN: parseInt(process.env.VANITY_WALLET_TARGET_DEGEN || 60) // Target amount of DEGEN-prefixed wallets to have pre-generated and ready to use (3x the original value of 20)
    },
    // Check interval in minutes
    checkIntervalMinutes: parseInt(process.env.VANITY_WALLET_CHECK_INTERVAL || 1), // Every minute
    // Maximum concurrent generation jobs
    maxConcurrentJobs: parseInt(process.env.VANITY_WALLET_MAX_CONCURRENT_JOBS || 1), // Use 1 job at a time to maximize resources per job
  },

  // Vanity Wallet Usage Configuration (for contest wallet service)
  vanity_wallets: {
    enabled: process.env.VANITY_WALLETS_ENABLED !== 'false', // Default to true, can be disabled with env var
    prefer_pattern: process.env.VANITY_WALLET_PREFER_PATTERN || 'DUEL', // Prefer DUEL wallets for contests
    fallback_to_random: process.env.VANITY_WALLET_FALLBACK !== 'false' // If no vanity wallets available, fallback to random generation
  },

  // Dialect Service Configuration (Blinks/Solana Actions integration)
  dialect: {
    // Wallet private key for signing Dialect provider registration
    walletPrivateKey: process.env.DIALECT_WALLET_PRIVATE_KEY || process.env.WALLET_ENCRYPTION_KEY,
    // Dialect API key
    apiKey: process.env.DIALECT_API_KEY || '',
    // Environment (development or production)
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    // Provider configuration
    provider: {
      name: 'DegenDuel',
      description: 'DegenDuel Contest & Trading Platform',
      websiteUrl: 'https://degenduel.me',
      iconUrl: 'https://degenduel.me/images/logo192.png',
      termsUrl: 'https://degenduel.me/terms',
      oauthRedirectUrl: 'https://degenduel.me/api/blinks/auth/callback',
      blinksInstructionsUrl: 'https://degenduel.me/docs/blinks'
    }
  },

  // Active service configuration (based on profile)
  services: {
    // Get active profile from environment or default to 'development'
    active_profile: process.env.SERVICES_PROFILE || 
                   (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    
    // Determine if specific services are enabled based on active profile
    
    // TOKEN SYNC SERVICE
    get token_sync() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.token_sync;
    },

    // TOKEN MONITOR SERVICE
    get token_monitor() {
      //return true; // WAS PREVIOUSLY ALWAYS TRUE (4/24/25)
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.token_monitor;
    },

    // MARKET DATA SERVICE
    get market_data() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.market_data;
    },

    // CONTEST EVALUATION SERVICE
    get contest_evaluation() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_evaluation;
    },

    // TOKEN WHITELIST SERVICE
    get token_whitelist() {
      // Token whitelist service is permanently disabled - using token.is_active flag instead
      return false;
    },

    // LIQUIDITY SERVICE
    get liquidity() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.liquidity;
    },

    // USER BALANCE TRACKING SERVICE
    get user_balance_tracking() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.user_balance_tracking;
    },

    // WALLET RAKE SERVICE    
    get wallet_rake() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.wallet_rake;
    },

    // CONTEST SCHEDULER SERVICE
    get contest_scheduler() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_scheduler;
    },

    // ACHIEVEMENT SERVICE
    get achievement_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.achievement_service;
    },

    // REFERRAL SERVICE
    get referral_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.referral_service;
    },

    // LEVELING SERVICE
    get leveling_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.leveling_service;
    },

    // CONTEST WALLET SERVICE
    get contest_wallet_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_wallet_service;
    },

    // Contest Image Service
    get contest_image_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.contest_image_service === undefined ? false : profile.contest_image_service;
    },

    // Contest Service
    get contest_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.contest_service === undefined ? false : profile.contest_service;
    },

    // ADMIN WALLET SERVICE
    get admin_wallet_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.admin_wallet_service;
    },

    // WALLET GENERATOR SERVICE - REMOVED (service was deleted)
    // get wallet_generator_service() {
    //   const profile = config.service_profiles[config.services.active_profile] || 
    //                  config.service_profiles.development;
    //   return profile.wallet_generator_service;
    // },

    // AI SERVICE
    get ai_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.ai_service;
    },

    // SOLANA SERVICE
    get solana_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.solana_service;
    },

    // SOLANA ENGINE SERVICE
    get solana_engine_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.solana_engine_service;
    },

    // VANITY WALLET SERVICE
    get vanity_wallet_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.vanity_wallet_service;
    },

    // TOKEN REFRESH SCHEDULER SERVICE
    get token_refresh_scheduler() { // Main scheduler service
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.token_refresh_scheduler; // Access the correct profile key
    },

    // TOKEN DEX DATA SERVICE
    get token_dex_data_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.token_dex_data_service;
    },

    // TOKEN DETECTION SERVICE
    get token_detection_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.token_detection_service;
    },

    // JUPITER CLIENT SERVICE
    get jupiter_client() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.jupiter_client;
    },

    // TOKEN ENRICHMENT SERVICE
    get token_enrichment_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.token_enrichment_service;
    },

    // DIALECT SERVICE
    get dialect_service() {
      const profile = config.service_profiles[config.services.active_profile] ||
                     config.service_profiles.development;
      return profile.dialect_service;
    },

    // DISCORD NOTIFICATION SERVICE
    get discord_notification_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.discord_notification_service;
    },

    // DISCORD INTERACTIVE SERVICE
    get discord_interactive_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.discord_interactive_service;
    },

    // LAUNCH EVENT SERVICE
    get launch_event_service() { // Added getter for the new service
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.launch_event_service;
    },

    // PORTFOLIO SNAPSHOT SERVICE
    get portfolio_snapshot_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.portfolio_snapshot_service;
    },

    // TOKEN ACTIVATION SERVICE  
    get token_activation_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      // Ensure a default of false if not specified in a profile, though it should be.
      return profile.token_activation_service === undefined ? false : profile.token_activation_service;
    },

    // [Future Services Go Here]

    // TODO: Double check that all services are included here
    
  },

  // GPU Server Configuration (DEPRECATED - NOT USED)
  gpuServer: {
    // Allow multiple IPs separated by commas, or IP patterns with wildcards
    // First IP in the list is used as the default when connecting to the server
    allowedIps: (process.env.ALLOWED_GPU_SERVER_IPS || '192.222.51.124,192.222.51.*,127.0.0.1,localhost').split(','),
    port: process.env.GPU_SERVER_PORT || 80,
  },  

  // DDAPI Debug Mode (DEPRECATED)
  debug_mode: 
    process.env.DD_API_DEBUG_MODE || 'false',
  
    // v69 WSS testing
  wss_testing: {
    test_secret_dev_access_token: test_secret_dev_access_token,
  },
  
  // WebSocket configuration and registry
  websocket: {
    // The unified WebSocket server instance will be stored here during initialization
    unifiedWebSocket: null,
    
    // Configuration for the unified WebSocket
    config: {
      path: '/api/v69/ws',
      maxPayload: 5 * 1024 * 1024, // 5MB max payload (increased from 50KB)
      perMessageDeflate: false, // Explicitly disable compression to avoid client issues
    },
    
    // Available topics for the unified WebSocket
    topics: {
      MARKET_DATA: 'market-data',
      PORTFOLIO: 'portfolio',
      SYSTEM: 'system',
      CONTEST: 'contest',
      CONTEST_CHAT: 'contest-chat', // Added new topic for contest chat
      USER: 'user',
      ADMIN: 'admin',
      WALLET: 'wallet',
      WALLET_BALANCE: 'wallet-balance', // Consolidated wallet balance topic (v69 standard)
      SKYDUEL: 'skyduel',
      TERMINAL: 'terminal',
      LOGS: 'logs',
      LAUNCH_EVENTS: 'launch-events', // Added new topic for launch related events
    },
    
    // Message types for the unified WebSocket
    messageTypes: {
      // Client -> Server messages
      SUBSCRIBE: 'SUBSCRIBE',
      UNSUBSCRIBE: 'UNSUBSCRIBE',
      REQUEST: 'REQUEST',
      COMMAND: 'COMMAND',
      
      // Server -> Client messages
      DATA: 'DATA',
      ERROR: 'ERROR',
      SYSTEM: 'SYSTEM',
      ACKNOWLEDGMENT: 'ACKNOWLEDGMENT'
    }
  },
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