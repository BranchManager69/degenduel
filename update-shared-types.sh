#!/bin/bash

# Script to implement the new shared types into the degenduel-shared package

# Check if we're in the degenduel directory
if [[ "$(basename $(pwd))" != "degenduel" ]]; then
  echo "Error: Please run this script from the degenduel directory."
  exit 1
fi

echo "Starting shared types implementation..."

# Create directories
echo "Creating directories in shared package..."
mkdir -p ../degenduel-shared/src/types

# Copy the implementation files
echo "Copying implementation files..."

# Check if the implementation files exist
if [[ ! -f "websocket-types-implementation.ts" || ! -f "entity-types-implementation.ts" || ! -f "api-transaction-types-implementation.ts" ]]; then
  echo "Error: Implementation files not found."
  exit 1
fi

# Copy websocket types
echo "Creating websocket.ts..."
cp websocket-types-implementation.ts ../degenduel-shared/src/types/websocket.ts

# Copy entity types
echo "Creating entities.ts..."
cp entity-types-implementation.ts ../degenduel-shared/src/types/entities.ts

# Copy API types
echo "Creating api.ts..."
cp api-transaction-types-implementation.ts ../degenduel-shared/src/types/api.ts

# Back up the original index.ts
echo "Backing up original index.ts..."
cp ../degenduel-shared/src/index.ts ../degenduel-shared/src/index.ts.bak

# Create the new index.ts
echo "Creating new index.ts..."
cat > ../degenduel-shared/src/index.ts << 'EOF'
// Export all shared types and utilities

// Re-export all types from their respective files
export * from './types/websocket';
export * from './types/entities';
export * from './types/api';

// Keep the existing interfaces for backward compatibility
// but mark them as deprecated for future removal

/** @deprecated Use DDUser instead */
export interface User {
  id: string;
  username: string;
  wallet?: string;
  createdAt: Date;
}

/** @deprecated Use DDToken instead */
export interface Token {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
}

/** @deprecated Use DDContest instead */
export interface Contest {
  id: string;
  name: string;
  startTime: Date;
  endTime: Date;
  status: ContestStatus;
  participants: number;
  prize: number;
}

/** @deprecated Use DDContestStatus instead */
export enum ContestStatus {
  UPCOMING = 'upcoming',
  ACTIVE = 'active',
  ENDED = 'ended',
  CANCELED = 'canceled'
}

// Shared utilities
export function formatTokenPrice(price: number): string {
  return price < 0.01 
    ? price.toExponential(2) 
    : price.toLocaleString('en-US', { 
        style: 'currency', 
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 
      });
}

/** @deprecated Use DDApiResponse instead */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/** @deprecated Use DDWebSocketMessage instead */
export interface WsMessage<T = any> {
  type: string;
  topic: string;
  data: T;
  timestamp: number;
}
EOF

echo "Building shared package..."
(cd ../degenduel-shared && npm run build)

echo "Implementation complete! Please check the files in ../degenduel-shared/"
echo "Don't forget to run 'npm install' in both backend and frontend projects to use the updated types."