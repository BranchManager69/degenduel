// Log visibility configuration
export const LOG_VISIBILITY = {
  // System Health
  MAINTENANCE_CHECK: {
    enabled: true,
    description: "Maintenance mode status checks",
    pattern: ["Maintenance check", "Maintenance status fetched"],
    level: "info"
  },
  EVENT_LOOP_LAG: {
    enabled: true,
    description: "Event loop lag warnings",
    pattern: ["Event loop lag detected"],
    level: "warn"
  },
  MEMORY_STATS: {
    enabled: true,
    description: "Regular memory usage statistics",
    pattern: ["Memory Stats"],
    level: "info"
  },

  // Critical Events
  CIRCUIT_BREAKER: {
    enabled: true,
    description: "Circuit breaker state changes",
    pattern: ["Circuit breaker opened", "Circuit breaker reset"],
    level: "error",
    priority: "high"
  },
  PRISMA_ERROR: {
    enabled: true,
    description: "Database query and schema errors",
    pattern: ["Prisma Error"],
    level: "error",
    priority: "medium"
  },

  // Administrative
  ADMIN_ACTIONS: {
    enabled: true,
    description: "Administrative actions",
    pattern: ["Admin action logged"],
    level: "info"
  },
  SERVER_LIFECYCLE: {
    enabled: true,
    description: "Server startup and shutdown events",
    pattern: [
      "Database connection closed",
      "PostgreSQL connection closed",
      "Server startup",
      "Server shutdown"
    ],
    level: "info",
    priority: "high"
  },

  // Performance Metrics
  API_PERFORMANCE: {
    enabled: true,
    description: "API performance statistics",
    pattern: ["API Performance"],
    level: "info"
  },
  TOKEN_SYNC: {
    enabled: true,
    description: "Token synchronization operations",
    pattern: ["Fetching prices for", "Token sync"],
    level: "info"
  },

  // User Activity
  USER_INTERACTION: {
    enabled: true,
    description: "User interactions and sessions",
    pattern: ["User interaction", "User session"],
    level: "info"
  }
};

// Helper function to check if a log should be visible
export function shouldShowLog(message, level) {
  // Always show high priority logs
  const matchingConfig = Object.values(LOG_VISIBILITY).find(config => 
    config.pattern.some(pattern => message.includes(pattern))
  );

  if (!matchingConfig) return true; // Show logs that don't match any pattern
  if (matchingConfig.priority === 'high') return true;
  
  return matchingConfig.enabled && matchingConfig.level === level;
}

// Export configuration management functions
export function updateLogVisibility(category, enabled) {
  if (LOG_VISIBILITY[category]) {
    LOG_VISIBILITY[category].enabled = enabled;
    return true;
  }
  return false;
}

export function getLogCategories() {
  return Object.entries(LOG_VISIBILITY).map(([key, config]) => ({
    category: key,
    ...config
  }));
} 