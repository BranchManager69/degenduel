# Release Date API Implementation Guide

## Overview

This document provides implementation guidelines for frontend integration with DegenDuel API's release date functionality.

## Existing Frontend Implementation

Your frontend is currently using:
```typescript
// API endpoint for fetching the release date
const endpoint = `${API_URL}/api/v1/release-date`;
```

However, this endpoint does not exist in the backend. Instead, you should use our countdown API.

## Recommended API Endpoint

### Countdown API

```
GET /api/status/countdown
```

#### Response Structure

```typescript
interface CountdownResponse {
  success: boolean;
  countdown: {
    enabled: boolean;
    end_time: string; // ISO-8601 format date string
    title: string;
    message: string;
    redirect_url: string | null;
  }
}
```

#### Example Response

```json
{
  "success": true,
  "countdown": {
    "enabled": true,
    "end_time": "2025-12-31T23:59:59-05:00",
    "title": "Token Launch",
    "message": "DegenDuel is launching soon!",
    "redirect_url": null
  }
}
```

## Frontend Integration Guide

### Updated Service Implementation

```typescript
/**
 * Release Date Service
 * 
 * This service handles fetching the release date from the backend
 * with a fallback to the date defined in environment variables.
 */

// Get API URL from environment variables
const API_URL = import.meta.env.VITE_API_URL || 'https://degenduel.me';

// Fallback release date from environment variables or default to December 31st, 11:59 PM Eastern
export const FALLBACK_RELEASE_DATE = new Date(
  import.meta.env.VITE_RELEASE_DATE_TOKEN_LAUNCH_DATETIME || '2025-12-31T23:59:59-05:00'
);

// Cache for the fetched release date
let cachedReleaseDate: Date | null = null;

/**
 * Fetch the release date from the backend
 * @returns Promise that resolves to the release date
 */
export const fetchReleaseDate = async (): Promise<Date> => {
  // If we already have the date cached, return it
  if (cachedReleaseDate) {
    return cachedReleaseDate;
  }
  
  // API endpoint for fetching the release date (using countdown endpoint)
  const endpoint = `${API_URL}/api/status/countdown`;
  
  try {
    console.log(`Fetching release date from endpoint: ${endpoint}`);
    
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      throw new Error(`Error fetching release date: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.success && data.countdown && data.countdown.enabled && data.countdown.end_time) {
      // Convert string date to Date object
      const releaseDate = new Date(data.countdown.end_time);
      
      // Cache the result
      cachedReleaseDate = releaseDate;
      
      console.log(`Release date fetched: ${releaseDate.toISOString()}`);
      return releaseDate;
    } else {
      console.warn('Release date not available from API, using fallback');
      return FALLBACK_RELEASE_DATE;
    }
  } catch (error) {
    console.error('Error fetching release date:', error);
    console.log(`Using fallback release date: ${FALLBACK_RELEASE_DATE.toISOString()}`);
    return FALLBACK_RELEASE_DATE;
  }
};

/**
 * Get a human-readable representation of the release date
 * @param date The release date
 * @returns Formatted date string
 */
export const formatReleaseDate = (date: Date): string => {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  });
};

/**
 * Get countdown title and message if available
 * @returns Promise that resolves to countdown info or null
 */
export const getCountdownInfo = async (): Promise<{title: string, message: string} | null> => {
  const endpoint = `${API_URL}/api/status/countdown`;
  
  try {
    const response = await fetch(endpoint);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.success && data.countdown && data.countdown.enabled) {
      return {
        title: data.countdown.title,
        message: data.countdown.message
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching countdown info:', error);
    return null;
  }
};
```

### Usage Examples

#### Basic Usage

```typescript
import { fetchReleaseDate, formatReleaseDate } from '../services/releaseDateService';

// In your component
const [releaseDate, setReleaseDate] = useState<Date | null>(null);

useEffect(() => {
  async function loadReleaseDate() {
    const date = await fetchReleaseDate();
    setReleaseDate(date);
  }
  
  loadReleaseDate();
}, []);

// In your render method
return (
  <div>
    <h2>Token Launch</h2>
    {releaseDate && (
      <p>Release Date: {formatReleaseDate(releaseDate)}</p>
    )}
  </div>
);
```

#### With Countdown Info

```typescript
import { fetchReleaseDate, formatReleaseDate, getCountdownInfo } from '../services/releaseDateService';

// In your component
const [releaseDate, setReleaseDate] = useState<Date | null>(null);
const [countdownInfo, setCountdownInfo] = useState<{title: string, message: string} | null>(null);

useEffect(() => {
  async function loadData() {
    const date = await fetchReleaseDate();
    setReleaseDate(date);
    
    const info = await getCountdownInfo();
    setCountdownInfo(info);
  }
  
  loadData();
}, []);

// In your render method
return (
  <div>
    {countdownInfo ? (
      <>
        <h2>{countdownInfo.title}</h2>
        <p>{countdownInfo.message}</p>
      </>
    ) : (
      <h2>Token Launch</h2>
    )}
    
    {releaseDate && (
      <p>Release Date: {formatReleaseDate(releaseDate)}</p>
    )}
  </div>
);
```

## Additional Information

1. The countdown endpoint provides not just the release date, but also contextual information like title and message that can enhance your UI
2. The countdown can be enabled/disabled from the admin panel
3. The backend has a redirect_url feature that you may want to incorporate
4. Your fallback date logic is preserved in case the API is unavailable

For questions about this implementation, contact the backend team.