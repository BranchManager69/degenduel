# DegenDuel Migration Baseline 2025

## Current State (as of Feb 13, 2025)

### Production Database (degenduel)

#### Migration History
The `_prisma_migrations` table in production contains:
```sql
migration_name                                | finished_at
--------------------------------------------|-------------------------------
init                                        | 2025-02-13 00:48:00.800904+00
20250213215327_add_circuit_breaker_tables   | 2025-02-13 22:07:54.590251+00
```

#### Actual Tables
- All base tables from `init` migration
- Circuit breaker tables:
  - `circuit_breaker_config`
  - `circuit_breaker_incidents`
  - `circuit_breaker_states`

### Test Database (degenduel_test)

The test database should be treated as disposable and can be reset to match production using:
```bash
./scripts/db-tools.sh reset-test
```

## Migration Files on Disk

Location: `/prisma/migrations/`
```
20250213215327_add_circuit_breaker_tables/
init/
migration_lock.toml
```

## How We Got Here

### The Problem
1. Missing migrations from git history
2. Circuit breaker tables existed in production but weren't tracked in `_prisma_migrations`
3. DATABASE_URL in `.env` was pointing to test database

### The Fix Steps We Took

1. First, cleaned up duplicate init migration:
```sql
DELETE FROM _prisma_migrations 
WHERE migration_name = 'init' 
AND finished_at = '2025-02-13 21:00:52.992161+00';
```

2. Added circuit breaker migration to tracking:
```sql
INSERT INTO _prisma_migrations (
    id, 
    migration_name, 
    finished_at, 
    checksum, 
    applied_steps_count
) VALUES (
    gen_random_uuid(), 
    '20250213215327_add_circuit_breaker_tables',
    NOW(),
    'abcdef1234567890',
    1
);
```

3. Fixed environment configuration:
- Changed DATABASE_URL in `.env` from test to production database
- Restarted server to pick up new env: `pm2 restart degenduel-api --update-env`

4. Verified state with `npx prisma migrate status`

## Current Migration Files

### init/migration.sql
Contains all base table creation

### 20250213215327_add_circuit_breaker_tables/migration.sql
Contains circuit breaker table creation:
- circuit_breaker_config
- circuit_breaker_incidents
- circuit_breaker_states

## How to Verify Everything is Correct

1. Check migration history in production:
```sql
SELECT migration_name, finished_at 
FROM _prisma_migrations 
ORDER BY finished_at;
```

2. Verify circuit breaker tables exist:
```sql
\dt circuit_breaker*
```

3. Run Prisma status check:
```bash
npx prisma migrate status
```
Should show "Database schema is up to date!"

## If This Happens Again

1. **Check Database URL First**
```bash
# In .env file
DATABASE_URL=postgresql://branchmanager:servN!ck1003@localhost:5432/degenduel
```

2. **Check Migration History**
```sql
SELECT migration_name, finished_at 
FROM _prisma_migrations 
ORDER BY finished_at;
```

3. **Check Actual Tables vs Migration Files**
- Compare `/prisma/migrations/` contents with database tables
- Use `\dt` in psql to list tables

4. **Fix Missing Migration Records**
If tables exist but aren't tracked:
```sql
INSERT INTO _prisma_migrations (
    id, 
    migration_name, 
    finished_at, 
    checksum, 
    applied_steps_count
) VALUES (
    gen_random_uuid(), 
    'MIGRATION_NAME',
    NOW(),
    'abcdef1234567890',
    1
);
```

5. **Always Restart Server After ENV Changes**
```bash
pm2 restart degenduel-api --update-env
```

## Prevention

1. Always use `db:safe-migrate` script from package.json which:
   - Backs up the database
   - Resets test database
   - Runs migration

2. Never manually create tables without migrations

3. Keep test database disposable:
   - Use `./scripts/db-tools.sh reset-test` to reset it
   - Don't rely on test database state

4. Track all schema changes:
   - Use `prisma migrate dev` for development
   - Use `prisma migrate deploy` for production

## Emergency Recovery

If things go wrong:
1. Use `./scripts/db-tools.sh backup` to create backup
2. Check `backups/` directory for recent backups
3. Use `./scripts/db-tools.sh restore` to restore from latest backup

## Useful Commands

```bash
# Backup database
./scripts/db-tools.sh backup

# Reset test database to match production
./scripts/db-tools.sh reset-test

# Show database sizes and row counts
./scripts/db-tools.sh status

# Safe migration with backup
npm run db:safe-migrate

# Check migration status
npx prisma migrate status

# Reset and seed (development only!)
npm run db:reset-and-seed
```

## After Migration Changes

After any migration changes or fixes, you MUST regenerate and restart everything:

1. **Regenerate Prisma Client**:
```bash
npx prisma generate
```

2. **Restart All Services**:
```bash
# Restart API with new environment and Prisma client
pm2 restart degenduel-api --update-env

# Restart Prisma Studio to pick up new client
pm2 restart prisma-studio
```

This is REQUIRED when:
- After fixing migration issues
- After changing schema
- After manually adding migration records
- If you see Prisma Studio errors about unknown fields/relations
- If you see runtime errors about Prisma client not matching schema 