const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      cwd: '/home/branchmanager/websites/degenduel',
      wait_ready: true,
      node_args: [
        '--no-warnings',
        '--experimental-specifier-resolution=node',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: process.env.PORT || 3004,
        DD_API_DEBUG_MODE: 'false',
        NODE_ENV: 'production',
        NODE_OPTIONS: '--require ts-node/register'
      },
      exp_backoff_restart_delay: 100,
      max_memory_restart: '2G',
      kill_timeout: 3000
    },
    {
      name: 'degenduel-api-test',
      script: 'index.js',
      watch: true,
      cwd: '/home/branchmanager/websites/degenduel',
      wait_ready: true,
      node_args: [
        '--no-warnings',
        '--experimental-specifier-resolution=node',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: 3005,
        DD_API_DEBUG_MODE: 'true',
        NODE_ENV: 'development',
        NODE_OPTIONS: '--require ts-node/register',
        DATABASE_URL: process.env.DATABASE_URL_TEST // Will use test database
      },
      exp_backoff_restart_delay: 100,
      max_memory_restart: '2G',
      kill_timeout: 3000
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
      name: 'prisma-studio-test',
      script: 'npx',
      args: 'prisma studio',
      watch: false,
      cwd: '/home/branchmanager/websites/degenduel',
      env: {
        PORT: 5556,
        DATABASE_URL: process.env.DATABASE_URL_TEST // Will use test database
      }
    },
    {
      name: 'pgadmin',
      script: 'docker',
      args: 'start pgadmin4',
      watch: false,
      autorestart: true
    }
  ]
};
