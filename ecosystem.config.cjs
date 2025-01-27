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
    },
    {
      name: 'prisma-studio',
      script: 'npx',
      args: 'prisma studio',
      watch: false,
      cwd: '/home/branchmanager/websites/degenduel',
      env: {
        PORT: 5555
      }
    },
    {
      name: 'pgadmin4',
      script: 'docker',
      args: 'start pgadmin4',
      watch: false,
      autorestart: true
    }
  ]
};
