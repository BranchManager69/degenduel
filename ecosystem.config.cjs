const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      cwd: '/home/branchmanager/websites/degenduel',
      node_args: [
        '--expose-gc',
        '--max-old-space-size=2048',
        '--optimize-for-size',
        '--max-semi-space-size=512',
        '--max-executable-size=192',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: process.env.PORT || 3004,
        DD_API_DEBUG_MODE: 'false',
        NODE_ENV: 'production',
        NODE_OPTIONS: '--trace-deprecation'
      },
      exp_backoff_restart_delay: 100,
      max_memory_restart: '2G',
      kill_timeout: 3000,
      wait_ready: true
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
      name: 'pgadmin',
      script: 'docker',
      args: 'start pgadmin4',
      watch: false,
      autorestart: true
    }
  ]
};
