# DegenDuel Environment Configuration

## Overview

DegenDuel uses two primary environments:
- Production (degenduel.me)
- Test/Development (dev.degenduel.me)

## Environment Details

### Production Environment
- **Domain**: degenduel.me
- **Frontend Port**: 443 (HTTPS)
- **Backend Port**: 3004
- **WebSocket Port**: 3004
- **PM2 Process**: degenduel-api
- **Database**: Production Database
- **Build Directory**: /home/websites/degenduel-fe/dist
- **Caching**: Aggressive caching for assets (1 year)
- **SSL**: Let's Encrypt (shared certificate)

### Test Environment
- **Domain**: dev.degenduel.me
- **Frontend Port**: 443 (HTTPS)
- **Backend Port**: 3005 (planned)
- **WebSocket Port**: 3005 (planned)
- **PM2 Process**: degenduel-api-test (planned)
- **Database**: Test Database (planned)
- **Build Directory**: /home/websites/degenduel-fe/dist-dev (planned)
- **Caching**: Disabled for development
- **SSL**: Shared with main domain

## Port Assignments

| Service              | Production | Test    |
|---------------------|------------|---------|
| NGINX Frontend      | 443        | 443     |
| Backend API         | 3004       | 3005    |
| WebSocket           | 3004       | 3005    |
| Prisma Studio       | 5555       | 5556    |

## Process Management (PM2)

### Production Process
- Name: degenduel-api
- Script: index.js
- Watch: false
- Node Args: 
  - --no-warnings
  - --experimental-specifier-resolution=node
  - --optimize-for-size
  - --gc-interval=100

### Test Process (Planned)
- Name: degenduel-api-test
- Script: index.js
- Watch: true (for development)
- Node Args: Same as production

## Environment Variables

### Production
```env
NODE_ENV=production
PORT=3004
DD_API_DEBUG_MODE=false
```

### Test
```env
NODE_ENV=development
PORT=3005
DD_API_DEBUG_MODE=true
```

## SSL Configuration
Both environments share the same Let's Encrypt certificate:
- Certificate Path: /etc/letsencrypt/live/degenduel.me-0001/fullchain.pem
- Key Path: /etc/letsencrypt/live/degenduel.me-0001/privkey.pem

## Caching Strategy

### Production
- Assets: 1 year cache with no-transform
- API Responses: Controlled by response headers
- Static Files: Cache-Control with public directive

### Test
- Assets: No caching (no-store, no-cache)
- API Responses: No caching
- Static Files: Cache-Control with no-cache directive

## WebSocket Configuration

### Production
- Endpoint: wss://degenduel.me/portfolio
- Timeout: 3600s
- Buffering: Disabled
- Logging: Enabled with upstream timing

### Test
- Endpoint: wss://dev.degenduel.me/portfolio
- Timeout: 3600s
- Buffering: Disabled
- Logging: Enabled with upstream timing

## Database Management

### Production Database
- Protected from resets
- Regular backups
- Migration history preserved

### Test Database (Planned)
- Can be reset safely
- Seeded with test data
- Used for migration testing

## Deployment Workflow (Planned)

1. Changes are first deployed to test environment
2. Testing and validation performed
3. Upon success, changes are promoted to production
4. Monitoring period in production
5. Rollback procedures if needed 