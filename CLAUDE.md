# DegenDuel Project Reference

```
Comprehensive guide for working with Solana token metadata in the DegenDuel project. This includes:

  1. Documentation: /docs_critical/token_metadata/solana_token_metadata_guide.md
    - Explains three different methods for fetching token metadata
    - Provides code examples for each approach
    - Includes specifics on handling non-standard tokens
    - Includes recommendations for implementation in DegenDuel
  2. Example Scripts:
    - token_examples.js - Uses Metaplex libraries to fetch standard metadata
    - direct_rpc_example.js - Uses direct RPC calls for basic token info
    - alternative_fetch_example.js - A multi-method approach for robust fetching
```

## Database Schema Management

### Prisma Schema Reconciliation
When schema validation errors occur (such as missing fields or mismatched types):

```bash
# Compare Prisma schema with database and analyze differences
npm run db:reconcile-ai

# Generate a migration script to fix the differences
npm run db:reconcile-fix
```
These commands safely analyze without modifying your database.

## Project Management

### Process Management
- **IMPORTANT**: DegenDuel uses PM2 for process management with simplified npm scripts

```bash
# RECOMMENDED APPROACH: Use npm scripts for simple management
# --------------------------------------------------------
# View running processes
npm run pm2

# NEW PREFERRED COMMANDS (RECOMMENDED)
# ------------------------------------
# Start API service
npm run pm2:start

# Stop API service
npm run pm2:stop

# Restart API service with updated env vars (NON-BLOCKING)
npm run pm2:restart & 

# Restart API and view logs (MUST BE RUN NON-BLOCKING)
npm run pm2:restart-logs & # IMPORTANT: Add '&' to make it non-blocking

# Manage all services
npm run pm2:start-all    # Start all services
npm run pm2:stop-all     # Stop all services
npm run pm2:restart-all & # Restart all services (NON-BLOCKING)

# PREVIOUS COMMANDS (STILL SUPPORTED)
# -----------------------------------
# Start all services
npm run up

# Stop all services 
npm run down

# Restart all services with updated env vars
npm run reload

# Service-specific commands
npm run api:up        # Start API only
npm run api:down      # Stop API only  
npm run api:reload    # Restart API with updated env vars

# Similar commands for other services:
# lobby:up, lobby:down, lobby:reload
# reflections:up, reflections:down, reflections:reload
# mcp:up, mcp:down, mcp:reload
```

### Non-blocking Log Checking
**IMPORTANT**: Always run commands with logs in a non-blocking way by adding `&` at the end.

```bash
# ALWAYS RUN WITH '&' AT THE END FOR NON-BLOCKING OPERATION
npm run pm2:restart-logs & # CRITICAL: Add '&' to make it non-blocking

# Check latest logs without blocking (recommended)
tail -n 20 /home/branchmanager/.pm2/logs/degenduel-api-out.log

# Check error logs
tail -n 20 /home/branchmanager/.pm2/logs/degenduel-api-error.log

# Follow logs in a second terminal if needed (non-blocking)
tail -f /home/branchmanager/.pm2/logs/degenduel-api-out.log &

# Alternative log access via npm scripts
npm run logs &         # Access all logs in non-blocking manner
npm run logs:api &     # Access API logs in non-blocking manner
npm run logs:error &   # Access error logs in non-blocking manner
```

### Service Configuration
The project uses `ecosystem.config.cjs` to manage multiple environments:
- `degenduel-api` - Production API on port 3004
- `degenduel-api-test` - Development/Test API on port 3005
- `degenduel-lobby` - Game lobby on port 3006
- `mcp-server` - Master Control Program on port 3007
- `degenduel-reflections` - Reflections service on port 3008
- `prisma-studio` - Production database UI on port 5555
- `prisma-studio-test` - Test database UI on port 5556

### Environment Variables
All environment variables (including Logtail credentials) are configured in:
1. `.env` - Base environment variables
2. `ecosystem.config.cjs` - PM2-specific environment variables

When updating environment variables:
1. Add them to both files for consistency
2. Always use `--update-env` flag or the npm scripts that include it (like `npm run reload`)
3. If changes don't apply, try stopping and starting the service

### Environment Details
- Production: https://degenduel.me
- Development: https://dev.degenduel.me
- Both use the same PostgreSQL database by default

## Database Management

### Prisma Commands
```bash
# Generate Prisma client
npx prisma generate

# Create migration (development environments)
npx prisma migrate dev --name your_migration_name
# IMPORTANT: Use migrate dev during development as it creates the migration,
# applies it, and regenerates the Prisma client in one step

# Apply migrations (production environments only)
npx prisma migrate deploy
# NOTE: migrate deploy only applies existing migrations without creating new ones
# or regenerating the client - NOT for development use

# Reset database (CAUTION)
npx prisma migrate reset
```

## Architecture Notes

### Service Architecture
The application follows a service-based architecture with:
- Base service classes in `utils/service-suite/`
- Service implementations in `services/`
- Circuit breaker patterns for resilience
- Service registration via ServiceManager

Key services include:
- `services/solanaService.js` - Fundamental blockchain connectivity
- `services/tokenSyncService.js` - Token data synchronization
- `services/achievementService.js` - Achievement tracking
- `services/contestEvaluationService.js` - Contest management
- `services/userBalanceTrackingService.js` - Wallet balance monitoring

### Achievement System
The achievement system is implemented through:
- `services/achievementService.js` - Core service for tracking achievements
- `services/levelingService.js` - XP and level progression
- Database tables:
  - `user_achievements`
  - `achievement_categories`
  - `achievement_tiers`
  - `achievement_tier_requirements`
  - `user_levels`
# WebSocket Testing

We have created a dedicated tool for testing WebSockets across different implementations:

```bash
# Test SkyDuel WebSocket
npm run ws skyduel <token>

# Test Token Data WebSocket
npm run ws token-data <token>

# Test Circuit Breaker WebSocket
npm run ws circuit-breaker <token>

# Test Monitor WebSocket
npm run ws monitor <token>
```

Currently only SkyDuel WebSocket is working properly, as it has a different authentication mechanism than the other WebSockets. The token-data WebSocket connects but then has issues with compressed frames.

# Logging Infrastructure

### Logtail Integration

DegenDuel uses Logtail for centralized logging. Key information:

- **Dashboard**: https://betterstack.com/logs - Login with admin credentials
- **Environment Variables**:
  ```
  LOGTAIL_TOKEN=znteWCbz8P9S5yHyvsM4nj8r
  LOGTAIL_ENDPOINT=https://s1229719.eu-nbg-2.betterstackdata.com
  LOGTAIL_SOURCE=degenduel_server  # Varies by service
  ```

- **Service-Specific Sources**:
  - API: `degenduel_server`
  - API Test/Dev: `degenduel_server_test`
  - Lobby: `degenduel_lobby`
  - Reflections: `degenduel_reflections`
  - MCP: `degenduel_mcp`

### Logger Implementation

The logger is implemented in `/utils/logger-suite/logger.js` and provides:
- Console logging with colors
- File logging to `/logs` directory
- Logtail remote logging
- Service-specific logging via `logApi.forService('SERVICE_NAME')`

### Updating Logtail Configuration

If you need to update Logtail settings:

1. Update both `.env` and `ecosystem.config.cjs`
2. Restart services with: `npm run reload`
3. Verify logs appear in Logtail dashboard

# Server Restart Checklist

### Quick Commands (Recommended)

```bash
# PREFERRED NON-BLOCKING COMMANDS (RECOMMENDED)
# ------------------------------------
# Start API service
npm run pm2:start

# Stop API service
npm run pm2:stop

# Restart API service with updated env vars (NON-BLOCKING - IMPORTANT!)
npm run pm2:restart & 

# Restart API and view logs (MUST BE RUN NON-BLOCKING)
npm run pm2:restart-logs & # CRITICAL: Add '&' to make it non-blocking

# Manage all services
npm run pm2:start-all     # Start all services
npm run pm2:stop-all      # Stop all services
npm run pm2:restart-all & # Restart all services (NON-BLOCKING)

# LEGACY COMMANDS (STILL SUPPORTED)
# --------------------------------
# Start everything from scratch
npm run up

# Restart everything with updated environment variables
npm run reload

# Service-specific restarts
npm run api:reload       # Restart API only
npm run lobby:reload     # Restart lobby only
npm run reflections:reload  # Restart reflections only
npm run mcp:reload       # Restart MCP only
```

### Troubleshooting

If market database errors appear, check:
1. Database credentials in ecosystem.config.cjs and .env
2. Make sure database is running: `psql -U branchmanager -h localhost -d degenduel_market_data` 
3. Check non-blocking error logs: `tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-error.log | grep "market database"`

### After Environment Variable Changes

Always restart with the update flag to apply new environment variables:
```bash
# Proper way to restart after env var changes
npm run reload  # All services
npm run api:reload  # Just API
```

### Logs Inspection (Non-blocking)

Check logs without getting stuck in a blocking process:
```bash
# Latest output logs
tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-out.log

# Latest error logs 
tail -n 50 /home/branchmanager/.pm2/logs/degenduel-api-error.log

# Search for specific errors
grep -i "error" /home/branchmanager/.pm2/logs/degenduel-api-out.log | tail -n 30
```
