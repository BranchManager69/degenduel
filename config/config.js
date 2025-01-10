import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // DegenDuel API is running on port 3003 or 3004 idk
  port: process.env.PORT || process.env.API_PORT || 3003,
  env: process.env.NODE_ENV || 'production',
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  jwt: {
    secret: process.env.JWT_SECRET
  }
};