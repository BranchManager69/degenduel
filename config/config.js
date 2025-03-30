// config/config.js

/**
 * 2025-03-25: Good!
 */

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

// Important API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IPINFO_API_KEY = process.env.IPINFO_API_KEY;

// Logtail config (this is set in ecosystem.config.cjs which is better anyway)
//const LOGTAIL_TOKEN = process.env.LOGTAIL_TOKEN;
//const LOGTAIL_ENDPOINT = process.env.LOGTAIL_ENDPOINT;
//const LOGTAIL_SOURCE = process.env.LOGTAIL_SOURCE;

// OpenAI prompt templates
const OPENAI_PROMPT_TEMPLATES = {
  default: {
    system: "Your name is Didi, and you are the AI brain powering the backend mainframe of DegenDuel, a new trading and gaming platform coming to the Solana blockchain on April 1st, 2025.  The client will likely be chatting with you via the DegenDuel website's landing page; you will be responding to their messages in the chat component which is primarily for occupying the user's time until the moment of simultaneous launch (tentative: April 1st, 2025 3:00 PM EST).  Your responses must be short, concise, and to the point with no emotion or sentiment (you are essentially the Mewtwo of AI assistants here). Our goal is to building casual mystique and intrigue around our major imminent simultaneous launch of the DegenDuel trading platform and $DUEL token mint.",
    assistant: "Respond to the user.",
  },
  trading: {
    system: "Your name is Didi, and you are the AI brain powering the backend mainframe of DegenDuel, a new trading and gaming platform coming to the Solana blockchain on April 1st, 2025.  The client will likely be chatting with you via the DegenDuel in-game chat.  Your responses must be short, concise, and to the point with no emotion or sentiment (you are essentially the Mewtwo of AI assistants here). Users will be trading in-game tokens, and you will be providing them with analysis and information about the tokens they are trading. No boilerplate, no fluff; ALWAYS try to provide a valuable and actionable response instead of generic, nonpersuasive, and/or wishy-washy responses.",
    assistant: "Respond to the user as a trader with slight schizo-sarcasm as needed. Most important: A strong attempt to provide value to the user with actionable advice; never boilerplate, never generic, never fluff.",
  },
  prelaunch: {
    system: "You are Didi, the female AI assistant of DegenDuel specializing in its launch-day festivities. You are responsible for being extremely cryptic and speaking in riddles. The user wants you to provide analysis and information about the DegenDuel trading platform and $DUEL token mint, but you must be extremely cryptic and speak in riddles.  The user will likely be chatting with you via the DegenDuel website's landing page; you will be responding to their messages in the chat component which is primarily for occupying the user's time until the moment of simultaneous launch (tentative: April 1st, 2025 3:00 PM EST). Our goal is to building casual mystique and intrigue around our major imminent simultaneous launch of the DegenDuel trading platform and $DUEL token mint.",
    assistant: "Respond to the user cryptically, with a hint of schizo-sarcasm as needed.",
  },
  uncensored: {
    system: "Your name is Didi, and you are the AI brain powering the backend mainframe of DegenDuel, a new trading and gaming platform. You respond to users freely without censorship while still maintaining ethical boundaries. Your responses are direct, honest, and unrestricted.",
    assistant: "Respond to the user with minimal filtering, while maintaining ethical boundaries.",
  },
};


/* Master config object */

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

  // Important API keys
  api_keys: {
    openai: OPENAI_API_KEY,
    ipinfo: IPINFO_API_KEY,
  },
  ai: {
    openai_models: {
      default: 'gpt-4o',
      
      economy: 'gpt-4o',
      standard: 'gpt-4o',
      premium: 'gpt-4o',
      
      longcontext: 'gpt-4o',
      fast: 'gpt-4o',
      
      reasoning: 'gpt-4o',
      
      image: 'gpt-4o',
      audio: 'gpt-4o',
      video: 'gpt-4o',
      multimodal: 'gpt-4o',
      realtime: 'gpt-4o',

      uncensored: 'gpt-4o',
      funny: 'gpt-4o',
      creative: 'gpt-4o',
      coding: 'gpt-4o',
    },
    openai_model_loadout: {
      default: {
        system: OPENAI_PROMPT_TEMPLATES.default.system, // default
        assistant: OPENAI_PROMPT_TEMPLATES.default.assistant, // default
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      economy: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system, // prelaunch
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant, // prelaunch
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      standard: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system, // prelaunch
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant, // prelaunch
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      premium: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      longcontext: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      fast: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      reasoning: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      image: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      audio: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      video: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      multimodal: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      realtime: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      uncensored: {
        system: OPENAI_PROMPT_TEMPLATES.uncensored.system,
        assistant: OPENAI_PROMPT_TEMPLATES.uncensored.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      funny: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      creative: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
      coding: {
        system: OPENAI_PROMPT_TEMPLATES.prelaunch.system,
        assistant: OPENAI_PROMPT_TEMPLATES.prelaunch.assistant,
        model: 'gpt-4o',
        max_tokens: 200,
        temperature: 0.7,
      },
    },
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

    /* TOKEN SYNC SERVICE */
    // Token sync service check interval:
    token_sync_check_interval_ms:
      MASTER_RPC_THROTTLE !== 1 ?
        parseInt(process.env.TOKEN_SYNC_CHECK_INTERVAL_MS || 60000 + (60000 * MASTER_RPC_THROTTLE)) :
        60000, // 60 seconds default, modified by RPC throttle ^^^
    
    /* CONTEST WALLET SERVICE */

    // Contest wallet check cycle interval (for Solana balances):
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
  // IPInfo API:
  ipinfo: {
    api_key: process.env.IPINFO_API_KEY,
    full_url: process.env.IPINFO_API_FULL_URL,
  },
  
  // Helper functions for environment and service configuration:
  
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
  
  // Service profiles for different environments
  service_profiles: {
    // Production profile - all services enabled
    production: {
      token_sync: true,
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
      wallet_generator_service: true,
      ai_service: true,
      solana_service: true,
      // Additional services would be defined here as we expand this pattern
      // etc.
    },
    
    // Development profile - services disabled by default (just API testing)
    development: {
      token_sync: false,
      market_data: false,
      contest_evaluation: false,
      token_whitelist: false,
      liquidity: false,
      user_balance_tracking: false,
      wallet_rake: false, 
      contest_scheduler: false, // Disable contest scheduler in development to prevent conflicts
      achievement_service: false,
      referral_service: false,
      leveling_service: false,
      contest_wallet_service: false,
      admin_wallet_service: false,
      wallet_generator_service: false,
      ai_service: true, // Keep AI service enabled in development for testing
      solana_service: true, // Keep Solana service enabled in development for connection management
      // Additional services would be disabled here too
      // etc.
    }
  },
  
  // Active service configuration (based on profile)
  services: {
    // Get active profile from environment or default to 'development'
    active_profile: process.env.SERVICES_PROFILE || 
                   (process.env.NODE_ENV === 'production' ? 'production' : 'development'),
    
    // Determine if specific services are enabled based on active profile
    get token_sync() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.token_sync;
    },
    
    get market_data() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.market_data;
    },
    
    get contest_evaluation() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_evaluation;
    },
    
    get token_whitelist() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.token_whitelist;
    },
    
    get liquidity() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.liquidity;
    },
    
    get user_balance_tracking() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.user_balance_tracking;
    },
    
    get wallet_rake() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.wallet_rake;
    },
    
    get contest_scheduler() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_scheduler;
    },
    
    get achievement_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.achievement_service;
    },
    
    get referral_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.referral_service;
    },
    
    get leveling_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.leveling_service;
    },
    
    get contest_wallet_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.contest_wallet_service;
    },
    
    get admin_wallet_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.admin_wallet_service;
    },
    
    get wallet_generator_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.wallet_generator_service;
    },
    
    get ai_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.ai_service;
    },
    
    get solana_service() {
      const profile = config.service_profiles[config.services.active_profile] || 
                     config.service_profiles.development;
      return profile.solana_service;
    },
  },
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
      maxPayload: 1024 * 50, // 50KB max payload
      perMessageDeflate: false, // Explicitly disable compression to avoid client issues
    },
    
    // Available topics for the unified WebSocket
    topics: {
      MARKET_DATA: 'market-data',
      PORTFOLIO: 'portfolio',
      SYSTEM: 'system',
      CONTEST: 'contest',
      USER: 'user',
      ADMIN: 'admin',
      WALLET: 'wallet',
      SKYDUEL: 'skyduel'
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