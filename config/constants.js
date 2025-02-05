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