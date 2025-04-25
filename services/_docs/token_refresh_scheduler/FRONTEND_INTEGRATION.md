# Token Refresh Scheduler - Frontend Integration Guide

This document provides a concise overview of the Token Refresh Scheduler admin API routes for frontend integration.

## API Overview

The Token Refresh Scheduler API allows admins to:

1. Monitor scheduler performance and metrics
2. View and update token refresh settings
3. Apply recommended settings based on token importance
4. Manually trigger token refreshes

## Base URL

All endpoints are accessed via:

```
/api/admin/token-refresh
```

## Authentication

All routes require JWT authentication with either `admin` or `superadmin` roles.

## Quick Reference

| Endpoint | Method | Description | Request Parameters |
|----------|--------|-------------|-------------------|
| `/status` | GET | Get scheduler metrics | None |
| `/recommendations` | GET | Get refresh recommendations | None |
| `/tokens` | GET | List token refresh settings | Query: `limit`, `offset`, `sort`, `order` |
| `/tokens/:tokenId` | PUT | Update token settings | Body: `refresh_interval_seconds`, `priority_score`, `metadata` |
| `/tokens/:tokenAddress/refresh` | POST | Manually refresh a token | None |
| `/bulk-update` | POST | Update multiple tokens | Body: `tokens[]` |
| `/apply-tier-settings` | POST | Apply recommendations to all tokens | None |

## UI Components

### 1. Scheduler Status Dashboard

![Status Dashboard](https://via.placeholder.com/800x400?text=Status+Dashboard)

**Key Elements:**
- Current metrics (batches, tokens, success rate)
- Performance charts (API calls, latency)
- Status indicator (running/stopped)
- Circuit breaker status

**API Endpoints:**
- `GET /status` - Poll every 30-60 seconds

### 2. Token Settings Manager

![Token Settings](https://via.placeholder.com/800x400?text=Token+Settings+Manager)

**Key Elements:**
- Filterable, paginated table of tokens
- Refresh interval and priority editors
- Status indicators (last refresh, success)
- Manual refresh button

**API Endpoints:**
- `GET /tokens` - With pagination and sorting
- `PUT /tokens/:tokenId` - For individual updates
- `POST /tokens/:tokenAddress/refresh` - For manual refresh

### 3. Bulk Operations Panel

![Bulk Operations](https://via.placeholder.com/800x400?text=Bulk+Operations+Panel)

**Key Elements:**
- Multi-select token table
- Batch edit form
- Apply recommendations button
- Tier-based settings visualization

**API Endpoints:**
- `GET /recommendations` - To show recommendations
- `POST /bulk-update` - For batch updates
- `POST /apply-tier-settings` - For applying tier settings

## Implementation Example

```javascript
// Example React component for scheduler status
function SchedulerStatus() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/admin/token-refresh/status', {
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          setMetrics(data.data);
        } else {
          console.error('Failed to fetch metrics');
        }
      } catch (error) {
        console.error('Error fetching metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000); // Poll every 30 seconds
    
    return () => clearInterval(interval);
  }, []);

  if (loading) return <LoadingSpinner />;
  
  return (
    <StatusPanel 
      activeTokens={metrics?.scheduler?.activeTokens}
      successRate={metrics?.performance?.successRate}
      apiCalls={metrics?.currentWindow?.apiCalls}
      // Add more metrics as needed
    />
  );
}
```

## Best Practices

1. **Poll judiciously** - Status updates every 30-60 seconds are sufficient
2. **Implement pagination** - The tokens list can be large; use server-side pagination
3. **Show loading states** - All API calls should have appropriate loading indicators
4. **Handle errors gracefully** - Show user-friendly error messages
5. **Confirm destructive actions** - Especially when applying bulk updates
6. **Provide contextual help** - Explain what refresh intervals and priority scores mean

## Recommended Workflow

For efficient token management, we recommend:

1. Start with the Status Dashboard to understand current performance
2. Review recommendations to see optimal settings
3. Use tier-based settings to quickly apply best practices
4. Fine-tune individual high-priority tokens as needed
5. Monitor performance after changes