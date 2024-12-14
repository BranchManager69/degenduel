module.exports = {
  apps: [
    {
      name: 'branchbet-frontend',
      script: 'server/frontend.js',
      env: {
        NODE_ENV: 'production',
        PORT: '3002'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/websites/beta-branch-bet/logs/frontend-error.log',
      out_file: '/home/websites/beta-branch-bet/logs/frontend-out.log'
    },
    {
      name: 'branchbet-api',
      script: 'server/index.js',
      env: {
        NODE_ENV: 'production',
        API_PORT: '3003',
        DB_USER: 'branchmanager',
        DB_HOST: 'localhost',
        DB_NAME: 'degenduel',
        DB_PORT: '5432'
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/websites/beta-branch-bet/logs/api-error.log',
      out_file: '/home/websites/beta-branch-bet/logs/api-out.log'
    }
  ]
};