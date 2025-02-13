// Simple in-memory cache implementation
class Cache {
    constructor() {
        this.cache = new Map();
        this.timeouts = new Map();
    }

    async get(key) {
        return this.cache.get(key);
    }

    async set(key, value, ttlSeconds = 300) {
        // Clear any existing timeout
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
        }

        // Set the value
        this.cache.set(key, value);

        // Set expiration
        const timeout = setTimeout(() => {
            this.cache.delete(key);
            this.timeouts.delete(key);
        }, ttlSeconds * 1000);

        this.timeouts.set(key, timeout);
    }

    async del(key) {
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
        }
        this.cache.delete(key);
    }

    async clear() {
        // Clear all timeouts
        for (const timeout of this.timeouts.values()) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
        this.cache.clear();
    }
}

// Export singleton instance
export default new Cache(); 