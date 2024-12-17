export const DB_CONFIG = {
    MAX_CONNECTIONS: 50,
    TIMEOUT: 30000,
    JOURNAL_MODE: 'WAL'
  };
  
  export const CORS_CONFIG = {
    ALLOWED_ORIGINS: {
      production: ['https://degenduel.me', 'https://www.degenduel.me'],
      development: ['http://localhost:*']
    },
    MAX_AGE: 86400,
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    ALLOWED_HEADERS: [
      'Content-Type',
      'Authorization',
      'x-superadmin-token',
      'Cache-Control',
      'x-requested-with'
    ]
  };
  
  export const VALIDATION = {
    NAME: {
      MIN_LENGTH: 1,
      MAX_LENGTH: 15,
      PATTERN: /^[a-zA-Z0-9_-]+$/
    },
    LEADERBOARD: {
      MIN_LIMIT: 1,
      MAX_LIMIT: 1000
    }
  };