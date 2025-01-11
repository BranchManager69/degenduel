import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || process.env.API_PORT || 3003,
  env: process.env.NODE_ENV || 'production',
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  jwt: {
    secret: process.env.JWT_SECRET,
    superadmin_secret: process.env.SUPERADMIN_TOKEN
  }
};