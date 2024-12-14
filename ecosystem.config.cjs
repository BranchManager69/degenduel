require('dotenv').config();

module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: './index.js',
      env: {
        NODE_ENV: process.env.NODE_ENV,
        API_PORT: process.env.API_PORT,
        DB_USER: process.env.DB_USER,
        DB_PASS: process.env.DB_PASS,
        DB_HOST: process.env.DB_HOST,
        DB_NAME: process.env.DB_NAME,
        DB_PORT: process.env.DB_PORT
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/websites/degenduel/logs/api-error.log',
      out_file: '/home/websites/degenduel/logs/api-out.log'
    }
  ]
};
