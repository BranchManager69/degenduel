import { EventEmitter } from 'events';

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