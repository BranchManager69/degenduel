import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // DegenDuel API is running on port 3003
  port: process.env.PORT || process.env.API_PORT || 3004,
  env: process.env.NODE_ENV || 'production',
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  jwt: {
    secret: process.env.JWT_SECRET
  }
};