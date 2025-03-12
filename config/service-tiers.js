// config/service-tiers.js

export const ServiceTier = {
  CRITICAL: "critical", // Never stops (price updates, system monitoring)
  STANDARD: "standard", // Stops in maintenance mode
};

export const SERVICE_DEFINITIONS = {
  // Token-related services (CRITICAL)
  token_sync_service: {
    tier: ServiceTier.CRITICAL,
    description: "Maintains real-time token price data",
    endpoints: [
      "/api/dd-serv/tokens/list",
      "/api/dd-serv/tokens/prices",
      "/api/tokens/prices",
    ],
  },

  // Standard services
  contest_service: {
    tier: ServiceTier.STANDARD,
    description: "Manages contest lifecycle and portfolio evaluations",
    endpoints: ["/api/contests/evaluate", "/api/contests/status"],
  },
  user_service: {
    tier: ServiceTier.STANDARD,
    description: "Handles user management and profiles",
    endpoints: ["/api/users"],
  },
  stats_service: {
    tier: ServiceTier.STANDARD,
    description: "Manages analytics and statistics",
    endpoints: ["/api/stats"],
  },
};

export const getServiceTierForEndpoint = (path) => {
  // Remove /api prefix for matching
  const normalizedPath = path.replace(/^\/api/, "");

  // Check each service's endpoints
  for (const [serviceName, service] of Object.entries(SERVICE_DEFINITIONS)) {
    if (
      service.endpoints.some((endpoint) => {
        const normalizedEndpoint = endpoint.replace(/^\/api/, "");
        return normalizedPath.startsWith(normalizedEndpoint);
      })
    ) {
      return service.tier;
    }
  }

  // Default to STANDARD if no match found
  return ServiceTier.STANDARD;
};
