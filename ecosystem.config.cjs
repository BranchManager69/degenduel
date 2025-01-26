const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      cwd: '/home/branchmanager/websites/degenduel',
      env: {
        PORT: process.env.PORT || 3004,
        DD_API_DEBUG_MODE: process.env.DD_API_DEBUG_MODE || 'false'
      }
    }
  ]
};
