# DegenDuel Project Reference

## Project Management

### Process Management
- **IMPORTANT**: DegenDuel uses PM2 for process management, not npm scripts for running the application
- Use PM2 commands instead of npm for managing the application processes:

```bash
# View running processes
pm2 list

# Restart all processes
pm2 restart all

# Restart specific process
pm2 restart degenduel-api

# View logs
pm2 logs
pm2 logs degenduel-api
```

The project uses `ecosystem.config.cjs` to manage multiple environments:
- `degenduel-api` - Production API on port 3004
- `degenduel-api-test` - Development/Test API on port 3005
- `prisma-studio` - Production database UI on port 5555
- `prisma-studio-test` - Test database UI on port 5556

### Environment Details
- Production: https://degenduel.me
- Development: https://dev.degenduel.me
- Both use the same PostgreSQL database by default

## Database Management

### Prisma Commands
```bash
# Generate Prisma client
npx prisma generate

# Create migration
npx prisma migrate dev --name your_migration_name

# Apply migrations
npx prisma migrate deploy

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