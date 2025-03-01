const dotenv = require('dotenv');
dotenv.config();

// Which apps to include in the ecosystem config
const INCLUDE_PROD_APPS = true;
const INCLUDE_TEST_APPS = true;
const INCLUDE_PRISMA_STUDIO = true;
const INCLUDE_PGADMIN = false; // (doesn't work; need to fix db.degenduel.me NGINX config)

const apps = [];

const PROD_APPS = [
  {
    name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      cwd: '/home/websites/degenduel',
      wait_ready: true,
      node_args: [
        '--no-warnings',
        '--experimental-specifier-resolution=node',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: 3004,
        DD_API_DEBUG_MODE: 'false',
        NODE_ENV: 'production',
        NODE_OPTIONS: '--require ts-node/register',
        SILENT_MODE: 'false',
        CONSOLE_LOG_LEVEL: 'info'
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
      cwd: '/home/websites/degenduel',
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
    },
]

const TEST_APPS = [
  {
    name: 'degenduel-api-test',
    script: 'index.js',
    watch: false,
    cwd: '/home/websites/degenduel',
    wait_ready: true,
    node_args: [
      '--no-warnings',
      '--experimental-specifier-resolution=node',
      '--optimize-for-size',
      '--gc-interval=100'
    ],
    env: {
      PORT: 3005,
      DD_API_DEBUG_MODE: 'false',
      NODE_ENV: 'test',
      NODE_OPTIONS: '--require ts-node/register',
      SILENT_MODE: 'false',
      CONSOLE_LOG_LEVEL: 'info'
    },
    exp_backoff_restart_delay: 100,
    max_memory_restart: '2G',
    kill_timeout: 3000
  },
  {
    name: 'prisma-studio-test',
    script: 'npx',
    args: 'prisma studio',
    watch: false,
    cwd: '/home/websites/degenduel',
    env: {
      PORT: 5556,
      DATABASE_URL: process.env.DATABASE_URL_TEST // THIS DOES NOT WORK; PRISMA DOES NOT ACCEPT ENV VARIABLES FOR DATABASE_URL. The env var doesn't even exist.
    }
  },
]

// add prod apps if requested
if (INCLUDE_PROD_APPS) {
  apps.push(...PROD_APPS);
}

// add test apps if requested
if (INCLUDE_TEST_APPS) {
  apps.push(...TEST_APPS);
}

// remove pgadmin if not included
if (!INCLUDE_PGADMIN) {
  apps = apps.filter(app => app.name !== 'pgadmin');
}

// remove prisma studio if not included
if (!INCLUDE_PRISMA_STUDIO) {
  apps = apps.filter(app => app.name !== 'prisma-studio' && app.name !== 'prisma-studio-test');
}

// finally, export the selected apps
module.exports = {
  apps: apps
};

/*
// old ecosystem config:
module.exports = {
  apps: [
    {
      name: 'degenduel-api',
      script: 'index.js',
      watch: false,
      cwd: '/home/websites/degenduel',
      wait_ready: true,
      node_args: [
        '--no-warnings',
        '--experimental-specifier-resolution=node',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: 3004,
        DD_API_DEBUG_MODE: 'false',
        NODE_ENV: 'production',
        NODE_OPTIONS: '--require ts-node/register',
        SILENT_MODE: 'false',
        CONSOLE_LOG_LEVEL: 'info'
      },
      exp_backoff_restart_delay: 100,
      max_memory_restart: '2G',
      kill_timeout: 3000
    },
    {
      name: 'degenduel-api-test',
      script: 'index.js',
      watch: false,
      cwd: '/home/websites/degenduel',
      wait_ready: true,
      node_args: [
        '--no-warnings',
        '--experimental-specifier-resolution=node',
        '--optimize-for-size',
        '--gc-interval=100'
      ],
      env: {
        PORT: 3005,
        DD_API_DEBUG_MODE: 'false',
        NODE_ENV: 'test',
        NODE_OPTIONS: '--require ts-node/register',
        SILENT_MODE: 'false',
        CONSOLE_LOG_LEVEL: 'info'
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
      cwd: '/home/websites/degenduel',
      env: {
        PORT: 5555
      }
    },
    {
      name: 'prisma-studio-test',
      script: 'npx',
      args: 'prisma studio',
      watch: false,
      cwd: '/home/websites/degenduel',
      env: {
        PORT: 5556,
        DATABASE_URL: process.env.DATABASE_URL_TEST // THIS DOES NOT WORK; PRISMA DOES NOT ACCEPT ENV VARIABLES FOR DATABASE_URL. The env var doesn't even exist.
      }
    },
    {
      name: 'pgadmin',
      script: 'docker',
      args: 'start pgadmin4', // THIS DOES NOT WORK; I think it's a NGINX issue. Going to https://db.degenduel.com redirects to https://db.degenduel.me/login?next=/ which is a 404.
      watch: false,
      autorestart: true
    },
  ]
};
*/