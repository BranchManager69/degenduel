/**
 * Metrics Collector for Token Refresh Scheduler
 * 
 * Collects and analyzes metrics about token refresh operations
 * to provide insights for optimization and monitoring.
 */

export default class MetricsCollector {
  constructor(config = {}) {
    this.config = config;
    
    // Initialize metrics
    this.reset();
  }

  /**
   * Reset all metrics
   */
  reset() {
    // Current window metrics
    this.currentWindow = {
      startTime: Date.now(),
      endTime: null,
      batchesAttempted: 0,
      batchesCompleted: 0,
      batchesFailed: 0,
      tokensAttempted: 0,
      tokensUpdated: 0,
      tokensFailed: 0,
      totalDuration: 0,
      batchDurations: [],
      errors: [],
      apiCalls: 0
    };
    
    // Historical metrics
    this.history = {
      windows: [],
      totalBatchesAttempted: 0,
      totalBatchesCompleted: 0,
      totalBatchesFailed: 0,
      totalTokensAttempted: 0,
      totalTokensUpdated: 0,
      totalTokensFailed: 0,
      totalApiCalls: 0
    };
    
    // Performance metrics
    this.performance = {
      avgBatchDuration: 0,
      maxBatchDuration: 0,
      minBatchDuration: Infinity,
      p95BatchDuration: 0,
      successRate: 1.0
    };
  }

  /**
   * Record completion of a batch
   * @param {number} tokenCount - Number of tokens in the batch
   * @param {number} durationMs - Duration of batch processing in ms
   */
  recordBatchCompletion(tokenCount, durationMs) {
    // Update current window metrics
    this.currentWindow.batchesAttempted++;
    this.currentWindow.batchesCompleted++;
    this.currentWindow.tokensAttempted += tokenCount;
    this.currentWindow.tokensUpdated += tokenCount;
    this.currentWindow.totalDuration += durationMs;
    this.currentWindow.batchDurations.push(durationMs);
    this.currentWindow.apiCalls++;
    
    // Update history
    this.history.totalBatchesAttempted++;
    this.history.totalBatchesCompleted++;
    this.history.totalTokensAttempted += tokenCount;
    this.history.totalTokensUpdated += tokenCount;
    this.history.totalApiCalls++;
    
    // Update performance metrics
    this.updatePerformanceMetrics();
    
    // Check if window should be closed
    this.checkWindowRollover();
  }

  /**
   * Record failure of a batch
   * @param {number} tokenCount - Number of tokens in the batch
   * @param {number} durationMs - Duration of batch processing in ms
   * @param {string} errorMessage - Error message
   */
  recordBatchFailure(tokenCount, durationMs, errorMessage) {
    // Update current window metrics
    this.currentWindow.batchesAttempted++;
    this.currentWindow.batchesFailed++;
    this.currentWindow.tokensAttempted += tokenCount;
    this.currentWindow.tokensFailed += tokenCount;
    this.currentWindow.totalDuration += durationMs;
    this.currentWindow.batchDurations.push(durationMs);
    this.currentWindow.apiCalls++;
    this.currentWindow.errors.push({
      timestamp: Date.now(),
      message: errorMessage,
      tokenCount
    });
    
    // Update history
    this.history.totalBatchesAttempted++;
    this.history.totalBatchesFailed++;
    this.history.totalTokensAttempted += tokenCount;
    this.history.totalTokensFailed += tokenCount;
    this.history.totalApiCalls++;
    
    // Update performance metrics
    this.updatePerformanceMetrics();
    
    // Check if window should be closed
    this.checkWindowRollover();
  }

  /**
   * Update performance metrics based on current data
   */
  updatePerformanceMetrics() {
    // Calculate average batch duration
    if (this.currentWindow.batchDurations.length > 0) {
      const sum = this.currentWindow.batchDurations.reduce((a, b) => a + b, 0);
      this.performance.avgBatchDuration = sum / this.currentWindow.batchDurations.length;
      
      // Calculate min and max durations
      this.performance.maxBatchDuration = Math.max(...this.currentWindow.batchDurations);
      this.performance.minBatchDuration = Math.min(...this.currentWindow.batchDurations);
      
      // Calculate 95th percentile duration
      const sorted = [...this.currentWindow.batchDurations].sort((a, b) => a - b);
      const index = Math.floor(sorted.length * 0.95);
      this.performance.p95BatchDuration = sorted[index] || sorted[sorted.length - 1] || 0;
    }
    
    // Calculate success rate
    const totalAttempted = this.history.totalBatchesAttempted;
    if (totalAttempted > 0) {
      this.performance.successRate = this.history.totalBatchesCompleted / totalAttempted;
    }
  }

  /**
   * Check if metrics window should be rolled over
   */
  checkWindowRollover() {
    const now = Date.now();
    const windowDuration = this.config.metricsWindowMs || 60000; // Default to 1 minute
    
    if (now - this.currentWindow.startTime >= windowDuration) {
      // Close current window
      this.currentWindow.endTime = now;
      
      // Store in history
      this.history.windows.push({...this.currentWindow});
      
      // Keep history size manageable
      const maxWindows = this.config.maxHistoryWindows || 60; // 1 hour of 1-minute windows
      if (this.history.windows.length > maxWindows) {
        this.history.windows.shift();
      }
      
      // Start new window
      this.currentWindow = {
        startTime: now,
        endTime: null,
        batchesAttempted: 0,
        batchesCompleted: 0,
        batchesFailed: 0,
        tokensAttempted: 0,
        tokensUpdated: 0,
        tokensFailed: 0,
        totalDuration: 0,
        batchDurations: [],
        errors: [],
        apiCalls: 0
      };
    }
  }

  /**
   * Get current metrics
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      currentWindow: {
        startTime: new Date(this.currentWindow.startTime).toISOString(),
        batchesAttempted: this.currentWindow.batchesAttempted,
        batchesCompleted: this.currentWindow.batchesCompleted,
        tokensAttempted: this.currentWindow.tokensAttempted,
        tokensUpdated: this.currentWindow.tokensUpdated,
        apiCalls: this.currentWindow.apiCalls,
        durationMs: Date.now() - this.currentWindow.startTime,
        errorCount: this.currentWindow.errors.length
      },
      totals: {
        batchesAttempted: this.history.totalBatchesAttempted,
        batchesCompleted: this.history.totalBatchesCompleted,
        batchesFailed: this.history.totalBatchesFailed,
        tokensAttempted: this.history.totalTokensAttempted,
        tokensUpdated: this.history.totalTokensUpdated,
        tokensFailed: this.history.totalTokensFailed,
        apiCalls: this.history.totalApiCalls
      },
      performance: {
        avgBatchDurationMs: Math.round(this.performance.avgBatchDuration),
        maxBatchDurationMs: this.performance.maxBatchDuration,
        minBatchDurationMs: this.performance.minBatchDuration === Infinity ? 0 : this.performance.minBatchDuration,
        p95BatchDurationMs: Math.round(this.performance.p95BatchDuration),
        successRate: this.performance.successRate
      },
      batchStats: {
        tokensPerBatch: this.history.totalTokensAttempted / Math.max(1, this.history.totalBatchesAttempted),
        avgBatchesPerMinute: (this.history.totalBatchesAttempted * 60000) / Math.max(1, Date.now() - this.currentWindow.startTime),
        successRate: this.history.totalBatchesCompleted / Math.max(1, this.history.totalBatchesAttempted)
      }
    };
  }
}