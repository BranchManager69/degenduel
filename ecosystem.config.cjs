const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      env: {
        PORT: process.env.PORT || 3003,
        DD_API_DEBUG_MODE: process.env.DD_API_DEBUG_MODE || 'false'
      }
    }
  ]
};
