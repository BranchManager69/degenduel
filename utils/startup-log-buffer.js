// utils/startup-log-buffer.js
// A buffer to capture initialization logs for display in the startup banner

/**
 * Singleton class to capture and store log messages during startup
 */
class StartupLogBuffer {
  constructor() {
    if (StartupLogBuffer.instance) {
      return StartupLogBuffer.instance;
    }
    
    this.logs = [];
    this.enabled = true;
    this.maxEntries = 15; // Maximum number of log entries to keep
    this.importantKeywords = [
      'initialized', 'started', 'connected', 'loaded', 'registered', 
      'mounted', 'configuring', 'starting', 'online', 'setup', 'ready',
      'service', 'database', 'routes', 'websocket'
    ];
    
    StartupLogBuffer.instance = this;
  }
  
  /**
   * Add a log message to the buffer
   * @param {string} level - Log level (info, warn, error)
   * @param {string} message - The log message
   * @param {Object} metadata - Additional metadata
   */
  addLog(level, message, metadata = {}) {
    if (!this.enabled) return;
    
    // Skip certain verbose or less useful messages
    if (this.shouldSkipMessage(message, metadata)) return;
    
    // Create log entry
    const entry = {
      level,
      message: this.cleanMessage(message),
      timestamp: new Date(),
      service: metadata.service || '',
      important: this.isImportantMessage(message)
    };
    
    // Add to log buffer
    this.logs.push(entry);
    
    // Trim if needed
    if (this.logs.length > this.maxEntries) {
      // Prioritize important logs and errors when trimming
      this.logs.sort((a, b) => {
        // First by importance
        if (a.important && !b.important) return -1;
        if (!a.important && b.important) return 1;
        
        // Then by level (errors and warnings first)
        if (a.level === 'error' && b.level !== 'error') return -1;
        if (a.level !== 'error' && b.level === 'error') return 1;
        if (a.level === 'warn' && b.level === 'info') return -1;
        if (a.level === 'info' && b.level === 'warn') return 1;
        
        // Then by timestamp (newer first)
        return b.timestamp - a.timestamp;
      });
      
      // Remove excess logs while keeping important ones
      while (this.logs.length > this.maxEntries) {
        // Find the least important log to remove
        const indexToRemove = this.logs.findIndex(log => 
          !log.important && log.level !== 'error' && log.level !== 'warn'
        );
        
        if (indexToRemove >= 0) {
          this.logs.splice(indexToRemove, 1);
        } else {
          // If all logs are important or errors/warnings, remove the oldest
          this.logs.pop();
        }
      }
    }
  }
  
  /**
   * Get all captured logs
   * @returns {Array} Array of log entries
   */
  getLogs() {
    return [...this.logs];
  }
  
  /**
   * Clear all logs
   */
  clear() {
    this.logs = [];
  }
  
  /**
   * Enable or disable log capturing
   * @param {boolean} enabled - Whether to enable log capturing
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  
  /**
   * Check if a message is important based on keywords
   * @param {string} message - The log message
   * @returns {boolean} Whether the message is important
   */
  isImportantMessage(message) {
    if (typeof message !== 'string') return false;
    
    const lowerMessage = message.toLowerCase();
    return this.importantKeywords.some(keyword => 
      lowerMessage.includes(keyword)
    );
  }
  
  /**
   * Check if a message should be skipped
   * @param {string} message - The log message
   * @param {Object} metadata - Additional metadata
   * @returns {boolean} Whether the message should be skipped
   */
  shouldSkipMessage(message, metadata) {
    if (typeof message !== 'string') return true;
    
    // Skip raw headers and very technical logs
    const skipPatterns = [
      'RAW HEADERS',
      'X-Forwarded-For',
      'USER AGENT:',
      'token:',
      'GET /api/',
      'POST /api/',
      'req.headers',
      'websocket headers'
    ];
    
    return skipPatterns.some(pattern => message.includes(pattern));
  }
  
  /**
   * Clean up a log message for display
   * @param {string} message - The log message
   * @returns {string} Cleaned message
   */
  cleanMessage(message) {
    if (typeof message !== 'string') return String(message);
    
    // Remove ANSI color codes
    let cleaned = message.replace(/\x1b\[[0-9;]*m/g, '');
    
    // Truncate if too long
    if (cleaned.length > 100) {
      cleaned = cleaned.substring(0, 97) + '...';
    }
    
    return cleaned;
  }
}

// Create and export singleton instance
export const startupLogBuffer = new StartupLogBuffer();
export default startupLogBuffer;