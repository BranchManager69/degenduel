// config/config.js

import dotenv from 'dotenv';
dotenv.config();

// helpful DegenDuel API endpoints:
const DD_SERV_API = 'https://degenduel.me/api/dd-serv/tokens';
const DATA_API = 'https://data.degenduel.me/api';
const GAME_API = 'https://game.degenduel.me';

const config = {
  port: process.env.PORT || process.env.API_PORT || 3004,
  jwt: {
    secret: process.env.JWT_SECRET
  },
  api_urls: {
    dd_serv: DD_SERV_API,
    data: DATA_API,
    game: GAME_API,
  },
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  debug_modes: {
    auth: process.env.DD_API_DEBUG_MODE || 'false',
    api: process.env.DD_API_DEBUG_MODE || 'false',
    middleware: process.env.DD_API_DEBUG_MODE || 'false',
    ////token_sync: process.env.DD_API_DEBUG_MODE || 'false',
    ////market_data: process.env.DD_API_DEBUG_MODE || 'false',
    ////leaderboard: process.env.DD_API_DEBUG_MODE || 'false',
    ////admin: process.env.DD_API_DEBUG_MODE || 'false',
    /////maintenance: process.env.DD_API_DEBUG_MODE || 'false',
  },
  getEnvironment: (origin) => {
    if (!origin) return 'production'; // direct API calls default to prod
    return origin.includes('localhost') || origin.includes('127.0.0.1') ? 'development' : 'production';
  },
};

export { config };
export default config;