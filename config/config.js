import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // DegenDuel API is running on port 3003
  port: process.env.PORT || 3003,
  environment: process.env.NODE_ENV || 'production',
  jwt: {
    secret: process.env.JWT_SECRET
  }
};