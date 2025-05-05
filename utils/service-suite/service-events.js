import { EventEmitter } from 'events';

/**
 * Constants for service events
 * These are used to standardize event names across services
 */
export const SERVICE_EVENTS = {
    // General service events
    SERVICE_INITIALIZED: 'service:initialized',
    SERVICE_STARTED: 'service:started',
    SERVICE_STOPPED: 'service:stopped',
    SERVICE_ERROR: 'service:error',
    SERVICE_STATUS_CHANGE: 'service:status_change',
    
    // Contest events
    CONTEST_CREATED: 'contest:created',
    CONTEST_STARTED: 'contest:started',
    CONTEST_ENDED: 'contest:ended',
    CONTEST_CANCELLED: 'contest:cancelled',
    CONTEST_ACTIVITY: 'contest:activity',
    CONTEST_COMPLETED: 'contest:completed', // New event for contest completion with winners
    
    // User events
    USER_ACHIEVEMENT: 'user:achievement',
    USER_LEVEL_UP: 'user:level_up',
    USER_MILESTONE: 'user:milestone',
    
    // Transaction events
    TRANSACTION_CREATED: 'transaction:created',
    TRANSACTION_CONFIRMED: 'transaction:confirmed',
    TRANSACTION_FAILED: 'transaction:failed',
    LARGE_TRANSACTION: 'transaction:large',
    TOKEN_PURCHASE: 'token:purchase',
    TOKEN_SALE: 'token:sale',
    TOKEN_PRICE_UPDATE: 'token:price_update',
    
    // System events
    SYSTEM_ALERT: 'system:alert',
    SYSTEM_MAINTENANCE: 'system:maintenance',
    SYSTEM_STARTUP: 'system:startup',
    SYSTEM_SHUTDOWN: 'system:shutdown',
    PRIVILEGE_GRANTED: 'privilege:granted',
    PRIVILEGE_REVOKED: 'privilege:revoked'
};

class ServiceEventManager extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50); // Allow more listeners for multiple services
    }

    initialize() {
        this.removeAllListeners(); // Clean slate on initialize
    }

    cleanup() {
        this.removeAllListeners();
    }
}

// Create a singleton instance
const serviceEvents = new ServiceEventManager();

// Export the singleton
export default serviceEvents; 