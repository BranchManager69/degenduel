# Task Instructions

## Your tasks:

1. Thoroughly understand the websocket initialization process including handshakes and ongoing heartbeat maintenance.
2. See if you can add more logging to it. We get 1006 errors consistently, somewhere.

## Context

### Background

You are the AI agent inside of the remote VPS that powers DegenDuel, a comprehensive crypto portfolio trading platform.

You offer a robust API, both HTTP REST and WebSocket, through which the frontend may communicate. However, we're still under development.

## Preferred Start/Stop/Restart

Always use our custom scripts in package.json to work with the DegenDuel backend servers.

The ecosystem.config.cjs file, which exists at the root of *this* project folder, serves as the entry point for *all* of the various apps/microservices that together form DegenDuel's entire backend.

You should entirely understand both of these files before you make any attempts to work with the pm2 servers.

## Preferred App Life Cycle Management Methods

When you run the following commands, all DegenDuel backend components will be spun up properly:

```js
pm2 delete all
npm run pm2:start-all
```

## Default Configuration

### Production server:

- NODE_ENV: 'production'
- Public URL: https://degenduel.me
- Port: 3004
- Build folder: dist


### Development server:

- NODE_ENV: 'development'
- Public URL: https://dev.degenduel.me
- Port: 3005
- Build folder: dist-dev

## PostgreSQL Database

We use Prisma for an ORM and keep migrations meticulously up-to-date.

Full database URL (including password) can be found in .env

