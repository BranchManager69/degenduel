export const DB_CONFIG = {
    MAX_CONNECTIONS: 50,
    TIMEOUT: 30000,
    JOURNAL_MODE: 'WAL'
  };
  
  export const CORS_CONFIG = {
    ALLOWED_ORIGINS: {
      production: ['https://degenduel.me', 'https://www.degenduel.me', 'https://data.degenduel.me', 'https://dev.degenduel.me', 'https://game.degenduel.me', 'https://www.manager.degenduel.me', 'https://branch.bet', 'https://app.branch.bet'],
      development: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003', 'http://localhost:3004', 'http://localhost:3005', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:5177']
    },
    MAX_AGE: 86400,
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    ALLOWED_HEADERS: [
      'Content-Type',
      'Authorization',
      'x-superadmin-token',
      'Cache-Control',
      'x-requested-with',
      'X-Request-ID'
    ]
  };
  
  // usernames
  export const VALIDATION = {
    NAME: {
      MIN_LENGTH: 4,
      MAX_LENGTH: 15,
      PATTERN: /^[a-zA-Z0-9_]+$/
    },
    LEADERBOARD: {
      MIN_LIMIT: 1,
      MAX_LIMIT: 1000
    }
  };

  // Token bucket thresholds
  export const TOKEN_BUCKET_THRESHOLDS = {
    MARKET_CAP: {
        LARGE_CAP: 1_000_000_000,    // $1B+
        MID_CAP: 100_000_000,        // $100M+
        SMALL_CAP: 0                 // Rest
    },
    VOLUME: {
        HIGH_VOLUME: 1_000_000       // $1M+ daily volume
    },
    LIQUIDITY: {
        HIGH_LIQUIDITY: 500_000      // $500K+ liquidity
    }
  };

  // Token metadata validation
  export const TOKEN_VALIDATION = {
    DESCRIPTION: {
      MAX_LENGTH: 1000
    },
    URLS: {
      MAX_LENGTH: 255,
      ALLOWED_PROTOCOLS: ['https:']
    },
    SYMBOL: {
      MAX_LENGTH: 10,
      PATTERN: /^[A-Z0-9]+$/
    },
    NAME: {
      MAX_LENGTH: 50
    },
    ADDRESS: {
      SOLANA_PATTERN: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    }
  };