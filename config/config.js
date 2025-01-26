import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: process.env.PORT || process.env.API_PORT || 3004,
  debug_mode: process.env.DD_API_DEBUG_MODE || 'false',
  jwt: {
    secret: process.env.JWT_SECRET
  },
  getEnvironment: (origin) => {
    if (!origin) return 'production'; // Default to production for direct API calls
    return origin.includes('localhost') || origin.includes('127.0.0.1') ? 'development' : 'production';
  }
};

export { config };
export default config;