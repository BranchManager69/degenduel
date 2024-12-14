export const DB_CONFIG = {
    MAX_CONNECTIONS: 10,
    TIMEOUT: 5000,
    JOURNAL_MODE: 'WAL'
  };
  
  export const CORS_CONFIG = {
    ALLOWED_ORIGINS: {
      production: ['https://branch.bet', 'https://www.branch.bet'],
      development: ['http://localhost:3002']
    },
    MAX_AGE: 86400,
    METHODS: ['GET', 'POST'],
    ALLOWED_HEADERS: ['Content-Type']
  };
  
  export const VALIDATION = {
    NAME: {
      MIN_LENGTH: 1,
      MAX_LENGTH: 16,
      PATTERN: /^[a-zA-Z0-9_]+$/
    },
    LEADERBOARD: {
      MIN_LIMIT: 1,
      MAX_LIMIT: 100
    }
  };