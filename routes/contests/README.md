# Contest Routes - Modular Implementation

This directory contains the refactored contest routes for DegenDuel, providing a more maintainable and modular architecture.

## Module Structure

The contest routes are organized into these logical modules:

1. **base.js** - Core CRUD operations
   - GET / - List all contests
   - GET /:id - Get contest details
   - POST / - Create a contest
   - PUT /:id - Update a contest (admin only)

2. **participation.js** - Contest participation
   - POST /:id/enter - Enter a contest (pay entry fee)
   - POST /:id/join - Join a free contest
   - GET /:id/check-participation - Check if user is participating
   - GET /user-participations - Get all contests a user is in
   - GET /participations/:wallet - Get participations for a wallet

3. **admin.js** - Admin operations
   - POST /:id/start - Start a contest
   - POST /:id/end - End a contest

4. **leaderboard.js** - Leaderboard data
   - GET /:id/leaderboard - Get contest leaderboard

5. **portfolio.js** - Portfolio management
   - POST /:id/portfolio - Create/update portfolio
   - GET /:id/portfolio/:wallet - Get user's portfolio

6. **schedule.js** - Contest scheduling
   - GET /schedules - Get all contest schedules
   - GET /schedules/:id - Get schedule by ID

## Integration

The main index.js file imports all modules and combines them into a single router.

## Utility Functions

Shared functionality is located in `/utils/contest-helpers.js`, which includes:

- Contest validation
- Participation checking
- Portfolio management
- Contest state transitions

## Migration Path

The transition from the monolithic to modular approach is handled by a bridging
module in `/routes/contests-integration.js`, which allows for a phased migration.

## Adding New Routes

When adding new routes related to contests:

1. Identify the most appropriate module for the route
2. Add the route to that module
3. Use the shared utilities from contest-helpers.js where possible
4. Maintain consistent error handling, logging, and response formats

## Security Considerations

All routes maintain the original authorization requirements:
- Public routes: No auth required
- User routes: requireAuth middleware
- Admin routes: requireAdmin middleware
- SuperAdmin routes: requireSuperAdmin middleware